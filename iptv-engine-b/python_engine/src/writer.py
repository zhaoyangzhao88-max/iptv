import os
import json
from typing import List

# 对标本地 B 程序的默认物理写盘路径
DEFAULT_LOCAL_PATH = r"E:\vscode\iptv-project\data\channels.json"
# CI/GitHub Actions 云端环境下的默认相对备份路径
DEFAULT_CI_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "data",
    "channels.json"
)

def determine_output_path() -> str:
    """
    智能自适应路径计算引擎：
    1. 优先采用系统环境变量 `OUTPUT_PATH`。
    2. 若为本地 Windows 环境，且默认 E 盘开发路径父级目录存在，使用 E:\vscode\iptv-project\data\channels.json 物理直写。
    3. 否则（CI / Actions / 其他系统）优雅回退写入当前项目相对路径 ./data/channels.json，防止报错熔断。
    """
    env_path = os.getenv("OUTPUT_PATH")
    if env_path:
        return env_path

    # 检测 E 盘父级目录是否存在
    parent_dir = os.path.dirname(DEFAULT_LOCAL_PATH)
    if os.path.exists(parent_dir):
        return DEFAULT_LOCAL_PATH

    # Actions 等 CI 平台兜底备份
    return DEFAULT_CI_PATH

def write_channels_json(data: List[dict]) -> str:
    """
    【第 39 课核心新增】：自适应物理写盘。
    1. 自动计算得出最安全的写盘路径。
    2. 物理写入数据，强行锁定 utf-8 编码，且实施 JSON 优雅排版 (indent=2, ensure_ascii=False)。
    3. 返回最终被写入的绝对物理路径。
    """
    output_path = determine_output_path()

    # 确保父级文件夹必须存在
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return output_path


def write_channels_m3u(data: List[dict], output_path: str = None) -> str:
    """
    将频道数据导出为标准 M3U 格式播放列表。
    跳过 is_multicast=True 的频道（组播对公网用户不可用）。
    若未指定 output_path，使用 DEFAULT_LOCAL_PATH 的 .m3u 变体。
    """
    if output_path is None:
        json_path = determine_output_path()
        output_path = json_path.rsplit(".", 1)[0] + ".m3u"

    lines = ["#EXTM3U"]
    for ch in data:
        urls = ch.get("urls", [])
        if not urls:
            continue
        if ch.get("is_multicast", False):
            continue  # 组播源对公网不可用
        name = ch.get("name", "")
        group = ch.get("group", "")
        logo = ch.get("logo", "")
        tvg_id = ch.get("tvg_id", "")

        attrs = []
        if tvg_id:
            attrs.append(f'tvg-id="{tvg_id}"')
        if name:
            attrs.append(f'tvg-name="{name}"')
        if logo:
            attrs.append(f'tvg-logo="{logo}"')
        if group:
            attrs.append(f'group-title="{group}"')

        lines.append(f'#EXTINF:-1 {" ".join(attrs)},{name}')
        lines.append(urls[0])

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    return output_path
