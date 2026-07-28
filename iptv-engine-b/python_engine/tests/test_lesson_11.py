from python_engine.src.normalizer import clean_channel_name

def test_bracket_stripping():
    """测试剥离中英文各式括号及其内部噪音"""
    assert clean_channel_name("CCTV-1 [FHD] (电信)") == "CCTV-1"
    assert clean_channel_name("浙江卫视【移动线路】（备用）") == "浙江卫视"
    assert clean_channel_name("绍兴新闻 [H265] (1080p)") == "绍兴新闻"

def test_privileged_retention_words():
    """测试：必须誓死保护特许字词（+、HD、4K、高清），绝不误杀属性标识"""
    assert clean_channel_name("CCTV5+ [FHD]") == "CCTV-5+"
    assert clean_channel_name("浙江卫视HD [电信]") == "浙江卫视HD"
    assert clean_channel_name("绍兴新闻综合高清 (1080P)") == "绍兴新闻综合高清"
    assert clean_channel_name("CCTV-4K (超清)") == "CCTV-4K"

def test_cctv_standardization():
    """测试 CCTV 数字与英文字母频道命名的极致统一化规范"""
    assert clean_channel_name("cctv1") == "CCTV-1"
    assert clean_channel_name("CCTV_5+") == "CCTV-5+"
    assert clean_channel_name("cctv 13 新闻") == "CCTV-13 新闻"
    assert clean_channel_name("cctv news") == "CCTV-NEWS"
