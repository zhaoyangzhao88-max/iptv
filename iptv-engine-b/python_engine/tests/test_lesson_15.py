import os
from unittest.mock import patch
from python_engine.src.pipeline import run_phase3_pipeline
from python_engine.src.reputation import update_reputation_score

def test_phase3_pipeline_end_to_end_conformance(tmp_path):
    """测试前三阶段集成流水线：原始源盲扫 -> 格式大一统 -> 排除0分死链 -> 最终输出格式 100% 契合前端契约"""
    # 模拟输入：一个含有 3 个流的原始 M3U 文本
    m3u_input = """#EXTM3U
#EXTINF:-1,CCTV1 [FHD] (电信)
http://cctv.com/cctv1.m3u8
#EXTINF:-1,湖南卫视 HD
http://hntv.com/hn.m3u8
#EXTINF:-1,浙江卫视高清
http://zjtv.com/zj.m3u8
"""

    # 产生测试专用的隔离路径文件，防止污染真正的 history_scores.json
    temp_scores_file = os.path.join(tmp_path, "history_scores.json")

    with patch("python_engine.src.reputation.REPUTATION_FILE", temp_scores_file):
        # 1. 模拟现实情况：浙江卫视的线路太烂，被连续扣分扣到 0 分，拉入黑名单
        for _ in range(5):
            update_reputation_score("http://zjtv.com/zj.m3u8", success=False)

        # 2. 一键跑通前三阶段流水线
        final_json_list = run_phase3_pipeline([m3u_input])

        # 3. 深度验证：
        # 积分为 100 的 CCTV-1 与 湖南卫视 必须被完好保留
        # 积分被扣光到 0 的 浙江卫视 必须被整台丢弃，杜绝在播放器里引起卡死转圈
        assert len(final_json_list) == 2

        # 4. 严丝合缝校验输出的 JSON 结构，验证是否完全符合 B 端播放器要求
        cctv = next(c for c in final_json_list if c["name"] == "CCTV-1")
        assert cctv["group"] == "央视频道"
        assert cctv["urls"] == ["http://cctv.com/cctv1.m3u8"]
        assert "delay_ms" in cctv

        hn = next(c for c in final_json_list if c["name"] == "湖南卫视 HD")
        assert hn["group"] == "卫视频道"
        assert hn["urls"] == ["http://hntv.com/hn.m3u8"]
