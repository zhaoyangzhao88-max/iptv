import pytest
from unittest.mock import MagicMock, patch

from python_engine.src.models import RawStream
from python_engine.src.parser import parse_m3u_content, expand_m3u_streams
from python_engine.src.request_client import smart_request_get
from python_engine.src.url_policy import is_safe_fetch_url


def test_url_policy_rejects_local_and_non_http_targets(monkeypatch):
    assert not is_safe_fetch_url("file:///tmp/source.m3u")
    assert not is_safe_fetch_url("http://127.0.0.1/source.m3u")
    assert not is_safe_fetch_url("http://169.254.169.254/latest/meta-data")
    assert not is_safe_fetch_url("http://user:pass@example.com/source.m3u")
    monkeypatch.setattr("python_engine.src.url_policy.socket.getaddrinfo", lambda *args, **kwargs: [(None, None, None, None, ("10.0.0.2", 0))])
    assert not is_safe_fetch_url("https://private.example/source.m3u")


def test_request_client_rejects_private_target():
    with pytest.raises(ValueError, match="unsafe HTTP"):
        smart_request_get("http://127.0.0.1/private.m3u")




def test_request_client_rejects_oversized_response():
    response = MagicMock(status_code=200, headers={}, iter_content=lambda **kwargs: [b"x" * (4 * 1024 * 1024 + 1)])
    with patch("python_engine.src.request_client.requests.get", return_value=response), patch(
        "python_engine.src.request_client.is_safe_fetch_url", return_value=True
    ):
        with pytest.raises(ValueError, match="maximum size"):
            smart_request_get("https://public.example/source.m3u")


def test_request_client_rejects_redirect_to_private_target():
    response = MagicMock(status_code=302, headers={"Location": "http://127.0.0.1/private.m3u"})
    with patch("python_engine.src.request_client.requests.get", return_value=response), patch(
        "python_engine.src.request_client.is_safe_fetch_url", return_value=True
    ):
        with pytest.raises(ValueError, match="unsafe redirect"):
            smart_request_get("https://public.example/source.m3u")


def test_parser_rejects_oversized_input_and_caps_entries():
    content = "\n".join(
        ["#EXTM3U"]
        + [f"#EXTINF:-1,Channel {index}\nhttps://public.example/{index}.m3u8" for index in range(5)]
    )
    assert parse_m3u_content("x" * 20, max_bytes=10) == []
    streams = parse_m3u_content(content, max_entries=2)
    assert len(streams) == 2


def test_expander_global_nested_playlist_cap(monkeypatch):
    responses = {
        "https://public.example/one.m3u": "#EXTM3U\n#EXTINF:-1,One\nhttps://public.example/one.m3u8",
        "https://public.example/two.m3u": "#EXTM3U\n#EXTINF:-1,Two\nhttps://public.example/two.m3u8",
    }

    def request(url, **kwargs):
        return MagicMock(status_code=200, text=responses[url])

    monkeypatch.setattr("python_engine.src.parser.smart_request_get", request)
    streams = [
        RawStream(raw_url=url, raw_name=url)
        for url in responses
    ]
    expanded = expand_m3u_streams(streams, max_nested_playlists=1)
    assert [stream.raw_url for stream in expanded] == ["https://public.example/one.m3u8"]
    response = MagicMock(status_code=200, text="#EXTM3U\n#EXTINF:-1,Child\nhttps://public.example/live.m3u8")
    monkeypatch.setattr("python_engine.src.parser.smart_request_get", lambda *args, **kwargs: response)
    streams = [
        RawStream(raw_url="https://public.example/one.m3u", raw_name="One"),
        RawStream(raw_url="https://public.example/two.m3u", raw_name="Two"),
    ]
    expanded = expand_m3u_streams(streams, max_nested_playlists=1)
    assert len(expanded) == 1
    assert expanded[0].raw_url.endswith("live.m3u8")
