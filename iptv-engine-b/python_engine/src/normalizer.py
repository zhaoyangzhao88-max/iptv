import os
import json
import re
import requests
import difflib
from typing import Dict, Optional, List
from python_engine.src.models import RawStream

# 定义本地轻量化缓存目录与文件路径
CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
CACHE_FILE = os.path.join(CACHE_DIR, "iptv_org_cache.json")

# 模块级懒加载缓存：避免每次 get_channel_metadata 都 open() 读磁盘
_METADATA_CACHE: Optional[dict] = None

IPTV_ORG_API_URLS = [
    "https://iptv-org.github.io/api/channels.json",
    "https://fastly.jsdelivr.net/gh/iptv-org/api@gh-pages/channels.json",
    "https://cdn.jsdelivr.net/gh/iptv-org/api@gh-pages/channels.json"
]

# 各省地方台映射词库
PROVINCE_KEYWORDS = {
    "北京": ["北京", "京", "朝阳", "海淀", "歌华"],
    "上海": ["上海", "沪", "浦东", "东方"],
    "天津": ["天津", "津"],
    "重庆": ["重庆", "渝", "万州"],
    "浙江": ["浙江", "浙", "杭州", "绍兴", "宁波", "温州", "嘉兴", "湖州", "金华", "衢州", "舟山", "台州", "丽水"],
    "广东": ["广东", "粤", "广州", "深圳", "珠海", "汕头", "佛山", "韶关", "湛江", "肇庆", "江门", "茂名", "惠州", "梅州", "汕尾", "河源", "阳江", "清远", "东莞", "中山", "潮州", "揭阳", "云浮"],
    "江苏": ["江苏", "苏", "南京", "无锡", "徐州", "常州", "苏州", "南通", "连云港", "淮安", "盐城", "扬州", "镇江", "泰州", "宿迁"],
    "山东": ["山东", "鲁", "济南", "青岛", "淄博", "枣庄", "东营", "烟台", "潍坊", "济宁", "泰安", "威海", "日照", "临沂", "德州", "聊城", "滨州", "菏泽"],
    "河南": ["河南", "豫", "郑州", "开封", "洛阳", "平顶山", "安阳", "鹤壁", "新乡", "焦作", "濮阳", "许昌", "漯河", "三门峡", "南阳", "商丘", "信阳", "周口", "驻马店", "济源"],
    "湖南": ["湖南", "湘", "长沙", "株洲", "湘潭", "衡阳", "邵阳", "岳阳", "常德", "张家界", "益阳", "郴州", "永州", "怀化", "娄底", "湘西"],
    "湖北": ["湖北", "鄂", "武汉", "黄石", "十堰", "宜昌", "襄阳", "鄂州", "荆门", "孝感", "荆州", "黄冈", "咸宁", "随州", "恩施"],
    "四川": ["四川", "川", "成都", "自贡", "攀枝花", "泸州", "德阳", "绵阳", "广元", "遂宁", "内江", "乐山", "南充", "眉山", "宜宾", "广安", "达州", "雅安", "巴中", "资阳"],
    "福建": ["福建", "闽", "福州", "厦门", "莆田", "三明", "泉州", "漳州", "南平", "龙岩", "宁德"]
}

