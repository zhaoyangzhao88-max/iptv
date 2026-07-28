from python_engine.src.cdn_scanner import get_provincial_cdn_profile, generate_cdn_channel_url

def test_cdn_profile_lookups():
    """测试省份广电 CDN 模板字典库的可检索性"""
    # 验证江苏广电模板是否存在
    js_profile = get_provincial_cdn_profile("江苏广电")
    assert js_profile is not None
    assert "jsccn.net" in js_profile["domain_pattern"]
    assert "{channel_code}" in js_profile["url_template"]

    # 验证不存在的省份返回 None
    assert get_provincial_cdn_profile("美国有线电视") is None

def test_cdn_url_generation_engine():
    """测试根据各省物理规律模板，智能拼接绝对探测播放地址"""
    # 1. 验证江苏广电 CCTV-1 拼接规律 (live 目录下 cctv1hd/index.m3u8)
    js_url = generate_cdn_channel_url("江苏广电", "218.94.1.1", "cctv1")
    assert js_url == "http://218.94.1.1/live/cctv1hd/index.m3u8"

    # 2. 验证四川广电 CCTV-1 拼接规律 (hls 目录下 cctv1.m3u8)
    sc_url = generate_cdn_channel_url("四川广电", "sctv-cdn.com", "cctv1")
    assert sc_url == "http://sctv-cdn.com/hls/cctv1.m3u8"

    # 3. 验证广东广电 广东卫视 拼接规律 (gdtv/gdtv.m3u8)
    gd_url = generate_cdn_channel_url("广东广电", "gdtv-cdn.com:8080", "gdtv")
    assert gd_url == "http://gdtv-cdn.com:8080/gdtv/gdtv.m3u8"

    # 4. 验证不存在频道键时优雅拒绝
    assert generate_cdn_channel_url("江苏广电", "218.94.1.1", "non_existent_key") is None
