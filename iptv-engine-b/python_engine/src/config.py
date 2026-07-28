"""
v1 兼容配置垫片 (Shim)
========================
为从 v1 引擎抢救的 _from_v1.py 模块提供 HEADERS、路径常量及 output_path() 接口。
路径锚定基于 v2 的 python_engine/ 目录结构。
"""

import os
import sys

# python_engine/ 作为 BASE_DIR
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 输出目录统一指向 python_engine/data/
OUTPUT_DIR = os.path.join(BASE_DIR, "data")
DATA_DIR = os.path.join(BASE_DIR, "data")

# 默认 HTTP 请求头
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.google.com/",
}


def output_path(filename: str) -> str:
    """
    返回 OUTPUT_DIR 下的完整文件路径。
    若 OUTPUT_DIR 不存在，自动创建。
    """
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    return os.path.join(OUTPUT_DIR, filename)
