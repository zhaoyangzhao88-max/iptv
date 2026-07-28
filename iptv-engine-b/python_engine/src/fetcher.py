import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict
from python_engine.src.request_client import smart_request_get

# 默认预设的 5 个顶级高质量 M3U 播放源 (全部为 GitHub 链接，自动继承 Lesson 5 的代理容错和 IPv6 闪避器)
DEFAULT_SOURCES = [
    "https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u",  # fanmingming 大神源
    "https://raw.githubusercontent.com/YueChan/Live/main/APTV.m3u",            # YueChan APTV 经典聚合
    "https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u",          # YanG 综合收集源
    "https://raw.githubusercontent.com/MellowCo/iptv/main/iptv.m3u",            # MellowCo 精选源
    "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u"     # iptv-org 官方中国源
]

def fetch_single_source(url: str, timeout: int = 8) -> str:
    """
    下载单个 M3U 源，自适应重试并记录日志。
    如果失败，记录 warning 级别日志，避免引发整个程序崩溃。
    """
    try:
        response = smart_request_get(url, timeout=timeout)
        if response.status_code == 200:
            return response.text
        return ""
    except Exception as e:
        logging.warning(f"下载 M3U 源失败: {url}，原因: {e}")
        return ""

def fetch_all_sources(urls: List[str] = None, max_workers: int = 5) -> Dict[str, str]:
    """
    多线程高并发下载所有的 M3U 数据源。
    返回字典结构: { "数据源网址": "下载成功的 M3U 纯文本内容" }
    """
    if urls is None:
        urls = DEFAULT_SOURCES

    results: Dict[str, str] = {}

    # 采用线程池进行高并发下载，max_workers 默认为 5，契合 5 个默认源
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # 将并发下载任务提交到线程池中
        future_to_url = {executor.submit(fetch_single_source, url): url for url in urls}

        for future in as_completed(future_to_url):
            url = future_to_url[future]
            try:
                content = future.result()
                if content:
                    results[url] = content
            except Exception as e:
                logging.error(f"并发下载时捕获到未知异常: {url}, 原因: {e}")

    return results
