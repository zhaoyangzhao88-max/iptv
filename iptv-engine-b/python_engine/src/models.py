from pydantic import BaseModel, Field, field_validator
from typing import List, Optional


class Channel(BaseModel):
    """
    终端输出的频道标准数据模型 (完全对齐 B 端前端播放器的 JSON 契约)
    """
    name: str = Field(..., min_length=1, description="频道标准名称，如 '绍兴新闻综合'")
    group: str = Field(default="其他频道", min_length=1, description="频道所属分组，如 '浙江地方台'")
    # Aggregation stages may temporarily hold more than four routes; the
    # validator keeps the historical intermediate behavior, while the writer
    # rejects empty publication records.
    urls: List[str] = Field(default_factory=list, description="多线路备用数组，按延迟排序")
    delay_ms: int = Field(default=0, ge=0, description="主线路的物理延迟(毫秒)")
    logo: Optional[str] = Field(default=None, description="频道台标 URL")
    tvg_id: Optional[str] = Field(default=None, description="标准电子节目单(EPG)的身份证号")
    is_multicast: bool = Field(default=False, description="是否为组播/专网源(含/udp/或/rtp/)")
    risk_flags: List[str] = Field(default_factory=list, description="传输或来源风险标记")

    @field_validator("name", "group", "logo", "tvg_id")
    @classmethod
    def reject_blank_strings(cls, value):
        if value is not None and not value.strip():
            raise ValueError("string fields must not be blank")
        return value.strip() if isinstance(value, str) else value

    @field_validator("urls")
    @classmethod
    def normalize_urls(cls, value):
        normalized = [url.strip() for url in value]
        if any(not url for url in normalized):
            raise ValueError("urls must contain non-empty strings")
        return normalized[:4]

    def publication_errors(self) -> list[str]:
        if not self.urls:
            return ["urls must contain at least one route"]
        return []


class RawStream(BaseModel):
    """
    爬虫抓取到的原始未清洗数据模型 (内存级临时对象)
    """
    raw_url: str = Field(..., description="原始播放链接")
    raw_name: str = Field(..., description="M3U中解析出的原始名字(可能带有广告或后缀)")
    raw_group: Optional[str] = Field(default=None, description="原始分类")
    tvg_logo: Optional[str] = Field(default=None, description="原始自带台标")
    source_id: Optional[str] = Field(default=None, description="所属授权播放源标识")
