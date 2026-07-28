"""冒烟测试：cdn_probe 模块可正常导入且核心函数可调用"""

import json
import pytest


def test_cdn_probe_import():
    """验证 cdn_probe 模块可正常导入"""
    from python_engine.src import cdn_probe
    assert cdn_probe is not None
    assert hasattr(cdn_probe, 'load_channels')
    assert hasattr(cdn_probe, 'extract_pltv_channels')
    assert hasattr(cdn_probe, 'main')


def test_load_channels_file_not_found():
    """load_channels 在文件不存在时抛出 FileNotFoundError（v1 模块无 try/except）"""
    from python_engine.src.cdn_probe import load_channels

    with pytest.raises(FileNotFoundError):
        # 不 mock open，直接调用会触发真实文件查找
        # 使用 mock 验证：当 open 抛出 FileNotFoundError 时透传
        import builtins
        from unittest import mock
        with mock.patch.object(builtins, "open", side_effect=FileNotFoundError):
            load_channels()


def test_extract_pltv_channels_empty():
    """extract_pltv_channels 在空列表时返回空集合"""
    from python_engine.src.cdn_probe import extract_pltv_channels

    channel_ids, cdn_nodes, service_codes = extract_pltv_channels([])
    assert len(channel_ids) == 0
    assert len(cdn_nodes) == 0
    assert len(service_codes) == 0


def test_extract_pltv_channels_parse():
    """extract_pltv_channels 正确解析 PLTV URL 格式"""
    from python_engine.src.cdn_probe import extract_pltv_channels

    channels = [
        {"name": "CCTV-1", "urls": ["http://192.168.1.1/PLTV/888/224/123456/index.m3u8"]}
    ]
    channel_ids, cdn_nodes, service_codes = extract_pltv_channels(channels)
    assert len(channel_ids) == 1
    assert "CCTV-1" in channel_ids
