from python_engine.src.models import RawStream
from python_engine.src.blocklist import is_blocked, filter_blocked_streams

def test_is_blocked_domains_detection():
    """测试恶意域名劫持拦截"""
    assert is_blocked("http://epg.pw/live.m3u8") is True, "未阻断 epg.pw 恶意广告源！"
    assert is_blocked("https://sub.freetv.fun/movie.ts") is True, "未阻断 freetv.fun 恶意广告源！"
    assert is_blocked("http://ok.com/fongmi_api") is True, "未阻断 fongmi 恶意广告源！"

    # 正常域名不应拦截
    assert is_blocked("http://cctv.com/live1.m3u8") is False

def test_is_blocked_patterns_detection():
    """测试 URL 链接和频道名中的垃圾推广语拦截"""
    # URL 包含 qrcode 拦截
    assert is_blocked("http://test.com/live_qrcode_adv.ts") is True

    # 频道名字包含"加群"、"扫码"拦截
    assert is_blocked("http://ok.com/cctv.m3u8", name="CCTV-1 (加入群聊看超清)") is True
    assert is_blocked("http://ok.com/cctv.m3u8", name="测试占位广告台") is True

    # 正常名字不应拦截
    assert is_blocked("http://ok.com/cctv.m3u8", name="CCTV-1 综合") is False

def test_filter_blocked_streams_cleansing():
    """测试清洗洗涤器，检验大列表过滤能力"""
    raw_streams = [
        RawStream(raw_url="http://cctv.com/1.m3u8", raw_name="CCTV-1 综合"),
        RawStream(raw_url="http://epg.pw/cctv1.m3u8", raw_name="CCTV-1 假台"),
        RawStream(raw_url="http://normal.com/cctv2.m3u8", raw_name="CCTV-2 测试占位广告台"),
        RawStream(raw_url="http://normal.com/cctv5.m3u8", raw_name="CCTV-5 体育")
    ]

    clean_results = filter_blocked_streams(raw_streams)

    # 过滤掉 2 个垃圾台，只剩下 2 个优质台
    assert len(clean_results) == 2
    assert clean_results[0].raw_name == "CCTV-1 综合"
    assert clean_results[1].raw_name == "CCTV-5 体育"
