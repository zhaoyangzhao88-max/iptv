import pytest
from unittest.mock import patch, MagicMock
from python_engine.src.fetcher import fetch_all_sources, DEFAULT_SOURCES

from python_engine.src.source_config import authorized_urls


def test_default_sources_integrity():
    """验证预设源集合非空、唯一且均为 GitHub 链接"""
    assert DEFAULT_SOURCES
    assert len(DEFAULT_SOURCES) == len(set(DEFAULT_SOURCES))
    assert set(DEFAULT_SOURCES) == authorized_urls()
    for url in DEFAULT_SOURCES:
        assert "github" in url, "预设源必须是 GitHub 链接以确保后续继承代理 fallback 机制！"

@patch("python_engine.src.fetcher.smart_request_get")
def test_fetch_all_sources_concurrency_and_fallback(mock_get):
    """测试并发下载。且当个别源网络断联时，其他正常的源依然能成功返回，引擎不卡死"""
    test_urls = [
        "https://github.com/source_good_1.m3u",
        "https://github.com/source_bad.m3u",
        "https://github.com/source_good_2.m3u"
    ]

    # 模拟成功 1
    def mock_side_effect(url, timeout=8):
        if "source_bad" in url:
            raise Exception("模拟测试：该数据源网络彻底断开")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        if "good_1" in url:
            mock_resp.text = "#EXTM3U\n#EXTINF:-1,CCTV1\nhttp://cctv.com/1.m3u8"
        else:
            mock_resp.text = "#EXTM3U\n#EXTINF:-1,湖南卫视\nhttp://hntv.com/2.m3u8"
        return mock_resp

    mock_get.side_effect = mock_side_effect

    # 执行下载
    results = fetch_all_sources(urls=test_urls, max_workers=3)

    # 断言：坏掉的源不应阻断下载流程，正常的 2 个源内容必须完美获取
    assert len(results) == 2
    assert "https://github.com/source_bad.m3u" not in results
    assert results["https://github.com/source_good_1.m3u"] == "#EXTM3U\n#EXTINF:-1,CCTV1\nhttp://cctv.com/1.m3u8"
    assert results["https://github.com/source_good_2.m3u"] == "#EXTM3U\n#EXTINF:-1,湖南卫视\nhttp://hntv.com/2.m3u8"
    # 确保触发了 3 次网络探测
    assert mock_get.call_count == 3
