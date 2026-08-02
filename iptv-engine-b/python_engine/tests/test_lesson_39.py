import os
import pytest
from unittest.mock import patch
from python_engine.src.writer import determine_output_path, write_channels_json, DEFAULT_LOCAL_PATH, DEFAULT_CI_PATH

def test_determine_output_path_env_override():
    """测试自适应计算：OUTPUT_PATH 环境变量具有至高无上的绝对优先权"""
    with patch.dict(os.environ, {"OUTPUT_PATH": "/tmp/test_out.json"}):
        path = determine_output_path()
        assert path == "/tmp/test_out.json"

def test_determine_output_path_ci_fallback():
    """Without an override, local and CI runs use the shared player snapshot."""
    with patch.dict(os.environ, {}, clear=True):
        assert determine_output_path() == DEFAULT_CI_PATH

def test_write_channels_json_pretty_formatting(tmp_path):
    """测试物理写盘：验证 JSON 被成功物理写入，且格式排版排版精美（带缩进）"""
    test_channels_data = [{"name": "CCTV-1", "urls": ["http://ok.com"]}]
    temp_target_file = os.path.join(tmp_path, "channels.json")

    with patch.dict(os.environ, {"OUTPUT_PATH": temp_target_file}):
        written_path = write_channels_json(test_channels_data)

        # 必须写入成功
        assert written_path == temp_target_file
        assert os.path.exists(temp_target_file)

        # 检验缩进排版 (必须有缩进和换行)
        with open(temp_target_file, "r", encoding="utf-8") as f:
            content = f.read()
            assert "[\n  {\n" in content, "JSON 写入排版格式不正确，缺少换行和缩进！"
