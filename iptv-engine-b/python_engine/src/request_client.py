import requests
import socket
from typing import Optional
from urllib.parse import urljoin

from python_engine.src.url_policy import is_safe_fetch_url, validate_redirect_url

MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_REDIRECTS = 5

# 稳定、高速的 GitHub 代理镜像池 (直连失败后自动下沉使用)
GH_PROXIES = [
    "https://mirror.ghproxy.com/",
    "https://ghproxy.net/",
    "https://gh.api.99988866.xyz/"
]

def is_ipv6_supported() -> bool:
    """
    自适应探测当前环境是否支持并开启了 IPv6。
    """
    try:
        # 尝试创建一个 IPv6 套接字测试
        socket.getaddrinfo("2001:4860:4860::8888", 53, socket.AF_INET6)
        s = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
        s.connect(("2001:4860:4860::8888", 80))
        s.close()
        return True
    except Exception:
        return False

def clean_github_url(url: str, proxy: Optional[str] = None) -> str:
    """
    将普通的 GitHub 链接无感拼接上加速代理。
    """
    if "github.com" in url or "raw.githubusercontent.com" in url:
        if proxy:
            base_proxy = proxy.rstrip("/")
            return f"{base_proxy}/{url}"
    return url

def _bounded_get(url: str, *, timeout: int, headers: dict) -> requests.Response:
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        if not is_safe_fetch_url(current):
            raise ValueError("unsafe HTTP(S) request URL")
        response = requests.get(
            current,
            timeout=timeout,
            headers=headers,
            allow_redirects=False,
            stream=True,
        )
        location = response.headers.get("Location")
        is_redirect = isinstance(response.status_code, int) and 300 <= response.status_code < 400
        if is_redirect:
            response.close()
            if not location:
                raise ConnectionError("redirect response missing Location")
            current = validate_redirect_url(urljoin(current, location))
            continue
        content = bytearray()
        try:
            chunks = response.iter_content(chunk_size=64 * 1024)
            for chunk in chunks:
                if isinstance(chunk, str):
                    chunk = chunk.encode("utf-8")
                if not isinstance(chunk, (bytes, bytearray)):
                    raise TypeError
                if len(content) + len(chunk) > MAX_RESPONSE_BYTES:
                    response.close()
                    raise ValueError("response exceeds maximum size")
                content.extend(chunk)
        except (TypeError, AttributeError):
            raw_content = getattr(response, "content", b"")
            if not isinstance(raw_content, (bytes, bytearray)):
                raw_content = str(getattr(response, "text", "")).encode("utf-8")
            if len(content) + len(raw_content) > MAX_RESPONSE_BYTES:
                response.close()
                raise ValueError("response exceeds maximum size")
            content.extend(raw_content)
        if len(content) > MAX_RESPONSE_BYTES:
            response.close()
            raise ValueError("response exceeds maximum size")
        response._content = bytes(content)
        response.close()
        return response
    raise ConnectionError("too many redirects")

def smart_request_get(url: str, timeout: int = 5, headers: Optional[dict] = None) -> requests.Response:
    """
    智能网络请求客户端：
    1. 自适应 IPv6 阻断：若本机无 IPv6 环境，遇 IPv6 地址则闪电报错，绝不卡死。
    2. GitHub 加速重试：GitHub 链接直连失败后，自动下沉使用镜像重试。
    3. 所有请求均验证公网目标、逐跳验证重定向并限制响应大小。
    """
    is_v6_url = "[" in url and "]" in url
    if "[" not in url and "://" in url:
        host = url.split("://", 1)[1].split("/", 1)[0].split(":")[0]
        is_v6_url = host.count(":") >= 2
    if is_v6_url and not is_ipv6_supported():
        raise ConnectionError("当前物理环境不支持 IPv6，已智能闪避该 IPv6 链接。")

    default_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    if headers:
        default_headers.update(headers)

    try:
        response = _bounded_get(url, timeout=timeout, headers=default_headers)
        if response.status_code == 200:
            return response
    except Exception as error:
        if "github" not in url.lower():
            raise error

    if "github" in url.lower():
        for proxy in GH_PROXIES:
            proxied_url = clean_github_url(url, proxy)
            try:
                response = _bounded_get(proxied_url, timeout=timeout, headers=default_headers)
                if response.status_code == 200:
                    return response
            except Exception:
                continue

    raise ConnectionError(f"直连及所有 GitHub 代理镜像均失效。URL: {url}")
