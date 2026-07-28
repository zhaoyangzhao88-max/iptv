import re
from typing import List
from urllib.parse import urlparse
from python_engine.src.models import RawStream

# 统一从常量模块导入黑名单域名
from python_engine.src.constants import BLOCKLIST_DOMAINS as DEFAULT_BLOCKLIST_DOMAINS

# 垃圾推广词正则匹配引擎 (支持 URL 和频道名字段检测)
DEFAULT_BLOCKLIST_PATTERNS = [
    r"测试占位",
    r"广告投放",
    r"加入群聊",
    r"付费解密",
    r"qrcode",
    r"扫码"
]

def is_blocked(url: str, name: str = "") -> bool:
    """
    多维度评估一个播放流是否触发了黑名单拦截。
    触发任意一条规则即返回 True。
    """
    # 1. 域名黑名单判定 (同时检查域名和路径，因为部分恶意标识如 fongmi 会出现在路径中)
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        full_lower = url.lower()
        for bad_domain in DEFAULT_BLOCKLIST_DOMAINS:
            if bad_domain in domain or bad_domain in full_lower:
                return True
    except Exception:
        pass

    # 2. 链接本身是否包含非法特征词
    url_lower = url.lower()
    for pattern in DEFAULT_BLOCKLIST_PATTERNS:
        if re.search(pattern, url_lower, re.IGNORECASE):
            return True

    # 3. 频道名字是否包含招商、广告、色情诈骗推广信息
    if name:
        name_lower = name.lower()
        for pattern in DEFAULT_BLOCKLIST_PATTERNS:
            if re.search(pattern, name_lower, re.IGNORECASE):
                return True

    return False

def filter_blocked_streams(streams: List[RawStream]) -> List[RawStream]:
    """
    黑名单强力洗涤器：对输入的 RawStream 列表进行地毯式扫描，
    剔除任何触发垃圾规则的非法流，保障输出流极度纯净。
    """
    clean_streams: List[RawStream] = []
    for stream in streams:
        if not is_blocked(stream.raw_url, stream.raw_name):
            clean_streams.append(stream)
    return clean_streams
