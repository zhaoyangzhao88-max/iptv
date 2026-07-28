# 🛸 IPTV-Engine-B（数据发动机）技术交底与后期运维保养说明书

本交底书专为 **IPTV-Engine-B（数据发动机）** 后端数据采集、自动清洗、分层测速、动态流媒体解析 API 服务量身定制。旨在让系统使用者能够轻松理解系统架构、进行日常本地调试、并在云端部署后进行长期无人值守式的维护。

---

## 📂 第一部分：系统定位与"双星解耦"物理布局

本项目采用"双星解耦"架构，与前端播放器（B 程序，位于 `E:\vscode\iptv-project`）处于完全无状态的解耦状态。

### 1. 物理目录结构
```text
E:\vscode\iptv-engine-b\
├── python_engine/             # Python 核心数据爬取、清洗、测速模块
│   ├── src/                   # 核心源码区
│   │   ├── main.py            # 全链路总阀门（一键点火入口）
│   │   ├── request_client.py  # 全局智能 HTTP 请求包（IPv6闪避 + GitHub代理）
│   │   ├── fetcher.py         # M3U 盲扫高并发下载器
│   │   ├── parser.py          # M3U 像素解析器与递归套娃解包器
│   │   ├── blocklist.py       # 黑名单拦截雷达
│   │   ├── normalizer.py      # 频道美容去燥与 80% 相似度台标/EPG 匹配
│   │   ├── merger.py          # 同名多线归一、极品源抢占、双层排序与分类大编排
│   │   └── reputation.py      # 信誉评分管理器（高性能单读单写批处理）
│   ├── data/                  # 历史数据与缓存区
│   │   ├── iptv_org_cache.json  # 官方百万频道瘦身缓存字典（10MB -> 1MB）
│   │   └── history_scores.json  # 【唯一资产】本地信誉分功德簿（无 SQLite 依赖）
│   └── requirements.txt       # Python 运行依赖清单
├── node_api/                  # Node.js 动态解析微服务模块
│   ├── src/
│   │   └── redirect_api.js    # Express 微服务（B站/抖音/快手动态解析 + 60秒防风控缓存池）
│   └── package.json           # Node 依赖
└── .github/workflows/
    └── sync.yml               # GitHub Actions 云端 12 小时定时自愈运行脚本
```

### 2. 数据流单向契约

```text
[全网 M3U 源] ──fetch──▶ [原始 RawStream] ──parse──▶ [去噪 Channel]
                                          │
                              ┌───────────┼───────────┐
                              ▼           ▼           ▼
                         [黑名单]    [TS测速]    [信誉分]
                              │           │           │
                              └─────┬─────┘───────────┘
                                    ▼
                         [排序 → 编排 → 契约 JSON]
                                    │
                                    ▼
                    E:\vscode\iptv-project\data\channels.json
                              （B 程序唯一数据入口）
```

> **核心原则**：A 程序（本机）只负责"生产数据"，B 程序（播放器）只负责"消费数据"。两者之间唯一的物理耦合点就是 `channels.json` 这一个文件。A 程序可以随时停机、升级、推倒重来，B 程序完全无感。

---

## ⚙️ 第二部分：全链路 14 步流水线引擎详解

`main.py` 是整个系统的总阀门。执行 `python -m python_engine.src.main` 即可一键点火，触发以下 14 步全自动流水线：

| 步骤 | 教程 | 功能 | 输入 | 输出 |
|:---:|:---:|------|------|------|
| 1 | 第 6 课 | 并发盲扫 5 大 GitHub M3U 播放源 | 预设源 URL 字典 | `raw_m3u_dict: Dict[str, str]` |
| 2 | 第 7 课 | M3U `#EXTINF` 像素级属性拆解 | 原始 M3U 文本 | `List[RawStream]` |
| 3 | 第 8 课 | 套娃子列表递归自动下钻展开 | 含嵌套 M3U 的流列表 | 展开后的 `List[RawStream]` |
| 4 | 第 9 课 | 黑名单恶意域名/广告特征拦截 | 全部展开流 | 清洗后的 `List[RawStream]` |
| 5 | 第 11-12 课 | 频道名强力去噪 + 同名多线合并 | 清洗流 | `List[Channel]`（粗归并） |
| 6 | 第 32 课 | 极品源（广电/酒店）无条件置顶抢占 | 频道列表 + 优先流 | 合并后的 `List[Channel]` |
| 7 | 第 16-21 课 | 千协程异步 TS 分片级测速 + 302 拦截 | 全部 URL | `List[ProbeResult]` |
| 8 | 第 22 课 | 高性能批量信誉分结算与写入 | 测速结果 | 更新 `history_scores.json` |
| 9 | 第 33 课 | 失效源清淤（信誉 ≤ 0 斩首 + 空壳台剔除） | 频道 + 信誉分 | 存活频道列表 |
| 10 | 第 34 课 | 双层主备线分级排序（Tier1 极品前置 + 延迟升序） | 频道 + 延迟数据 | 排序后频道列表 |
| 11 | 第 35 课 | 按省编组大编排（地方台自动归类 + 空台剔除） | 排序频道 | 编排后频道列表 |
| 12 | 第 36 课 | B 端契约序列化（exclude_none=True 零 null） | 编排频道 | `List[dict]` 最终 JSON |
| 13 | 第 37 课 | Pydantic Schema 工业级强校验（熔断写盘） | 最终 JSON | 校验通过/熔断 |
| 14 | 第 39 课 | 跨平台自适应物理写盘 | 最终 JSON | 磁盘文件已写入 |

