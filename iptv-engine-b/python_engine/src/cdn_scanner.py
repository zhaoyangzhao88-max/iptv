import asyncio
import time
import aiohttp
from urllib.parse import urlparse, urljoin
from typing import Dict, List, Optional
from python_engine.src.speedtest import probe_single_url

# 全省广电 CDN 核心规律字典库 (与 Lesson 28 保持一致并适配测试)
CDN_PROVINCIAL_DATABASE = {
    "江苏广电": {
        "domain_pattern": "jsccn.net|江苏有线|江苏有线宽带|南京有线",
        "url_template": "http://{ip_or_domain}/live/{channel_code}/index.m3u8",
        "channel_codes": {
            "cctv1": "cctv1hd",
            "cctv5": "cctv5hd",
            "cctv5+": "cctv5plus",
            "jstv": "jstvhd",
            "dfwt": "dfwthd"
        }
    },
    "四川广电": {
        "domain_pattern": "sctv.com|四川有线|四川广电|成都有线",
        "url_template": "http://{ip_or_domain}/hls/{channel_code}.m3u8",
        "channel_codes": {
            "cctv1": "cctv1",
            "sctv1": "sctv1",
            "sctv2": "sctv2"
        }
    },
    "广东广电": {
        "domain_pattern": "gdtv.cn|广东有线|广东广电|深圳有线",
        "url_template": "http://{ip_or_domain}/{channel_code}/{channel_code}.m3u8",
        "channel_codes": {
            "cctv1": "cctv1",
            "gdtv": "gdtv",
            "sztv": "sztv"
        }
    }
}

def get_provincial_cdn_profile(name: str) -> Optional[dict]:
    """根据省份名称快速检索其 CDN 规律配置模板"""
    return CDN_PROVINCIAL_DATABASE.get(name)

def generate_cdn_channel_url(province_name: str, ip_or_domain: str, channel_key: str) -> Optional[str]:
    """智能规则拼接器"""
    profile = get_provincial_cdn_profile(province_name)
    if not profile:
        return None
    url_template = profile["url_template"]
    channel_codes = profile["channel_codes"]
    local_code = channel_codes.get(channel_key.lower())
    if not local_code:
        return None
    return url_template.format(ip_or_domain=ip_or_domain.strip(), channel_code=local_code)

async def scan_provincial_cdn(
    session: aiohttp.ClientSession,
    province_name: str,
    ip_or_domain: str,
    semaphore: asyncio.Semaphore
) -> List[dict]:
    """
    针对给定的省份广电 IP/域名 进行自动化多协程爆破扫参。
    自动根据字典库生成该省所有存在频道的 M3U8 地址，并发起协程探测。
    返回所有拨测成功（视频切片校验通过）的频道数据结果。
    """
    profile = get_provincial_cdn_profile(province_name)
    if not profile:
        return []

    tasks = []
    # 遍历该省模板里的所有候选频道 (如 cctv1, gdtv, sztv)
    for channel_key in profile["channel_codes"].keys():
        test_url = generate_cdn_channel_url(province_name, ip_or_domain, channel_key)
        if not test_url:
            continue
        # 封装异步并发拨测任务，复用 Phase 4 的 TS级双重安全探针
        tasks.append(
            _probe_and_tag(session, test_url, channel_key, province_name, semaphore)
        )

    # 异步并发执行，回收结果
    results = await asyncio.gather(*tasks)
    # 仅保留测试成功的流，自动丢弃垃圾失效死链
    return [r for r in results if r["success"]]

async def _probe_and_tag(
    session: aiohttp.ClientSession,
    url: str,
    channel_key: str,
    province_name: str,
    semaphore: asyncio.Semaphore
) -> dict:
    """
    内部辅助函数：调用最严苛的 TS 级测速探针，并在成功后自动打上频道名、suggested_group 标签
    """
    probe_result = await probe_single_url(session, url, semaphore, timeout=3.5)
    probe_result["channel_key"] = channel_key
    # 将"广东广电"后缀自动转换为播放分组"广东频道"
    probe_result["suggested_group"] = province_name.replace("广电", "频道")
    return probe_result