def clean_channel_name(name: str) -> str:
    """频道名强力去噪引擎"""
    if not name:
        return ""
    name = re.sub(r"\[[^\]]*\]", "", name)
    name = re.sub(r"\([^\)]*\)", "", name)
    name = re.sub(r"【[^】]*】", "", name)
    name = re.sub(r"（[^）]*）", "", name)

    garbage_patterns = [
        r"标清", r"超清", r"蓝光", r"电信", r"联通", r"移动", r"广电", r"50FPS", r"60FPS",
        r"1080P", r"720P", r"2160P", r"HEVC", r"H\.265", r"H265", r"H\.264", r"H264",
        r"IPV6", r"ipv6", r"Ipv6", r"备用", r"测试", r"极速", r"源"
    ]
    for pattern in garbage_patterns:
        name = re.sub(pattern, "", name, flags=re.IGNORECASE)

    name = re.sub(r"[#*_|~`\s]+", " ", name)
    name = re.sub(r"(?i)CCTV[-_\s]*(\d+)(\+?)", lambda m: f"CCTV-{m.group(1)}{m.group(2)}", name)
    name = re.sub(r"(?i)CCTV[-_\s]*(NEWS|Español|Français|العربية|Perviy|E|F|Y|W|G)", lambda m: f"CCTV-{m.group(1).upper()}", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name

def sync_iptv_org_dict() -> bool:
    """全自动同步并轻量化缓存官方频道字典"""
    os.makedirs(CACHE_DIR, exist_ok=True)
    data = None
    last_error = None
    for url in IPTV_ORG_API_URLS:
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                data = response.json()
                break
        except Exception as e:
            last_error = e
            continue
    if not data:
        if os.path.exists(CACHE_FILE):
            return True
        raise RuntimeError(f"同步官方字典失败: {last_error}")
    compressed_cache: Dict[str, dict] = {}
    for item in data:
        name = item.get("name")
        if not name:
            continue
        cleaned_key = clean_channel_name(name).lower()
        if not cleaned_key:
            continue
        compressed_cache[cleaned_key] = {
            "tvg_id": item.get("id"),
            "logo": item.get("logo")
        }
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(compressed_cache, f, ensure_ascii=False, indent=2)
    global _METADATA_CACHE
    _METADATA_CACHE = None  # 使缓存失效，下次 get_channel_metadata 重新加载
    return True

def get_channel_metadata(channel_name: str) -> Optional[dict]:
    """快速获取官方元数据（带模块级懒加载缓存）"""
    global _METADATA_CACHE
    if _METADATA_CACHE is None:
        if not os.path.exists(CACHE_FILE):
            sync_iptv_org_dict()
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                _METADATA_CACHE = json.load(f)
        except Exception:
            _METADATA_CACHE = {}
    if not _METADATA_CACHE:
        return None
    try:
        cleaned_query = clean_channel_name(channel_name).lower()
        if cleaned_query in _METADATA_CACHE:
            return _METADATA_CACHE[cleaned_query]
        all_keys = list(_METADATA_CACHE.keys())
        matches = difflib.get_close_matches(cleaned_query, all_keys, n=1, cutoff=0.8)
        if matches:
            best_match_key = matches[0]
            return _METADATA_CACHE[best_match_key]
    except Exception:
        pass
    return None

def get_channel_group(channel_name: str) -> str:
    """智能规则分流引擎"""
    name_upper = channel_name.strip().upper()
    if "CCTV" in name_upper or "央视" in name_upper:
        return "央视频道"
    if "卫视" in name_upper:
        return "卫视频道"
    for province, keywords in PROVINCE_KEYWORDS.items():
        for kw in keywords:
            if kw in channel_name:
                return f"{province}频道"
    return "其他频道"

def rewrite_special_stream_url(stream: RawStream) -> RawStream:
    """
    【核心新增】：智能重写特殊流媒体 URL（B站、抖音、快手）
    将全网盲扫出来的难以直接播放、带有时效 Token 的原始链接，自动伪装、重写为本地 Node.js 重定向微服务。
    - B站原始: https://live.bilibili.com/26066074 -> http://localhost:3000/api/bilibili/26066074
    - 抖音原始: https://live.douyin.com/775841227732 -> http://localhost:3000/api/douyin/775841227732
    - 快手原始: https://live.kuaishou.com/u/kpl_live -> http://localhost:3000/api/kuaishou/kpl_live
    """
    url = stream.raw_url

    # 1. 正则锁定 B 站直播间
    bili_match = re.search(r"live\.bilibili\.com/(\d+)", url)
    if bili_match:
        room_id = bili_match.group(1)
        stream.raw_url = f"http://localhost:3000/api/bilibili/{room_id}"
        return stream

    # 2. 正则锁定 抖音直播间
    douyin_match = re.search(r"live\.douyin\.com/(\d+)", url)
    if douyin_match:
        room_id = douyin_match.group(1)
        stream.raw_url = f"http://localhost:3000/api/douyin/{room_id}"
        return stream

    # 3. 正则锁定 快手直播间 (/u/ 用户名或数字房间号)
    kuaishou_match = re.search(r"live\.kuaishou\.com/u/([^/?#\s]+)", url)
    if kuaishou_match:
        room_id = kuaishou_match.group(1)
        stream.raw_url = f"http://localhost:3000/api/kuaishou/{room_id}"
        return stream

    return stream
