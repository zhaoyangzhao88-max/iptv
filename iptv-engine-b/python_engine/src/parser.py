import re
import os
from typing import List, Optional
from urllib.parse import urlparse
from python_engine.src.models import RawStream
from python_engine.src.request_client import smart_request_get

def is_m3u_playlist(url: str) -> bool:
    """
    智能判定一个 URL 是否指向另一个 M3U 播放列表文件（而非直链流地址如 .m3u8）
    """
    parsed = urlparse(url)
    path = parsed.path.lower()
    # 必须是以 .m3u 结尾（不含 8），容错剔除查询参数
    return path.endswith(".m3u")

def parse_m3u_content(m3u_text: str, source_id: Optional[str] = None) -> List[RawStream]:
    """
    像素级解析 M3U 纯文本。
    提取出每一个频道对应的播放链接(raw_url)、原始名称(raw_name)、原始分类(raw_group)以及原始台标(tvg_logo)。
    """
    raw_streams: List[RawStream] = []
    lines = m3u_text.splitlines()
    current_extinf = None

    tvg_id_regex = re.compile(r'tvg-id=["\']?([^"\']+)["\']?', re.IGNORECASE)
    tvg_logo_regex = re.compile(r'tvg-logo=["\']?([^"\']+)["\']?', re.IGNORECASE)
    group_title_regex = re.compile(r'group-title=["\']?([^"\']+)["\']?', re.IGNORECASE)

    for line in lines:
        line = line.strip()
        if not line:
            continue

        if line.startswith("#EXTINF"):
            comma_index = line.rfind(",")
            if comma_index != -1:
                raw_name = line[comma_index + 1:].strip()
                metadata_part = line[:comma_index]
            else:
                raw_name = "未知频道"
                metadata_part = line

            tvg_id_match = tvg_id_regex.search(metadata_part)
            tvg_logo_match = tvg_logo_regex.search(metadata_part)
            group_title_match = group_title_regex.search(metadata_part)

            current_extinf = {
                "raw_name": raw_name,
                "raw_group": group_title_match.group(1) if group_title_match else None,
                "tvg_logo": tvg_logo_match.group(1) if tvg_logo_match else None
            }

        elif line.startswith(("http://", "https://", "rtmp://", "rtsp://")):
            if current_extinf:
                try:
                    stream = RawStream(
                        raw_url=line,
                        raw_name=current_extinf["raw_name"],
                        raw_group=current_extinf["raw_group"],
                        tvg_logo=current_extinf["tvg_logo"],
                        source_id=source_id
                    )
                    raw_streams.append(stream)
                except Exception:
                    pass
                current_extinf = None

    return raw_streams

def expand_m3u_streams(streams: List[RawStream], max_depth: int = 3, visited: set = None) -> List[RawStream]:
    """
    递归展开器：扫描当前的 RawStream 列表。
    若发现某条 stream 的 URL 实际上是一个子 M3U 播放列表，则自动请求下载并解析，将其扁平化展开到主列表中。
    利用 visited 集合 and max_depth 双重熔断机制防止无限循环死锁。
    """
    if visited is None:
        visited = set()

    if max_depth <= 0:
        return streams

    flat_streams: List[RawStream] = []

    for stream in streams:
        url = stream.raw_url

        # 判断是否为嵌套子播放列表
        if is_m3u_playlist(url):
            if url in visited:
                continue  # 闪避循环引用死锁
            visited.add(url)

            try:
                # 递归并发拉取子 M3U 数据（继承 Lesson 5 智能网络客户端）
                response = smart_request_get(url, timeout=8)
                if response.status_code == 200:
                    sub_text = response.text
                    # 解析子 M3U 文件
                    sub_streams = parse_m3u_content(sub_text, source_id=stream.source_id)
                    # 递归下钻展开
                    expanded_sub = expand_m3u_streams(sub_streams, max_depth - 1, visited)
                    flat_streams.extend(expanded_sub)
            except Exception:
                # 即使子列表挂掉，也优雅忽略，确保主线进度继续
                pass
        else:
            # 真正的流媒体直链（如 .m3u8, .ts, rtmp 等），直接保留
            flat_streams.append(stream)

    return flat_streams