### 关键技术细节

#### Step 7：TS 分片级测速（核心黑科技）
- 不是简单的 HTTP HEAD 请求——而是 **下载 TS 视频流的前 10KB 二进制数据**，验证其编码合法性
- 彻底封杀"假 200"（服务器返回 200 但内容是广告页/错误页）
- 并发度默认 50，可调参数 `max_concurrent`

#### Step 7+：302 重定向链拦截
- 追踪完整 302 重定向链
- 读取响应体前 500 字节，检测 `epg.pw`、`catvod`、`fongmi`、`freetv.fun` 等广告劫持关键词
- 双重卡点：resolve 阶段 + probe 阶段各拦截一次

#### Step 8：批量信誉分结算
- 整批处理只进行 **1 次磁盘读 + 1 次磁盘写**，避免 I/O 炸裂
- 成功 +10 分（上限 100），失败 -20 分（下限 0），默认初始 100 分

#### Step 10：双层排序算法
```
Tier 1（极品源）：广电 CDN / 酒店 IPTV → 按 delay_ms 升序
Tier 2（公网源）：其余所有 → 按 delay_ms 升序
合并后限 4 条/频道，主线延迟覆写至频道 delay_ms 字段
```

---

## 🔌 第三部分：环境变量与配置参数大全

| 变量名 | 默认值 | 说明 | 必须设置 |
|--------|--------|------|:--------:|
| `OUTPUT_PATH` | 自适应（见 writer.py） | 最终 `channels.json` 写盘绝对路径。不设则自动检测：本地 Windows 优先写到 `E:\vscode\iptv-project\data\channels.json`，CI 环境回退到项目相对路径 | 否 |
| `REPUTATION_FILE` | `python_engine/data/history_scores.json` | 信誉分功德簿物理路径（模块级常量） | 否 |
| `MAX_CONCURRENT` | `50` | 异步测速最大并发协程数 | 否 |
| `GITHUB_TOKEN` | 无 | GitHub API 请求令牌（加速源下载、避免 rate limit） | CI 推荐 |
| `NODE_API_PORT` | `3100` | Node.js 动态解析微服务端口 | 否 |

### 本地一键点火

```bash
# 方式一：直接运行 Python 入口
python -m python_engine.src.main

# 方式二：自定义输出路径
OUTPUT_PATH=/tmp/channels.json python -m python_engine.src.main

# 方式三：Node.js 微服务独立启动
cd node_api && npm start
```

---

## 🛡️ 第四部分：数据安全与零副作用保证

### 1. 零数据库依赖
- **不使用 SQLite、MySQL、Redis 或任何数据库**
- 唯一的持久化资产是纯文本 `history_scores.json`（JSON 格式，Git 可追踪）
- 任何时间点删掉此文件，系统将自动从默认分 100 重新初始化，零停机

### 2. 写盘原子性与格式锁定
- `write_channels_json()` 强制 `utf-8` 编码 + `indent=2` + `ensure_ascii=False`
- 先完整序列化为 JSON 再一次性写入，非流式追加——保证文件任何时刻都处于合法 JSON 状态
- Pydantic Schema 强校验作为写盘前最后一道熔断门：数据不合法 → 拒绝写入 → 抛出 `RuntimeError`

### 3. 本地开发隔离
- 测试套件使用 `tmp_path`（pytest 内置临时目录）进行完整的环境隔离
- `OUTPUT_PATH` 环境变量可随意重定向，不会污染生产文件
- 信誉分文件通过 `patch("python_engine.src.reputation.REPUTATION_FILE")` 在测试中隔离

---

## 🧪 第五部分：测试体系全景图

