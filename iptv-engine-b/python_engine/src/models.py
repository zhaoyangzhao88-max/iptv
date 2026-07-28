from pydantic import BaseModel, Field, HttpUrl, field_validator
from typing import List, Optional

class Channel(BaseModel):
    """
    终端输出的频道标准数据模型 (完全对齐 B 端前端播放器的 JSON 契约)
    """
    name: str = Field(..., description="频道标准名称，如 '绍兴新闻综合'")
    group: str = Field(default="其他频道", description="频道所属分组，如 '浙江地方台'")
    urls: List[str] = Field(default_factory=list, description="多线路备用数组，按延迟排序")
    delay_ms: int = Field(default=0, description="主线路的物理延迟(毫秒)")
    logo: Optional[str] = Field(default=None, description="频道台标 URL")
    tvg_id: Optional[str] = Field(default=None, description="标准电子节目单(EPG)的身份证号")
    is_multicast: bool = Field(default=False, description="是否为组播/专网源(含/udp/或/rtp/)")

    @field_validator('urls')
    @classmethod
    def check_urls_limit(cls, v):
        """确保备用线不能无限制塞入，B端要求最多保留 1主线 + 3备用线 = 4条"""
        if len(v) > 4:
            return v[:4]
        return v

class RawStream(BaseModel):
    """
    爬虫抓取到的原始未清洗数据模型 (内存级临时对象)
    """
    raw_url: str = Field(..., description="原始播放链接")
    raw_name: str = Field(..., description="M3U中解析出的原始名字(可能带有广告或后缀)")
    raw_group: Optional[str] = Field(default=None, description="原始分类")
    tvg_logo: Optional[str] = Field(default=None, description="原始自带台标")
