import pytest
from python_engine.src.speedtest import contains_ad_keywords

def test_contains_ad_keywords_detection():
    """测试对包含广告关键字字节的前500字节扫描机制"""
    # 模拟包含 epg.pw 垃圾域名的流
    data_with_epg = b"some video header data here epg.pw and some other bytes"
    assert contains_ad_keywords(data_with_epg) is True

    # 模拟包含 catvod 垃圾关键字的流
    data_with_catvod = b"catvod special qr placeholder video stream"
    assert contains_ad_keywords(data_with_catvod) is True

    # 模拟纯净流数据（以 0x47 TS同步码开头）
    clean_data = b"G" + b"\x00" * 499
    assert contains_ad_keywords(clean_data) is False
