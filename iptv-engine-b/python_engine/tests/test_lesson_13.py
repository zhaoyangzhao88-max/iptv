import pytest
from unittest.mock import patch, MagicMock
from python_engine.src.normalizer import sync_iptv_org_dict, get_channel_metadata

@patch("requests.get")
def test_smart_logo_fuzzy_matching_and_unification(mock_get):
    """测试官方 Key 标准化与 fuzzy 模糊相似匹配补全 Logo 功能"""
    # 模拟官方 API，包含了带空格的 "CCTV 1" 名字
    mock_api_data = [
        {
            "id": "CCTV1.cn",
            "name": "CCTV 1",  # 官方带空格
            "logo": "https://iptv-org.github.io/logos/CCTV1.png"
        },
        {
            "id": "ZhejiangTV.cn",
            "name": "Zhejiang TV",
            "logo": "https://iptv-org.github.io/logos/ZhejiangTV.png"
        }
    ]

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_api_data
    mock_get.return_value = mock_response

    # 强制执行一次同步，让官方 Key 通过 clean_channel_name 写入本地缓存
    sync_iptv_org_dict()

    # 【精准去噪匹配】
    # 抓取的流是 cctv-1，官方名字是 "CCTV 1"，因为双向去燥清洗，现在它们 clean 后都是 "cctv-1"
    meta_exact = get_channel_metadata("cctv-1")
    assert meta_exact is not None
    assert meta_exact["tvg_id"] == "CCTV1.cn"
    assert meta_exact["logo"] == "https://iptv-org.github.io/logos/CCTV1.png"

    # 【Fuzzy 模糊字距匹配 (相似度 > 0.8)】
    # 抓取的流是 "Zhejiang TV HD" (美容清洗后是 "Zhejiang TV HD")
    # 官方只有 "Zhejiang TV"，字符极其相似。difflib 引擎应当能自动匹配上并补全 Logo！
    meta_fuzzy = get_channel_metadata("Zhejiang TV HD")
    assert meta_fuzzy is not None, "模糊台标匹配引擎失效！"
    assert meta_fuzzy["tvg_id"] == "ZhejiangTV.cn"
    assert meta_fuzzy["logo"] == "https://iptv-org.github.io/logos/ZhejiangTV.png"
