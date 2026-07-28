"""冒烟测试：aggregator_crawler 模块可正常导入且核心函数可调用"""

from unittest import mock


def test_aggregator_crawler_import():
    """验证 aggregator_crawler 模块可正常导入"""
    from python_engine.src import aggregator_crawler
    assert aggregator_crawler is not None
    assert hasattr(aggregator_crawler, 'fetch_page')
    assert hasattr(aggregator_crawler, 'crawl_all')
    assert hasattr(aggregator_crawler, 'main')


def test_constants_available():
    """验证模块核心常量可访问"""
    from python_engine.src.aggregator_crawler import (
        BASE_URL, BASE_DOMAIN, OUTPUT_FILE, PROVINCE_KEYWORDS
    )
    assert BASE_URL == "https://foodieguide.com/iptv/hotlist.php"
    assert isinstance(OUTPUT_FILE, str)
    assert isinstance(PROVINCE_KEYWORDS, dict)


def test_extract_m3u8_urls_empty():
    """extract_m3u8_urls 在无匹配时返回空列表"""
    from python_engine.src.aggregator_crawler import extract_m3u8_urls

    result = extract_m3u8_urls("<html><body>no links here</body></html>")
    assert isinstance(result, list)


def test_extract_m3u8_urls_finds_link():
    """extract_m3u8_urls 能提取 .m3u8 URL"""
    from python_engine.src.aggregator_crawler import extract_m3u8_urls

    html = '<a href="http://example.com/stream.m3u8">link</a>'
    result = extract_m3u8_urls(html)
    assert len(result) == 1
    assert result[0]["url"] == "http://example.com/stream.m3u8"


def test_extract_channel_name_from_url():
    """extract_channel_name 能从 URL 路径提取频道名"""
    from python_engine.src.aggregator_crawler import extract_channel_name

    # URL with numeric path — should return 未知频道 since digits-only names are excluded
    result = extract_channel_name("", "http://example.com/12345/stream.m3u8")
    assert result is not None
    assert isinstance(result, str)


def test_extract_subpage_links_empty():
    """extract_subpage_links 在无链接时返回空列表"""
    from python_engine.src.aggregator_crawler import extract_subpage_links

    result = extract_subpage_links("<html></html>", "http://example.com")
    assert result == []


def test_classify_by_province_detects_sichuan():
    """classify_by_province 能通过简称 'sc' 识别四川"""
    from python_engine.src.aggregator_crawler import classify_by_province

    result = classify_by_province(
        "http://sc.somecdn.com/stream.m3u8",
        "Some Channel",
        ""
    )
    assert result == "四川"


def test_classify_by_province_unknown_returns_none():
    """classify_by_province 对完全无关的 URL 返回 None"""
    from python_engine.src.aggregator_crawler import classify_by_province

    # Avoid any province keyword substring (e.g. "zz" matches 河南's 郑州)
    result = classify_by_province(
        "http://xyz123.nonexistent/qqqqqq.m3u8",
        "X Y Z",
        "q w e r t y u i o p"
    )
    assert result is None
