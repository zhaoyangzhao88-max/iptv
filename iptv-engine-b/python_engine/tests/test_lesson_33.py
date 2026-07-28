from python_engine.src.models import Channel
from python_engine.src.merger import clean_expired_and_dead_channels


def test_expired_links_cleansing_and_card_removal():
    """测试失效源清洗：验证死链过滤以及空壳卡片整台抹杀的逻辑"""
    # 模拟主通道列表
    test_channels = [
        # CCTV-1：包含一条活线（100分）和一条已扣光积分的死链（0分）。应该保留 CCTV-1，但剔除死链。
        Channel(
            name="CCTV-1",
            group="央视频道",
            urls=["http://live.com/cctv_good.m3u8", "http://live.com/cctv_dead.m3u8"]
        ),
        # 浙江卫视：包含一条死链（0分）。由于过滤后播放链接为0，该"空壳卡片"必须被完全丢弃！
        Channel(
            name="浙江卫视",
            group="卫视频道",
            urls=["http://live.com/zj_dead.m3u8"]
        )
    ]

    # 模拟 history_scores.json 功德簿内容
    mock_scores = {
        "http://live.com/cctv_good.m3u8": 100,
        "http://live.com/cctv_dead.m3u8": 0,
        "http://live.com/zj_dead.m3u8": 0
    }

    cleaned_results = clean_expired_and_dead_channels(test_channels, mock_scores)

    # 断言：浙江卫视被彻底斩首抹除，只剩下 CCTV-1 一个台
    assert len(cleaned_results) == 1
    assert cleaned_results[0].name == "CCTV-1"

    # 断言：CCTV-1 内部的 urls 列表中，只剩下了 cctv_good.m3u8
    assert len(cleaned_results[0].urls) == 1
    assert cleaned_results[0].urls == ["http://live.com/cctv_good.m3u8"]
