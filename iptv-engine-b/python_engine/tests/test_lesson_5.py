import pytest
from unittest.mock import patch, MagicMock
from python_engine.src.request_client import is_ipv6_supported, clean_github_url, smart_request_get

def test_clean_github_url():
    """测试 GitHub 加速拼装逻辑"""
    raw_url = "https://github.com/iptv-org/api/channels.json"
    proxied = clean_github_url(raw_url, "https://mirror.ghproxy.com")
    assert proxied == "https://mirror.ghproxy.com/https://github.com/iptv-org/api/channels.json"

    # 正常非 GitHub URL 不应拼接代理
    normal_url = "https://baidu.com"
    assert clean_github_url(normal_url, "https://mirror.ghproxy.com") == normal_url

def test_ipv6_detection_runnable():
    """验证 IPv6 检测模块能返回 bool 且不崩溃"""
    assert isinstance(is_ipv6_supported(), bool)

def test_ipv6_blocking_logic():
    """测试当本机不支持 IPv6 且目标是 IPv6 地址时，必须触发闪避阻断"""
    ipv6_url = "http://[2001:4860:4860::8888]/index.m3u8"

    with patch("python_engine.src.request_client.is_ipv6_supported", return_value=False):
        with pytest.raises(ConnectionError) as exc:
            smart_request_get(ipv6_url)
        assert "不支持 IPv6" in str(exc.value)

@patch("requests.get")
def test_github_proxy_fallback_retry(mock_get):
    """测试 GitHub 专属容错：直连失败后能调用代理重试"""
    github_url = "https://github.com/test/source.m3u"

    # 第一次直连抛错，第二次通过代理成功
    mock_success = MagicMock()
    mock_success.status_code = 200

    mock_get.side_effect = [Exception("Direct connect failed"), mock_success]

    res = smart_request_get(github_url)
    assert res.status_code == 200
    assert mock_get.call_count == 2
