import aiohttp
import asyncio
from typing import Optional

async def detect_hotel_gateway(session: aiohttp.ClientSession, ip_port: str, timeout: float = 3.0) -> Optional[str]:
    """
    智能酒店 IPTV 探针：
    通过极轻量的 HTTP 握手，扫描并判断该 IP:PORT 是否为暴露在公网上的商用酒店 IPTV 或者是 udpxy 多播代理网关。
    返回识别出的类型:
    - 'udpxy' (标准多播转单播网关)
    - 'hotel_iptv' (酒店专网有线网关后台)
    - None (非 IPTV 相关设备)
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    # 1. 探针 A：测试是否为标准的 udpxy 状态与控制页
    try:
        url_udpxy = f"http://{ip_port}/status"
        # 严格控制连接超时，1.5 秒内不握手直接视为不通，防范挂起卡死
        client_timeout = aiohttp.ClientTimeout(total=timeout, connect=1.5)
        async with session.get(url_udpxy, timeout=client_timeout, headers=headers, allow_redirects=True) as response:
            if response.status == 200:
                html = await response.text()
                # udpxy 标志性网页特征词检索
                if "udpxy" in html.lower() or "udplite-to-http" in html.lower():
                    return "udpxy"
    except Exception:
        pass

    # 2. 探针 B：测试是否为商用酒店 IPTV 自定义专网网关
    try:
        url_hotel = f"http://{ip_port}/"
        client_timeout = aiohttp.ClientTimeout(total=timeout, connect=1.5)
        async with session.get(url_hotel, timeout=client_timeout, headers=headers, allow_redirects=True) as response:
            if response.status == 200:
                html = await response.text()
                # 酒店专网系统的特征检索词 (Hilton, Custom IPTV, 酒店有线电视等)
                hotel_keywords = ["hotel", "酒店", "iptv gateway", "iptv网关", "igmpproxy", "multicast"]
                if any(kw in html.lower() for kw in hotel_keywords):
                    return "hotel_iptv"
    except Exception:
        pass

    return None
