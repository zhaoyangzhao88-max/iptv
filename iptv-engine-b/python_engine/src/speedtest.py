import asyncio
import time
import aiohttp
from urllib.parse import urlparse, urljoin
from typing import List, Dict, Optional
from collections import defaultdict
from python_engine.src.constants import BLOCKLIST_DOMAINS, AD_BYTES_KEYWORDS

# 统一从 constants 导入（保持别名兼容现有代码）
BLACKLIST_DOMAINS = BLOCKLIST_DOMAINS
AD_KEYWORDS = AD_BYTES_KEYWORDS

def is_direct_stream(url: str) -> bool:
    """
    【新增】：智能判定一个播放链接是否为直连视频流。
    (如 udpxy 组播代理、或直连 .ts 视频源)
    此类链接不含 M3U8 索引层，直接由 raw TS 视频二进制构成。
    """
    parsed_path = urlparse(url).path.lower()
    # 常见 udpxy 的 /udp/、/rtp/ 路径，或显式 .ts 结尾，均判定为直流，直接送往二进制指纹校验
    if "/udp/" in parsed_path or "/rtp/" in parsed_path or parsed_path.endswith(".ts"):
        return True
    return False

def is_clean_redirect_chain(response: aiohttp.ClientResponse) -> bool:
    """审查重定向历史中是否包含广告域名"""
    for hist in response.history:
        domain = urlparse(str(hist.url)).netloc.lower()
        for bad in BLACKLIST_DOMAINS:
            if bad in domain:
                return False
    final_domain = urlparse(str(response.url)).netloc.lower()
    for bad in BLACKLIST_DOMAINS:
        if bad in final_domain:
            return False
    return True

def contains_ad_keywords(data: bytes) -> bool:
    """扫描二进制前 500 字节，识别是否含有恶性广告、扫码或跳转关键字"""
    chunk = data[:500].lower()
    for kw in AD_KEYWORDS:
        if kw in chunk:
            return True
    return False

def is_valid_media_segment(data: bytes) -> bool:
    """通过二进制头部特征判断是否为合法的音视频切片"""
    if len(data) < 188:
        return False
    if data[0] == 0x47:
        return True
    if b"ftyp" in data[:30] or b"moof" in data[:50]:
        return True
    return False

def parse_m3u8_for_next_link(content: str, base_url: str) -> Optional[str]:
    """解析 m3u8 纯文本，寻找下一个嵌套列表或 TS 切片路径"""
    lines = content.splitlines()
    is_master = any("#EXT-X-STREAM-INF" in line for line in lines)
    is_media = any("#EXTINF" in line for line in lines)

    if is_master:
        for i, line in enumerate(lines):
            line = line.strip()
            if "#EXT-X-STREAM-INF" in line and i + 1 < len(lines):
                next_line = lines[i+1].strip()
                if next_line and not next_line.startswith("#"):
                    return urljoin(base_url, next_line)
    elif is_media:
        for i, line in enumerate(lines):
            line = line.strip()
            if line.startswith("#EXTINF") and i + 1 < len(lines):
                next_line = lines[i+1].strip()
                if next_line and not next_line.startswith("#"):
                    return urljoin(base_url, next_line)
    for line in lines:
        line = line.strip()
        if line and not line.startswith("#"):
            return urljoin(base_url, line)
    return None

async def resolve_first_ts_url(
    session: aiohttp.ClientSession,
    url: str,
    timeout: float = 3.5,
    depth: int = 0
) -> Optional[str]:
    """深度下钻递归解析 M3U8 (包含302重定向链审查与内容关键字拦截)"""
    if depth > 2:
        return None
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        client_timeout = aiohttp.ClientTimeout(total=timeout)
        async with session.get(url, timeout=client_timeout, headers=headers, allow_redirects=True) as response:
            if response.status != 200:
                return None
            if not is_clean_redirect_chain(response):
                return None
            final_url = str(response.url)
            content = await response.text()

            if contains_ad_keywords(content.encode("utf-8", errors="ignore")):
                return None

            next_link = parse_m3u8_for_next_link(content, final_url)
            if not next_link:
                return None
            parsed_path = urlparse(next_link).path.lower()
            if ".m3u8" in next_link.lower() or parsed_path.endswith(".m3u8"):
                return await resolve_first_ts_url(session, next_link, timeout, depth + 1)
            else:
                return next_link
    except Exception:
        return None

