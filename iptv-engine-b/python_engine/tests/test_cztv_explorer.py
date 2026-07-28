"""冒烟测试：cztv_explorer 模块可正常导入且核心函数可调用"""

import json
import pytest


def test_cztv_explorer_import():
    """验证 cztv_explorer 模块可正常导入"""
    from python_engine.src import cztv_explorer
    assert cztv_explorer is not None
    assert hasattr(cztv_explorer, 'load_channels')
    assert hasattr(cztv_explorer, 'extract_cztv_codes')
    assert hasattr(cztv_explorer, 'main')


def test_load_channels_file_not_found():
    """load_channels 在文件不存在时抛出 FileNotFoundError（v1 模块无 try/except）"""
    from python_engine.src.cztv_explorer import load_channels

    import builtins
    from unittest import mock
    with pytest.raises(FileNotFoundError):
        with mock.patch.object(builtins, "open", side_effect=FileNotFoundError):
            load_channels()


def test_extract_cztv_codes_empty():
    """extract_cztv_codes 在空列表时返回空元组"""
    from python_engine.src.cztv_explorer import extract_cztv_codes

    result = extract_cztv_codes([])
    assert isinstance(result, tuple)
    assert len(result) == 2


def test_extract_cztv_codes_matches():
    """extract_cztv_codes 正确匹配 CZTV URL 格式"""
    from python_engine.src.cztv_explorer import extract_cztv_codes

    channels = [
        {"name": "浙江卫视", "urls": ["http://cztvcloud.example.com/channels/lantian/ZJTV1/1080p.m3u8"]}
    ]
    result = extract_cztv_codes(channels)
    local_map, prov_map = result
    assert len(local_map) > 0 or len(prov_map) > 0
