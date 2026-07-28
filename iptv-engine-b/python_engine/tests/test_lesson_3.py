# ⚠️ 运行方式: 在项目根目录执行 python -m pytest python_engine/tests/test_lesson_3.py -v
import os
import json
from unittest.mock import patch, MagicMock
from python_engine.src.normalizer import sync_iptv_org_dict, get_channel_metadata, CACHE_FILE

def test_sync_and_compress_logic():
    """测试字典同步、去噪与极限轻量化压缩的完整逻辑"""
    # 模拟官方 API 返回的巨型混杂数据
    mock_api_data = [
        {
            "id": "CCTV1.cn",
            "name": "CCTV 1",
            "logo": "https://iptv-org.github.io/logos/CCTV1.png",
            "country": "CN",
            "languages": ["zho"],
            "broadcast_area": ["c/CN"]
        },
        {
            "id": "HBO.us",
            "name": "HBO",
            "logo": "https://iptv-org.github.io/logos/HBO.png",
            "country": "US",
            "languages": ["eng"],
            "broadcast_area": ["c/US"]
        }
    ]

    # 拦截 requests.get，替换为我们的模拟器，防止网络波动干扰
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_api_data

    with patch("requests.get", return_value=mock_response) as mock_get:
        # 执行压缩同步
        success = sync_iptv_org_dict()

        assert success is True
        assert mock_get.called
        assert os.path.exists(CACHE_FILE)

        # 检验生成的缓存是否成功扔掉了无用字段（极限瘦身）
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            cache = json.load(f)

        # normalizer 将 "CCTV 1" 标准化为 "cctv-1"（空格→连字符）
        assert "cctv-1" in cache
        assert cache["cctv-1"]["tvg_id"] == "CCTV1.cn"
        assert cache["cctv-1"]["logo"] == "https://iptv-org.github.io/logos/CCTV1.png"
        assert "country" not in cache["cctv-1"], "元数据剔除失败，无用字段仍然存在于缓存中！"

def test_get_channel_metadata_lookup():
    """测试元数据查询工具是否支持大小写、空格模糊容错匹配"""
    # 查询大写、带空格的名称，检验容错性
    meta = get_channel_metadata("  Cctv 1  ")
    assert meta is not None, "元数据检索匹配失败！"
    assert meta["tvg_id"] == "CCTV1.cn"
    assert meta["logo"] == "https://iptv-org.github.io/logos/CCTV1.png"

    # 查询不存在的频道应该优雅返回 None
    assert get_channel_metadata("NonExistentChannel") is None
