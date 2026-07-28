from python_engine.src.models import Channel
from python_engine.src.merger import export_channels_to_list

def test_final_json_export_conformance_and_none_exclusion():
    """测试最终输出字典列表是否完美对齐 B 程序前端播放器的硬性数据契约，且不含有任何 null 干扰键"""
    channels_sample = [
        # CCTV-1 综合：有高清 logo 和 EPG ID 的央视频道
        Channel(
            name="CCTV-1 综合",
            group="央视频道",
            urls=["http://live.com/cctv.m3u8"],
            delay_ms=25,
            logo="http://logo.com/cctv.png",
            tvg_id="CCTV1"
        ),
        # 绍兴生活：没有台标和 EPG ID 的地方台，检验 exclude_none 过滤 null 键效果
        Channel(
            name="绍兴生活",
            group="浙江频道",
            urls=["http://live.com/sx.m3u8"],
            delay_ms=80
        )
    ]

    exported_data = export_channels_to_list(channels_sample)

    # 必须成功导出 2 个台
    assert len(exported_data) == 2

    # 1. 深度对齐 CCTV-1 综合 契约字段
    cctv = exported_data[0]
    assert cctv["name"] == "CCTV-1 综合"
    assert cctv["group"] == "央视频道"
    assert cctv["urls"] == ["http://live.com/cctv.m3u8"]
    assert cctv["delay_ms"] == 25
    assert cctv["logo"] == "http://logo.com/cctv.png"
    assert cctv["tvg_id"] == "CCTV1"

    # 2. 深度对齐 绍兴生活 契约字段
    sx = exported_data[1]
    assert sx["name"] == "绍兴生活"
    assert sx["group"] == "浙江频道"
    assert sx["urls"] == ["http://live.com/sx.m3u8"]
    assert sx["delay_ms"] == 80

    # 【最关键断言】：由于这两个 Optional 字段为空，输出字典里绝对不能含有这两个 Key，防止向播放器输出无用 null！
    assert "logo" not in sx, "导出的最终字典里竟然混入了无意义的 null logo 干扰键！"
    assert "tvg_id" not in sx, "导出的最终字典里竟然混入了无意义的 null tvg_id 干扰键！"