### 运行方式
```bash
# 全量测试
python -m pytest python_engine/tests/ -v

# 单课测试
python -m pytest python_engine/tests/test_lesson_40.py -v

# 带覆盖率
python -m pytest python_engine/tests/ -v --cov=python_engine.src
```

### pytest 配置
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["python_engine/tests"]
python_files = ["test_*.py"]
```

### 测试分布统计

| Phase | 课程范围 | 测试文件数 | 核心验证内容 |
|-------|---------|:---------:|-------------|
| Phase 1 | 第 1-5 课 | 5 | 工程结构、Pydantic 契约、iptv-org 同步、省份映射、请求库 |
| Phase 2 | 第 6-10 课 | 5 | M3U 下载、属性解析、套娃展开、黑名单、粗聚合 |
| Phase 3 | 第 11-15 课 | 5 | 去噪、合并、Logo 匹配、信誉分、Phase 3 端到端 |
| Phase 4 | 第 16-22 课 | 7 | 异步测速基座、M3U8 解析、TS 探针、302 拦截、广告检测、延迟计算、信誉分联动 |
| Phase 5 | 第 27 课 | 1 | 双端联调 |
| Phase 6 | 第 28-32 课 | 5 | CDN 字典、省码爆破、酒店 IPTV、udpxy 验活、极品源抢占 |
| Phase 7 | 第 33-37 课 | 5 | 失效清淤、双层排序、按省编排、契约序列化、Schema 校验 |
| Phase 8 | 第 38-40 课 | 3 | CI/CD 入口、物理写盘、**E2E 大结局全链路** |
| **合计** | **40 课** | **36** | **82 个测试用例** |

---

## ☁️ 第六部分：GitHub Actions 云端自动运维

### 工作流文件：`.github/workflows/sync.yml`

```yaml
# 每 12 小时自动运行一次（UTC 00:00 和 12:00）
schedule:
  - cron: "0 */12 * * *"
