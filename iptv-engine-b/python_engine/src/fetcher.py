import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict
from python_engine.src.request_client import smart_request_get
from python_engine.src.source_config import DEFAULT_SOURCE_CONFIG, SourceConfig, load_source_config

MAX_SOURCE_BYTES = 4 * 1024 * 1024

# Legacy string export retained for existing callers and tests.
DEFAULT_SOURCES = [config.url for config in DEFAULT_SOURCE_CONFIG]

def fetch_single_source(url: str, timeout: int = 8) -> str:
    """
    下载单个 M3U 源，自适应重试并记录日志。
    如果失败，记录 warning 级别日志，避免引发整个程序崩溃。
    """
    try:
        response = smart_request_get(url, timeout=timeout)
        if response.status_code == 200:
            content = response.text
            if len(content.encode("utf-8", errors="replace")) <= MAX_SOURCE_BYTES:
                return content
            logging.warning("M3U 源响应超过大小上限，已跳过: %s", url)
            return ""
        return ""
    except Exception as e:
        logging.warning(f"下载 M3U 源失败: {url}，原因: {e}")
        return ""

def fetch_all_sources(urls: List[str] = None, max_workers: int = 5) -> Dict[str, str]:
    """
    多线程高并发下载显式配置的 M3U 数据源。
    ``urls`` 保持旧字符串接口；未传入时使用受审计的配置清单。
    返回字典结构: { "数据源网址": "下载成功的 M3U 纯文本内容" }
    """
    configs = DEFAULT_SOURCE_CONFIG if urls is None else load_source_config(
        SourceConfig(url=url) if isinstance(url, str) else url for url in urls
    )

    results: Dict[str, str] = {}

    # 仅提交配置中明确启用的源，禁止隐式发现或扩展 URL。
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_config = {
            executor.submit(fetch_single_source, config.url, config.timeout): config
            for config in configs
        }

        for future in as_completed(future_to_config):
            config = future_to_config[future]
            url = config.url
            try:
                content = future.result()
                if content:
                    results[url] = content
            except Exception as e:
                logging.error(f"并发下载时捕获到未知异常: {url}, 原因: {e}")

    return results
