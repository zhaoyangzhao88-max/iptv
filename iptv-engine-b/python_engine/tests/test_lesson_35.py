import pytest
from python_engine.src.models import Channel
from python_engine.src.merger import orchestrate_channel_groups

def test_commercial_grade_channel_orchestration():
    """测试商业级频道排序大编排：验证央视/卫视置顶、CCTV数字自然排序、地方台自适应归档与空壳拦截"""
    unordered_list = [
        Channel(name="浙江卫视", group="卫视频道", urls=["http://zj.com"]),
        Channel(name="CCTV-13 新闻", group="央视频道", urls=["http://cctv13.com"]),
        Channel(name="CCTV-2 财经", group="央视频道", urls=["http://cctv2.com"]),
        Channel(name="绍兴新闻", group="浙江频道", urls=["http://sx.com"]),
        Channel(name="CCTV-5+ 体育赛事", group="央视频道", urls=["http://cctv5plus.com"]),
        Channel(name="CCTV-5 体育", group="央视频道", urls=["http://cctv5.com"]),
        Channel(name="深圳公共", group="广东频道", urls=["http://sz.com"]),
        Channel(name="CCTV-1 综合", group="央视频道", urls=["http://cctv1.com"]),
        Channel(name="不知道什么台", group="其他频道", urls=["http://unknown.com"]),
        Channel(name="空壳卡片台", group="浙江频道", urls=[])  # 无 urls，必须被拦截抹除
    ]

    sorted_results = orchestrate_channel_groups(unordered_list)

    # 验证 1：空壳台剔除，列表中应该只剩 9 个频道
    assert len(sorted_results) == 9
    assert "空壳卡片台" not in [c.name for c in sorted_results]

    # 验证 2：分组大板块优先级 (央视 0~4, 卫视 5, 地方台 6~7, 其他 8)
    for i in range(5):
        assert sorted_results[i].group == "央视频道", f"Index {i} 分类不是央视频道！"

    assert sorted_results[5].group == "卫视频道"
    assert sorted_results[5].name == "浙江卫视"

    # 地方频道排在卫视后面，且广东频道 (g) 必须排在 浙江频道 (z) 前头
    assert sorted_results[6].group == "广东频道"
    assert sorted_results[6].name == "深圳公共"
    assert sorted_results[7].group == "浙江频道"
    assert sorted_results[7].name == "绍兴新闻"

    # 其他频道垫后
    assert sorted_results[8].group == "其他频道"

    # 验证 3：【核心黑科技断言】CCTV 数字组内的自然排序 (1, 2, 5, 5+, 13)
    assert sorted_results[0].name == "CCTV-1 综合"
    assert sorted_results[1].name == "CCTV-2 财经"
    assert sorted_results[2].name == "CCTV-5 体育"
    assert sorted_results[3].name == "CCTV-5+ 体育赛事"  # 5+ 必须排在 5 后面，13 前面！
    assert sorted_results[4].name == "CCTV-13 新闻"
