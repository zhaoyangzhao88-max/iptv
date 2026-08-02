from python_engine.src.models import Channel
from python_engine.src.merger import sort_channel_urls_with_priority

def test_dual_tier_latency_sorting_and_curtailing():
    """测试双层分流置顶排序：极品源置顶升序排，普通源垫后升序排，未测速者9999ms沉底，上限4条"""
    channels = [
        Channel(
            name="CCTV-1",
            group="央视频道",
            urls=[
                "http://public-web-slow.com/live.m3u8",   # 公网慢线 (150ms)
                "http://127.0.0.1:3000/api/bilibili/6",   # 极品本地 Node 中转 (20ms)
                "http://public-web-fast.com/live.m3u8",   # 公网快线 (50ms)
                "http://11.1.1.1:8080/udp/239.1.1.1:8001",# 极品组播专网 (5ms)
                "http://untested.com/live.m3u8"           # 未测速线 (缺省9999ms)
            ]
        )
    ]

    # 模拟测速引擎采集回来的真实网速延迟字典
    mock_delays = {
        "http://11.1.1.1:8080/udp/239.1.1.1:8001": 5,      # 极品 1 (5ms)
        "http://127.0.0.1:3000/api/bilibili/6": 20,       # 极品 2 (20ms)
        "http://public-web-fast.com/live.m3u8": 50,       # 普通 1 (50ms)
        "http://public-web-slow.com/live.m3u8": 150       # 普通 2 (150ms)
        # http://untested.com/live.m3u8 在测速字典中缺失，默认代表未通过或超时
    }

    sorted_channels = sort_channel_urls_with_priority(channels, mock_delays)

    cctv = sorted_channels[0]

    # 断言 1：验证 4 条限制（未测速、最烂的 http://untested.com/ 必须被强行截断扔掉）
    assert len(cctv.urls) == 4
    assert "http://untested.com/live.m3u8" not in cctv.urls

    # 断言 2：双层分流排序严格度
    # Tier 1 (极品源) 必须无视公网速度排在最前头，且按 5ms -> 20ms 升序排！
    assert cctv.urls[0] == "http://11.1.1.1:8080/udp/239.1.1.1:8001" # 5ms
    assert cctv.urls[1] == "http://127.0.0.1:3000/api/bilibili/6"    # 20ms

    # Tier 2 (普通源) 必须靠后排，且按 50ms -> 150ms 升序排！
    assert cctv.urls[2] == "http://public-web-fast.com/live.m3u8"    # 50ms
    assert cctv.urls[3] == "http://public-web-slow.com/live.m3u8"    # 150ms

    # 断言 3：频道整体的 delay_ms 覆写
    # 必须更新为第一主线的延迟 5ms
    assert cctv.delay_ms == 5