async def probe_ts_segment(session: aiohttp.ClientSession, ts_url: str, timeout: float = 3.5) -> bool:
    """异步二进制 10KB 字节探针 (包含302重定向链审查与内容关键字拦截)"""
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        client_timeout = aiohttp.ClientTimeout(total=timeout, connect=2.0)
        async with session.get(ts_url, timeout=client_timeout, headers=headers, allow_redirects=True) as response:
            if response.status != 200:
                return False
            if not is_clean_redirect_chain(response):
                return False
            data = await response.content.read(10240)
            if contains_ad_keywords(data):
                return False
            return is_valid_media_segment(data)
    except Exception:
        return False

def extract_domain(url: str) -> str:
    """提取 URL 域名用于每域并发限流。空域名返回 'unknown' 兜底。"""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower() or parsed.hostname.lower() or "unknown"
        return domain
    except Exception:
        return "unknown"


async def probe_single_url(
    session: aiohttp.ClientSession,
    url: str,
    global_sem: asyncio.Semaphore,
    domain_sems: Dict[str, asyncio.Semaphore],
    timeout: float = 3.5
) -> dict:
    """
    异步深度双重自适应测速：
    1. 【新增直连判定】：检测链接是否为 udpxy 组播代理（url 含有 /udp/）或直接以 .ts 结尾的直流。
       - 如果是直流：跳过复杂的 M3U8 下钻过程，1毫秒直通，直接调用 TS 探针对该地址下载前 10KB。
       - 如果是标准 M3U8：依然走：下钻解析 -> 提取首片 TS -> 10KB TS 探针验证。
    2. 【域名级频控】：对同一 CDN 域名并发 ≤ 3，防止触发 WAF 封禁用户 IP。
    """
    result = {
        "url": url,
        "status": 0,
        "delay_ms": 9999,
        "success": False,
        "error": None
    }

    domain = extract_domain(url)
    dom_sem = domain_sems.get(domain)
    if dom_sem is None:
        dom_sem = asyncio.Semaphore(3)
        domain_sems[domain] = dom_sem

    async with dom_sem:
        async with global_sem:
            try:
                # A. 自适应判定：直连单播组播代理源
                if is_direct_stream(url):
                    ts_start = time.perf_counter()
                    # 直通车：跳过 M3U8 解析，直接测速和验证二进制 header 格式！
                    ts_success = await probe_ts_segment(session, url, timeout=timeout)
                    ts_end = time.perf_counter()

                    ts_delay = int((ts_end - ts_start) * 1000)
                    if ts_success:
                        result["status"] = 200
                        result["success"] = True
                        result["delay_ms"] = ts_delay
                    else:
                        result["error"] = "Direct TS stream validation failed"

                # B. 标准流程：M3U8 下钻解析
                else:
                    ts_url = await resolve_first_ts_url(session, url, timeout=2.5)
                    if not ts_url:
                        result["error"] = "Failed to resolve TS segment URL"
                        return result

                    ts_start = time.perf_counter()
                    ts_success = await probe_ts_segment(session, ts_url, timeout=timeout)
                    ts_end = time.perf_counter()

                    ts_delay = int((ts_end - ts_start) * 1000)
                    if ts_success:
                        result["status"] = 200
                        result["success"] = True
                        result["delay_ms"] = ts_delay
                    else:
                        result["error"] = "TS binary validation failed"

            except asyncio.TimeoutError:
                result["error"] = "Connection Timeout"
            except Exception as e:
                result["error"] = str(e)

    return result

async def probe_all_urls(urls: List[str], max_concurrent: int = 50, timeout: float = 3.5) -> List[dict]:
    """批量异步测速入口 (Lesson 16 实现)，含域名级并发频控"""
    semaphore = asyncio.Semaphore(max_concurrent)
    domain_sems: Dict[str, asyncio.Semaphore] = {}
    connector = aiohttp.TCPConnector(limit=max_concurrent, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [probe_single_url(session, url, semaphore, domain_sems, timeout) for url in urls]
        results = await asyncio.gather(*tasks)
        return list(results)
