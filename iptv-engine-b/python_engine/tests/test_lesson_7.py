from python_engine.src.parser import parse_m3u_content

def test_m3u_pixel_parsing_success():
    """测试 M3U 精密属性剥离与容错能力"""
    m3u_sample_text = """#EXTM3U
#EXTINF:-1 tvg-id="CCTV1.cn" tvg-logo="http://logo.com/cctv1.png" group-title="央视频道",CCTV-1 综合
http://cctv.com/live1.m3u8
#EXTINF:0 tvg-id="ZhejiangTV.cn" tvg-name="浙江卫视" tvg-logo='http://logo.com/zj.png' group-title="卫视频道",浙江卫视
https://zjtv.com/live2.m3u8
#EXTINF:-1,无属性少儿频道
rtmp://kids.com/live3
"""

    streams = parse_m3u_content(m3u_sample_text)

    # 必须成功解析出 3 个流
    assert len(streams) == 3

    # 检验 CCTV-1 属性是否全部精准剥离
    assert streams[0].raw_name == "CCTV-1 综合"
    assert streams[0].raw_url == "http://cctv.com/live1.m3u8"
    assert streams[0].raw_group == "央视频道"
    assert streams[0].tvg_logo == "http://logo.com/cctv1.png"

    # 检验 浙江卫视 属性（带单引号）是否也精准剥离
    assert streams[1].raw_name == "浙江卫视"
    assert streams[1].raw_url == "https://zjtv.com/live2.m3u8"
    assert streams[1].raw_group == "卫视频道"
    assert streams[1].tvg_logo == "http://logo.com/zj.png"

    # 检验无属性频道（逗号后直接起名字）的兜底能力
    assert streams[2].raw_name == "无属性少儿频道"
    assert streams[2].raw_url == "rtmp://kids.com/live3"
    assert streams[2].raw_group is None
    assert streams[2].tvg_logo is None
