"""IPTV-Engine-B 全局常量定义

统一管理黑名单域名、广告关键词等跨模块共享常量，避免 blocklist.py 和 speedtest.py 重复定义。
"""

# 恶性广告域名黑名单（出现在 302 落地 URL 或域名中即拦截）
BLOCKLIST_DOMAINS = [
    "epg.pw",
    "freetv.fun",
    "catvod",
    "fongmi",
    "shuyz.gitee.io",
    "ads.example.com",
]

# 广告内容二进制特征（出现在响应体前 500 字节即拦截）
AD_BYTES_KEYWORDS = [
    b"epg.pw",
    b"catvod",
    b"fongmi",
    b"freetv.fun",
]
