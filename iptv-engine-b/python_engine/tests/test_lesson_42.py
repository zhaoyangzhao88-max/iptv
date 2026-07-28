"""
Lesson 42: 组播源标记与隔离 (Multicast Source Marking)
覆盖 models.py 的 is_multicast 字段与 merger.py 的组播检测逻辑（Task 1.2）
"""
import pytest
from typing import List
from python_engine.src.models import Channel, RawStream
from python_engine.src.merger import (
    sort_channel_urls_with_priority,
    merge_priority_channels,
    export_channels_to_list
)


class TestChannelModelIsMulticast:
    """Channel 模型 is_multicast 字段测试"""

    def test_default_false(self):
        """新建频道默认 is_multicast=False"""
        ch = Channel(name="CCTV-1", urls=["http://example.com/live.m3u8"])
        assert ch.is_multicast is False

    def test_explicit_true(self):
        """可显式设置 is_multicast=True"""
        ch = Channel(name="CCTV-1", urls=["http://example.com/live.m3u8"], is_multicast=True)
        assert ch.is_multicast is True

    def test_explicit_false(self):
        """可显式设置 is_multicast=False"""
        ch = Channel(name="CCTV-1", urls=["http://example.com/live.m3u8"], is_multicast=False)
        assert ch.is_multicast is False


class TestSortChannelMulticastMarking:
    """sort_channel_urls_with_priority 的组播标记测试"""

    def test_udp_url_marks_multicast(self):
        """包含 /udp/ URL 的频道被标记为组播"""
        channels = [
            Channel(name="Test", urls=["http://192.168.1.1:8080/udp/1234"])
        ]
        result = sort_channel_urls_with_priority(channels, {})
        assert result[0].is_multicast is True

    def test_rtp_url_marks_multicast(self):
        """包含 /rtp/ URL 的频道被标记为组播"""
        channels = [
            Channel(name="Test", urls=["http://10.0.0.1:8888/rtp/233.50.1.1:1234"])
        ]
        result = sort_channel_urls_with_priority(channels, {})
        assert result[0].is_multicast is True

    def test_http_only_not_multicast(self):
        """纯 HTTP M3U8 频道不被标记为组播"""
        channels = [
            Channel(name="CCTV-1", urls=["http://cdn.example.com/live.m3u8",
                                          "http://backup.example.com/stream.m3u8"])
        ]
        result = sort_channel_urls_with_priority(channels, {})
        assert result[0].is_multicast is False

    def test_mixed_urls_multicast_true(self):
        """混合组播+公网 URL 标记为组播"""
        channels = [
            Channel(name="Test", urls=["http://cdn.example.com/live.m3u8",
                                       "http://192.168.1.1:8080/rtp/233.50.1.1:1234"])
        ]
        result = sort_channel_urls_with_priority(channels, {})
        assert result[0].is_multicast is True


class TestExportChannelsMulticastField:
    """export_channels_to_list 序列化测试"""

    def test_multicast_field_in_export(self):
        """is_multicast 字段被正确序列化到 JSON"""
        channels = [
            Channel(name="Test", urls=["http://192.168.1.1/udp/1234"], is_multicast=True),
            Channel(name="Normal", urls=["http://cdn.example.com/live.m3u8"], is_multicast=False)
        ]
        exported = export_channels_to_list(channels)
        assert len(exported) == 2
        assert exported[0]["is_multicast"] is True
        assert exported[1]["is_multicast"] is False


class TestMergePriorityChannelsMulticast:
    """merge_priority_channels 组播标记测试"""

    def test_udp_url_new_channel_multicast(self):
        """通过 priority_streams 传入 /udp/ URL，新频道应标记为组播"""
        priority = [{"url": "http://192.168.1.1/udp/1234", "channel_key": "Test", "delay_ms": 10}]
        result = merge_priority_channels([], priority)
        assert len(result) == 1
        assert result[0].is_multicast is True

    def test_http_url_new_channel_not_multicast(self):
        """通过 priority_streams 传入纯 HTTP URL，新频道不标记组播"""
        priority = [{"url": "http://cdn.example.com/live.m3u8", "channel_key": "Test", "delay_ms": 10}]
        result = merge_priority_channels([], priority)
        assert len(result) == 1
        assert result[0].is_multicast is False
