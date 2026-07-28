# ⚠️ 运行方式: 在项目根目录执行 python -m pytest python_engine/tests/test_lesson_2.py -v
import pytest
from pydantic import ValidationError
from python_engine.src.models import Channel, RawStream

def test_channel_contract_compliance():
    """测试 Channel 对象是否严格遵守与 B 端播放器的数据通信契约"""
    # 模拟我们清洗后的一条完美数据
    channel = Channel(
        name="绍兴新闻综合",
        group="浙江地方台",
        urls=[
            "http://live.shaoxing.com/1.m3u8",
            "http://live.shaoxing.com/2.m3u8"
        ],
        delay_ms=25,
        logo="https://logo.com/sxtv1.png"
    )

    # 转换为字典，模拟最终要写入 channels.json 的格式
    data = channel.model_dump(exclude_none=True)

    assert data["name"] == "绍兴新闻综合"
    assert "urls" in data and len(data["urls"]) == 2
    assert data["delay_ms"] == 25
    assert data["logo"] == "https://logo.com/sxtv1.png"

def test_channel_urls_limit():
    """测试安检门：超过 4 条线路时，自动截断保留前 4 条"""
    channel = Channel(
        name="CCTV-1",
        urls=["url1", "url2", "url3", "url4", "url5", "url6"]
    )
    assert len(channel.urls) == 4, "线路安检门失效，未自动截断备用线！"

def test_channel_missing_required():
    """测试安检门：缺少必填项(name)时必须报错拦截"""
    with pytest.raises(ValidationError):
        Channel(urls=["http://test.com"], delay_ms=10)

def test_raw_stream_creation():
    """测试原始抓取对象能否正常创建"""
    stream = RawStream(raw_url="http://fake.com/a.ts", raw_name=" CCTV-1 (1080P) [电信] ")
    assert stream.raw_url == "http://fake.com/a.ts"
    assert stream.raw_name == " CCTV-1 (1080P) [电信] "
