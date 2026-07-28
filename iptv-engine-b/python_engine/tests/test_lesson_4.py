from python_engine.src.normalizer import get_channel_group

def test_cctv_and_satellite_grouping():
    """测试央视和卫视频道的分流拦截"""
    # 央视测试
    assert get_channel_group("CCTV-1 综合") == "央视频道"
    assert get_channel_group("cctv5+ 体育") == "央视频道"
    assert get_channel_group("风云足球 (央视)") == "央视频道"

    # 卫视测试
    assert get_channel_group("湖南卫视HD") == "卫视频道"
    assert get_channel_group("浙江卫视") == "卫视频道"

def test_local_provinces_grouping():
    """测试地市级频道能否智能识别并打包回省份频道"""
    # 浙江省地方地市匹配
    assert get_channel_group("绍兴新闻综合") == "浙江频道"
    assert get_channel_group("杭州综合频道") == "浙江频道"
    assert get_channel_group("温州公共频道") == "浙江频道"

    # 广东省地方地市匹配
    assert get_channel_group("深圳都市") == "广东频道"
    assert get_channel_group("广州综合") == "广东频道"

    # 河南省地方地市匹配
    assert get_channel_group("驻马店一套") == "河南频道"
    assert get_channel_group("郑州新闻") == "河南频道"

def test_fallback_grouping():
    """测试无法识别频道，能否完美进入兜底分类"""
    assert get_channel_group("HBO电影台") == "其他频道"
    assert get_channel_group("Discovery探索频道") == "其他频道"