```

### 运行流程
1. GitHub Actions 按定时计划触发 `sync.yml`
2. 执行 `python -m python_engine.src.main`，全自动完成 14 步流水线
3. 最终 `channels.json` 写入项目 `data/` 目录
4. 如有数据变更，自动 `git commit` + `git push` 回仓库
5. B 程序通过 URL 或本地同步获取最新数据

### 日常维护检查清单

| 检查项 | 频率 | 方法 |
|--------|------|------|
| Actions 运行日志是否全绿 | 每周 | GitHub → Actions → 最新 run |
| `history_scores.json` 是否异常膨胀 | 每月 | 检查文件大小，> 5MB 需人工清理死链条目 |
| M3U 源是否失效 | 每季度 | 手动 `curl` 验证 5 大预设源 URL |
| 前端 B 程序是否正常消费数据 | 每季度 | 打开播放器验证频道列表非空 |
| iptv-org 字典是否需要增量更新 | 每半年 | 运行 `sync_iptv_org_dict()`，对比缓存差异 |

---

## 🔧 第七部分：常见故障排查手册

### 故障 1：`channels.json` 未生成或为空
- **排查**：检查 Step 13 是否熔断（`RuntimeError: 最终输出的数据契约强校验失败`）
- **原因**：最可能是 Schema 校验发现 null 字段或 urls 超限
- **修复**：在本地运行 `python -m python_engine.src.main`，观察哪一步报错

### 故障 2：信誉分全部归零，频道大量消失
- **排查**：检查 `history_scores.json`，确认是否有大量 URL 信誉分 ≤ 0
- **原因**：测速持续失败（网络问题或源全部下线）
- **修复**：删除 `history_scores.json`，系统将从默认 100 分重新初始化

### 故障 3：TS 测速全部超时
- **排查**：检查网络连通性，尤其是目标 CDN 是否有防火墙规则变更
- **原因**：并发过高导致本地出口 IP 被限速，或 DNS 解析失败
- **修复**：降低 `max_concurrent`（如改为 10），或检查 `request_client.py` 的 IPv6 闪避逻辑

### 故障 4：302 广告劫持漏网
- **排查**：在 `blocklist.py` 的 `AD_KEYWORDS` 列表中添加新发现的广告域名
- **修复**：更新关键词列表后重新运行流水线

### 故障 5：Node.js 微服务启动失败
- **排查**：`cd node_api && npm install && npm start`，检查端口 3100 是否被占用
- **修复**：通过 `NODE_API_PORT` 环境变量更换端口

---

## 📋 第八部分：B 端前端播放器数据消费契约

### 最终输出格式：`channels.json`

```json
[
  {
    "name": "CCTV-1",
    "group": "央视频道",
    "urls": [
      "http://cdn1.example.com/cctv1.m3u8",
      "http://cdn2.example.com/cctv1.m3u8"
    ],
    "delay_ms": 15,
    "logo": "https://iptv-org.github.io/logos/CCTV1.png",
    "tvg_id": "CCTV1.cn"
  }
]
```

### 字段规约

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `name` | `str` | ✅ | 频道标准名称（已去噪，如"CCTV-1"而非"CCTV1 [FHD] 电信"） |
| `group` | `str` | ✅ | 分组名（央视频道 / 浙江频道 / 其他频道） |
| `urls` | `List[str]` | ✅ | 播放线路数组，最多 4 条，按质量降序 |
| `delay_ms` | `int` | ✅ | 主线路延迟（毫秒），0 表示未测或主线路无延迟数据 |
| `logo` | `str` | ❌ | 台标 URL，不存在时 **字段不出现**（非 null，零污染） |
| `tvg_id` | `str` | ❌ | EPG 身份证号，不存在时 **字段不出现** |

> **关键约定**：`logo` 和 `tvg_id` 是 Optional 字段。序列化时使用 `exclude_none=True`，确保 JSON 中 **绝对不会出现 `"logo": null` 这种脏数据**。B 端前端应使用 `channel.get("logo")` 而非 `channel["logo"]` 安全取值。

---

## 🏁 第九部分：后期运维与演进建议

### 短期（1-3 个月）
1. **监控信誉分分布**：定期查看 `history_scores.json`，确认大部分 URL 信誉分在 80-100 之间。如果大量低于 50，说明源质量整体下降，需要新增替代源。
2. **补充 M3U 源**：在 `fetcher.py` 的源 URL 列表中添加新发现的优质 GitHub 播放源仓库。
3. **修复 7 个历史遗留失败测试**：Lesson 3/10/12/16/19 的测试用例因 mock 签名与实现演进不同步而失败，需要更新 mock 参数以匹配当前函数签名。

### 中期（3-6 个月）
1. **Node.js 微服务补全**：第 23-26 课的 B站/抖音/快手防盗链解析器尚未实现，可在 `node_api/src/redirect_api.js` 中逐步补全。
2. **增量同步**：当前每次运行是全量抓取，可优化为仅抓取上次更新后有变更的源（基于 Git commit 时间戳）。
3. **告警通知**：为 GitHub Actions 添加失败通知（Slack/邮件/DingTalk），流水线熔断时第一时间人工介入。

### 长期（6-12 个月）
1. **多区域部署**：在不同地理区域部署多个 Actions runner，降低跨洋测速延迟误差。
2. **流质量评分升级**：从二元（成功/失败）升级为连续评分——引入分辨率、码率、卡顿率等多维指标。
3. **前端联动**：当 B 程序播放某频道频繁卡顿时，反馈至 A 程序触发该 URL 信誉分惩罚，形成"播放器 → 数据引擎"的反馈闭环。

---

## 📞 附录：核心模块速查表

| 模块文件 | 一句话职责 | 关键函数 |
|---------|-----------|---------|
| `main.py` | 14 步总阀门，一键点火 | `main() → List[dict]` |
| `fetcher.py` | M3U 盲扫下载器 | `fetch_all_sources() → Dict[str, str]` |
| `parser.py` | M3U 解析 + 套娃展开 | `parse_m3u_content()`, `expand_m3u_streams()` |
| `blocklist.py` | 广告/黑名单拦截 | `filter_blocked_streams()` |
| `normalizer.py` | 频道去噪 + Logo/EPG 匹配 | `denoise_name()`, `match_logo_and_tvg_id()` |
| `merger.py` | 合并/排序/编排/序列化/校验 | `refined_aggregate_streams()`, `sort_channel_urls_with_priority()`, `orchestrate_channel_groups()`, `export_channels_to_list()`, `validate_final_json_data()` |
| `reputation.py` | 信誉分管理 | `load_reputation_scores()`, `update_reputation_scores_batch()`, `save_reputation_scores()` |
| `speedtest.py` | TS 级异步测速 | `probe_all_urls()`, `probe_single_url()` |
| `writer.py` | 跨平台自适应写盘 | `determine_output_path()`, `write_channels_json()` |
| `request_client.py` | 智能请求包装 | IPv6 闪避 + GitHub 镜像加速 |
| `cdn_scanner.py` | 广电 CDN 规律爆破 | `scan_provincial_cdn_channels()` |
| `hotel_scanner.py` | 酒店 IPTV 探测 | `scan_hotel_iptv_channels()` |

---

> **📝 本交底书由 AI 架构师于 2026 年 6 月 26 日自动生成。涵盖 40 课时全部工程实践结晶。祝运维顺利，数据长青！** 🚀
