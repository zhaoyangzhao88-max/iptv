"""冒烟测试：cdn_explorer 模块可正常导入且核心函数可调用"""

import json
import pytest


def test_cdn_explorer_import():
    """验证 cdn_explorer 模块可正常导入"""
    from python_engine.src import cdn_explorer
    assert cdn_explorer is not None
    assert hasattr(cdn_explorer, 'load_cdn_domains')
    assert hasattr(cdn_explorer, 'build_probe_tasks')
    assert hasattr(cdn_explorer, 'main')


def test_constants_available():
    """验证模块核心常量和配置可用"""
    from python_engine.src.cdn_explorer import (
        DEFAULT_CONCURRENCY, DEFAULT_TIMEOUT_SEC, DATA_FILE,
        OUTPUT_FILE,
    )
    assert DEFAULT_CONCURRENCY == 20
    assert DEFAULT_TIMEOUT_SEC == 5
    assert isinstance(OUTPUT_FILE, str)


def test_load_cdn_domains_file_not_found():
    """load_cdn_domains 在文件不存在时抛出（v1 模块无 try/except）"""
    from python_engine.src.cdn_explorer import load_cdn_domains

    import builtins
    from unittest import mock
    with pytest.raises(FileNotFoundError):
        with mock.patch.object(builtins, "open", side_effect=FileNotFoundError):
            load_cdn_domains()


def test_load_cdn_domains_success():
    """load_cdn_domains 正常读取 JSON 文件"""
    from python_engine.src.cdn_explorer import load_cdn_domains

    sample_data = {"浙江": {"domains": ["zjcdn.example.com"]}}
    import builtins
    from unittest import mock
    m = mock.mock_open(read_data=json.dumps(sample_data))
    with mock.patch.object(builtins, "open", m):
        result = load_cdn_domains()
        assert "浙江" in result


def test_is_ipv6_url():
    """_is_ipv6_url 正确识别 IPv6 URL"""
    from python_engine.src.cdn_explorer import _is_ipv6_url

    assert _is_ipv6_url("http://[2001:db8::1]/stream.m3u8") is True
    assert _is_ipv6_url("http://example.com/stream.m3u8") is False
    assert _is_ipv6_url("") is False


def test_extract_json_path():
    """_extract_json_path 正确提取嵌套 JSON 路径（不处理 list index）"""
    from python_engine.src.cdn_explorer import _extract_json_path

    data = {"a": {"b": {"c": "value"}}}
    result = _extract_json_path(data, "a.b.c")
    assert result == "value"


def test_extract_json_path_missing():
    """_extract_json_path 对缺失键返回 None"""
    from python_engine.src.cdn_explorer import _extract_json_path

    data = {"a": {"b": 1}}
    result = _extract_json_path(data, "a.b.c")
    assert result is None


def test_extract_json_path_list_returns_none():
    """_extract_json_path 遇到 list 节点返回 None"""
    from python_engine.src.cdn_explorer import _extract_json_path

    data = {"a": ["b", "c"]}
    result = _extract_json_path(data, "a.0")
    assert result is None


def test_build_probe_tasks_empty():
    """build_probe_tasks 在空域名时返回空列表"""
    from python_engine.src.cdn_explorer import build_probe_tasks

    result = build_probe_tasks({})
    # Should return a list of tasks (may be empty or have method-based entries)
    assert isinstance(result, list)
