# IPTV 项目全量审计与优化计划

> 文档用途：记录 `E:\vscode\iptv` 的全仓库审计结论、盲点扫描结果、已确认产品边界，以及按优先级可执行的优化路线。
>
> 当前状态：**计划已达成共识，尚未开始业务代码修改。**
>
> 重要基线：审计期间外部刷新流程修改了 `iptv-engine-b/data/channels.json`。当前该文件约 **5370 行、555 个频道、679 条 URL**；Git diff 的约 5361 行是新增/变化行数，不是文件总行数。这不是本次审计主动产生的代码改动；在用户确认前，**不覆盖、不回滚、不提交**该文件。

---

## 1. 已确认的产品目标与边界

- **产品定位**：个人本地 IPTV 播放器。
- **第一阶段平台**：Windows 10/11。
- **数据交付**：Python 引擎直接生成并发布 `iptv-project/data/channels.json`，不再依赖机器绝对路径或两份不一致快照。
- **刷新频率**：每 6 小时一次。
- **自动发布**：GitHub Actions 通过质量门禁后直接提交 `master`；失败时保留上一份稳定快照。
- **质量门禁**：相较上一份稳定快照：
  - 频道数下降超过 20% → 拒绝覆盖；
  - 有效线路总数下降超过 20% → 拒绝覆盖；
  - 测速成功率相对下降超过 20% → 拒绝覆盖；
  - 少于 1 个频道或 1 条有效线路 → 拒绝覆盖。
- **特殊平台**：B站、抖音、快手必须支持。失败时频道保留可见、标记不可用并允许重试；不能使用占位地址伪装成功。
- **动态 Token**：特殊平台解析得到的短时真实 URL 只保留在 Node 进程内存中；快照只保存稳定的 loopback 逻辑 URL。
- **Node 服务**：只监听 `127.0.0.1:3000`，端口占用时明确失败，不静默换端口。
- **网络边界**：自定义订阅只允许公网 HTTPS 和受控 loopback；拒绝 `file:`、RFC1918、链路本地、云元数据和未经确认的私网地址。
- **普通 IPTV 源**：允许现有 `http://` 地址以保持兼容，但 UI/诊断报告必须标记明文传输风险。
- **播放器体验**：普通频道自动切换备用线路；全部线路失败或 codec 不兼容时显示原因、重试和手动切台，不永久隐藏频道。
- **路线策略**：
  - `latency-first`：全局按 `delay_ms` 排序；
  - `source-quality`：先按信誉分、媒体探测成功、HTTPS/直连类型等质量分层，再在同层按延迟排序。
- **Hls.js**：使用本地固定版本随 portable 打包，移除 `@latest` CDN 运行时依赖，确保离线启动。
- **隐私**：观看统计、诊断报告、URL/Token 永不离开本机；默认完整脱敏，日志可保留域名，但 query/path 中 Token、账号、IP 等敏感部分必须掩码。
- **合规范围**：第一阶段仅个人非公开使用；不对外分发数据或解析服务，并记录源站、平台和 Logo 来源。
- **第一阶段验收**：开发模式启动 + Windows portable 打包冒烟，覆盖 extraResources、Node readiness、数据加载和基础播放流程。
- **实施方式**：按 P0 小步提交，每个子提交独立验证；失败只回滚对应子提交，不回滚用户未提交的数据产物。

---

## 2. 当前架构与文件地图

### 2.1 根目录

- `package.json`：根级启动、打包、Node/Python 测试脚本；目前没有 npm workspaces。
- `README.md`：项目说明、启动与测试命令。
- `AUDIT_RESULT.md`：历史阶段审计记录，但数字和现状已与代码漂移。
- `.github/workflows/daily_wash.yml`：每 6 小时数据清洗/测速/导出。
- `.github/workflows/sync.yml`：每 12 小时同步信誉分，和 daily wash 存在职责/频率重叠。
- `iptv-engine-b/`：Python 数据引擎、Node 微服务和历史文档。
- `iptv-project/`：Electron 播放器、前端模块、数据和旧测试。
- 计划相关文档：根 `README.md`、`iptv-project/README.md`、`iptv-project/PROJECT_CONTEXT.md`、`AUDIT_RESULT.md`、`iptv-engine-b/handover_manual.md`、`iptv-engine-b/MASTER_PLAN.md`；这些文件目前存在旧路径、旧端口、Express 描述、旧阶段统计或“app.js 未创建”等漂移，阶段 3 必须逐一同步。

### 2.2 Python 引擎

`iptv-engine-b/python_engine/src/`：

- `main.py`：14 步主流水线。
- `fetcher.py`：抓取固定 M3U 源。
- `parser.py`：M3U/EXTINF 解析、嵌套列表递归展开。
- `blocklist.py`：恶意域名/广告过滤。
- `normalizer.py`：名称清洗、Logo/EPG 元数据、省份分组、特殊平台 URL 重写函数。
- `merger.py`：同名合并、优先线路、排序、分组、序列化和校验；当前把 `localhost`/`127.0.0.1` 与 `/udp/`/`/rtp/` 一并视为 priority/multicast，接入 Node loopback resolver 前必须拆分这两个概念。
- `speedtest.py`：M3U8 下钻、TS 二进制探测、重定向/广告检测、并发控制。
- `reputation.py`：URL 信誉分读写、迁移、LRU 上限。
- `writer.py`：JSON/M3U 写盘。
- `cdn_scanner.py`、`cdn_explorer.py`、`cdn_probe.py`、`cztv_explorer.py`、`hotel_scanner.py`、`aggregator_crawler.py`：辅助探测工具，当前没有完整接入 `main.py` 生产主链路。

### 2.3 Node 微服务

`iptv-engine-b/node_api/`：

- `src/redirect_api.js`：实际监听入口。
- `src/server.js`：HTTP server 工厂和路由。
- `src/resolvers/bilibili.js`、`douyin.js`、`kuaishou.js`：平台解析。
- `src/resolvers/cache.js`：TTL Map 缓存。
- `tests/`：Node 内置测试，目前偏输入校验、fallback 和 stub 路由。

### 2.4 Electron 播放器

- `main.js`：窗口、Node 子进程、退出处理。
- `preload.js`：contextBridge API。
- `app/index.html`：界面和 Hls.js 引入。
- `app/app.js`：初始化入口。
- `app/modules/state.js`：全局状态、localStorage。
- `app/modules/dataLoader.js`：数据加载、归一化、远程合并。
- `app/modules/player.js`：Hls.js 播放、切线和冻结检测。
- `app/modules/virtualGrid.js`：虚拟网格、焦点和 DOM 元素缓存。
- `app/modules/settings.js`：组播、自定义订阅、路由策略、清缓存。
- `app/modules/diagnostic.js`：频道巡检和本地报告。
- `app/checker-worker.js`：后台轻量测速。
- `data/channels.json`：播放器离线启动快照。

---

## 3. 已复现问题清单

### P0：会阻止播放器正常运行或破坏核心数据链路

1. **Electron 入口 named export 不匹配**
   - `iptv-project/app/app.js:2` 从 `state.js` 导入不存在的 `cacheElements`；实际导出在 `virtualGrid.js:349-370`。
   - `app.js:9-12` 又从 `dataLoader.js` 错误导入实际位于 `recommend.js:33-36` 的 `prepareRecommendations`。
   - 原生 ESM 实际加载已复现 `SyntaxError`，初始化尚未开始就失败。

2. **ESM import binding 被错误赋值**
   - `state.js:298-300` 导出 `lastUserActivityTime`、`pendingRenderTimer`、`isRenderPending`。
   - `app.js:45-48`、`dataLoader.js:328-345` 直接给导入绑定赋值。
   - 修正入口导入后，相关交互路径会出现导入绑定只读错误。

3. **`urls: string[]` 与前端归一化不匹配**
   - Python `Channel.urls` 是字符串数组。
   - `dataLoader.js:108-117` 的 `normalizeRoute()` 只接受对象并读取 `route.url`。
   - 已实际复现：字符串线路会全部丢弃，`normalizeChannels()` 得到空数组，播放器无频道。
   - `buildRoutesFromChannel()` 虽兼容字符串，但正常初始加载不调用它。

4. **引擎输出路径与播放器路径不一致**
   - `writer.py:6` 仍有旧的 `E:\vscode\iptv-project\data\channels.json` 绝对路径。
   - 当前仓库实际播放器目录为 `E:\vscode\iptv\iptv-project\data\channels.json`。
   - 当前回退路径写到 `iptv-engine-b/data/channels.json`，播放器可能继续读取旧快照。

5. **普通生产数据没有接入特殊 URL 重写**
   - `normalizer.rewrite_special_stream_url()` 已定义，但 `main.py` 主流水线没有调用。
   - Step 6 使用 `mock_priority_streams=[]`，辅助探测器没有真正进入生产数据。
   - B站/抖音/快手逻辑 URL 不能自动从常规抓取数据进入最终快照。

6. **生产发布门禁没有实现所需输入**
   - 当前 `write_channels_json(data)` 只接收待写数据；`main.py` 没有把上一份快照指标或 `probe_results` 传给门禁。
   - 质量门禁必须单独定义 API、candidate manifest、首跑/坏基线行为，并在门禁通过后才替换快照。

### P1：会导致功能失真、安全边界过宽或交付不可靠

1. **特殊平台失败伪装成成功**：resolver 失败返回 fallback，server 仍给 `302`；默认 `https://test-stream.com` 是占位地址。
2. **Node 服务未固定 loopback**：`server.listen(PORT)` 未显式 host，桌面服务可能暴露到局域网。
3. **Node 输入与跳转约束不足**：路由 `(.+)`、ID 无长度上限、无 method 限制、CORS `*`、Location 无 scheme/host 白名单。
4. **Node 缓存无并发合并/容量边界**：短时 Token 和 fallback 都可能被缓存，无 pending Promise 合并、无最大容量和清理策略。
5. **Electron preload 任意路径读写**：`readFile`、`writeFile`、`pathJoin` 直接暴露，渲染层受供应链/XSS 影响时可读写用户可访问文件。
6. **诊断报告写入 asar 风险**：`diagnostic.js` 通过 `app/../data` 写报告；打包后资源通常位于只读 `asar`，应写入 `app.getPath('userData')`。
7. **Hls.js 未锁定且依赖 CDN**：`index.html:8` 使用 `hls.js@latest`，`package.json` 没有本地依赖；离线时 Electron 通常无原生 HLS fallback。
8. **Node 子进程 readiness/停止竞态**：Electron 创建窗口不等待 `/health`；停止时清空引用导致 SIGKILL 兜底失效。
9. **自定义 M3U 设置无效**：输入 URL 被忽略；只按 JSON 解析；`M3U_SUB_URL_KEY` 未实际使用；`routeStrategy` 只保存不参与排序。
10. **远程合并可能清空本地频道**：远程响应按名称重建并删除本地缺失频道；不完整响应/临时故障可能破坏稳定列表。
11. **前端元数据丢失**：归一化丢 `tvg_id`、`is_multicast`，组播过滤/EPG 失效。
12. **后台 worker 健康检查不可信**：`no-cors` 的 fetch promise resolve 即算成功，不检查 HTTP/媒体内容，只测第一条线路。
13. **Python 依赖漏项**：`requirements.txt` 缺 `aiohttp` 和显式异步测试依赖；`sync.yml` 不安装 aiohttp。
14. **CDN scanner 签名断裂**：调用 `probe_single_url` 时缺少 `domain_sems` 参数；当前测试 mock 掉真实探针。
15. **CI 配置风险**：workflow 缺少显式 `contents: write`；要提交的 `history_scores.json` 被 `.gitignore` 忽略；两个 workflow 可能频率/职责冲突。
16. **写盘非原子**：writer/reputation 直接 `open(..., 'w')`，崩溃可能留下截断数据；异常还可能被吞掉。
17. **硬编码用户历史污染**：`app.js:74-94` 每次初始化强行写绍兴统计与 hidden override。
18. **旧前端测试与 ESM 不兼容**：`test_lesson_5.js`、`test_lesson_6.js`、`test_lesson_7.js`、`test_lesson_8.js`、`test_lesson_9.js`、`test_lessons_1_to_4.js`、`test_ui_sweeper.js` 和 `test_ui_untested.js` 仍按旧 IIFE/vm.Script 读取当前 ESM `app.js`，实际运行会失败；根 `npm test` 也不覆盖前端。
19. **Token/完整 URL 已进入数据与报告**：当前外部快照含 `accountinfo`、`txSecret`、`auth` 等查询参数；`diagnostic.js:145-150` 将完整 URL 写入 `playback_client_report.md`，历史报告也可能含完整地址。发布门禁必须增加 Token 扫描和报告脱敏。

---

## 4. 推荐实施路线

### 阶段 0：保护基线与建立验收门

- 暂不处理/回滚审计期间产生的 `iptv-engine-b/data/channels.json` 工作树改动，待用户检查。
- 稳定播放器快照允许进入 Git，但只能是通过质量门禁、脱敏且不含短时 Token 的版本。
- 增加根级统一验证入口，消除 cwd/隐式 `PYTHONPATH` 依赖：在 `iptv-engine-b/python_engine/` 与 `src/` 补齐明确 package 入口/安装配置，根脚本使用 `python -m pytest iptv-engine-b/python_engine/tests` 的可复现环境变量或 editable install；验收必须从仓库根直接通过，不能靠手工 `cd iptv-engine-b`。
- 建立 candidate manifest，至少记录：频道数、有效线路数、测速成功率、生成时间和 schema 版本；门禁 API 显式接收 `candidate_data`、`probe_results` 和稳定快照/manifest，首跑无基线只做结构与最小规模检查，坏基线拒绝发布并保留旧快照。
- 加入固定契约 fixture：字符串/对象 routes、元数据、组播、空输入、旧格式和入口模块加载。

### 阶段 1：恢复生产可用性（P0，小步提交）

#### P0-A：Electron 入口

目标：先让页面真正加载。

- 修正 `app.js` 的导入映射：
  - `cacheElements` 从 `virtualGrid.js` 导入；
  - `prepareRecommendations` 从 `recommend.js` 导入；
  - 删除错误的跨模块导入。
- 将时间戳/定时器移入 `state` 对象，或只通过 `state.js` setter/clear 函数修改；覆盖 `app.js`、`dataLoader.js`、`player.js` 及测试暴露的 `window.owlIptv._setLastUserActivityTime`，清理所有 import binding 直接写入。
- 新增原生 ESM 入口加载测试，并验证共享状态更新、定时器取消和空闲重绘路径。

验收：所有前端模块可原生加载；初始化无 named-export/import-binding 错误。

#### P0-B：播放器数据契约

目标：确保引擎数据真正显示并保留元数据。

- 磁盘格式继续使用 `urls: string[]`；对象 route 仅作兼容输入。
- `dataLoader.js` 建立单一 normalize 入口，初始 JSON、远程 JSON、用户 M3U 转换全部复用。
- 保留 `tvg_id`、`is_multicast` 和 `risk_flags` 等字段。
- 远程数据先作为候选校验，通过质量门禁后再替换对应订阅命名空间；不完整响应不得删除稳定频道。
- 远程失败只提示并保留旧数据。

验收：字符串 URL 生成非空 routes；元数据/组播过滤有效；空或不完整远程响应不改变旧列表。

#### P0-C：统一输出、原子发布和 readiness

目标：引擎生成的数据就是播放器正在读取的数据，并且不会半写入。

- `writer.py` 默认以仓库根相对路径写 `iptv-project/data/channels.json`，保留 `OUTPUT_PATH` 覆盖；CI 的 `daily_wash.yml` 不再读写另一份 engine-only 产物。
- 删除旧 E 盘绝对路径和引擎/播放器双快照的隐式分裂；`write_channels_json()`、`write_channels_m3u()` 和 reputation 持久化要么统一原子发布，要么明确标记为非交付临时产物。
- 新增独立 quality-gate 模块/API：输入 candidate data、`probe_results` 和上一份稳定 manifest；输出 accept/reject 及脱敏原因。首跑无基线只检查 schema/最小规模，缺失或损坏旧 manifest 不得覆盖稳定文件。
- 临时文件 + flush/fsync + `os.replace`；保留上一份稳定快照。
- 质量门禁：数量、有效线路、测速成功率相较上一版均不得下降超过 20%，且至少 1 个频道/1 条线路；`main.py` 必须先 gate，再保存 reputation 和替换输出。
- Node 固定监听 `127.0.0.1:3000`；Electron 等待 `/health` 后再启用相关播放。
- 停止时保留局部 child 引用，等待 exit，超时再 kill。

验收：崩溃模拟不会损坏稳定 JSON；异常候选不会替换旧快照；Electron 能观察 readiness 并显示频道。

#### P0-D：特殊平台逻辑 URL

目标：稳定支持三平台，同时不落盘 Token。

- 将 `rewrite_special_stream_url()` 接入 Python 主流水线，输出统一的 `http://127.0.0.1:3000/api/{platform}/{id}` loopback 逻辑 URL；不要继续生成 `localhost`，并在 `merger.py` 中把 Node loopback 与真实 `/udp/`/`/rtp/` multicast 分开，避免被 UI 默认组播过滤或 M3U 导出跳过。
- Node resolver 失败返回明确 retryable 错误，不返回占位 302。
- 使用可注入 HTTP client；内存 TTL + pending Promise 合并；真实 Token 只存在进程内存。
- upstream URL 只允许 HTTPS/允许主机；日志/响应脱敏。
- 验收覆盖 Python 主流水线确实调用重写函数、三平台 URL 进入快照、Node loopback route 不被标记 multicast、失败不写入占位地址。

验收：B站/抖音/快手 fixture 覆盖成功、房间不存在、超时、页面变化、恶意 URL；成功可播，失败可见可重试。

### 阶段 2：正确性与安全加固（P1）

- **Preload**：同步改造实际调用点 `dataLoader.js:22-23`（固定读取 channels 快照）和 `diagnostic.js:156-159`（固定写入脱敏报告），只暴露窗口控制、读取固定 data 快照和写入 `userData` 报告的命名接口；移除任意 `fs/path` 与 `pathJoin`。增加开发/portable 两种路径测试，确保 data 读取正确、报告不写入 `asar`、目录不可逃逸。
- **订阅网络**：JSON/M3U 自动识别；仅公网 HTTPS/受控 loopback；拒绝 file、RFC1918、链路本地、云元数据和未确认私网。
- **外部 M3U 输入边界**：在 `fetcher.py:fetch_single_source()` 增加响应字节上限和单请求超时；在 `parser.py:parse_m3u_content()` 增加总字节/行数/条目上限；在 `expand_m3u_streams()` 增加总 URL、递归深度、嵌套响应大小、超时和 `http/https` 公网地址策略，拒绝 file、RFC1918、链路本地、云元数据和危险重定向；对订阅与嵌套列表异常输入做确定性测试。这是 P1 必须完成的输入边界，不只记录在盲点清单。
- **播放器质量**：本地固定 Hls.js；HTTP 源保留兼容但标记风险；落实两种 route strategy；自动切线，全部失败可重试。`checker-worker.js`、`player.js` 和 `diagnostic.js:testSingleChannel()` 都必须尝试备用 routes，只有全路线失败才给出可恢复失败提示，不能因首线路失败直接写 `hidden=true`；诊断报告需记录状态/域名级脱敏信息，清理或覆盖旧报告，不写完整可播放 URL。
- **引擎/CI**：补 `aiohttp` 和显式异步测试依赖；`curl_cffi` 维持现有 requests fallback，暂不强制加入生产依赖；修 CDN scanner 参数或明确延期到辅助模块接入前；保留唯一 6 小时 workflow，停用/改造 12 小时 `sync.yml`，加并发锁、显式 `contents: write`，先 gate 再 add/commit/push；修 worker 的 no-cors 假成功。
- **数据/隐私**：删除硬编码绍兴统计；默认脱敏 query/path；不上传统计、诊断、URL/token；记录源/平台/logo 来源。

### 阶段 3：测试、文档和可维护交付（P2）

- 迁移旧 `vm.Script` 前端测试到原生 ESM/Node test；按需要加入 Electron portable/Playwright 冒烟。
- 增加 Python writer/quality gate、前端 normalize、Node server/resolver fixture contract tests；CI 不依赖真实平台在线成功。明确 `test_lesson_38.py` 等流水线测试不得写入 tracked 产物，必须使用 `tmp_path`/`OUTPUT_PATH` 隔离；根 `npm test` 纳入前端 ESM smoke/contract tests，旧 vm.Script/IIFE 测试要迁移或从默认套件移除。
- 更新 `E:\vscode\iptv\README.md`、`iptv-project/README.md`、`iptv-project/PROJECT_CONTEXT.md`、`AUDIT_RESULT.md`、`iptv-engine-b/handover_manual.md`、`iptv-engine-b/MASTER_PLAN.md`，统一真实路径、原生 `node:http`、端口 3000、单一 6 小时 workflow、数据快照和测试命令；删除过时“Express/3100/app.js 未创建/旧安全配置”等描述。
- 增加来源成功率、解析数、有效频道/线路数、测速成功率、候选/稳定差异、schema 版本、生成时间等指标；异常只保留旧快照并输出脱敏报告。发布前硬扫描 `accountinfo`、`txSecret`、`auth`、`token` 等查询参数，拒绝未脱敏快照/报告；报告可保留域名和掩码后的 query/path，并按本地保留策略清理旧报告。
- 每个子提交独立测试和 review；失败只回滚对应代码提交，不回滚用户未提交数据产物。

---

## 5. 盲点扫描：容易不知道自己不知道的事情

1. **测速≠用户体验**：CI runner 的地域、运营商、IPv4/IPv6、Referer、Token、时区和网络质量与用户 Windows 机器可能完全不同。
2. **M3U 是不可信输入**：外部内容可能造成 SSRF、私网探测、超大文件、递归资源耗尽、恶意跳转或异常 URL；必须设置文件大小、递归深度、总 URL 数和地址策略。
3. **Token 泄露面不止 JSON**：日志、Git 历史、Actions artifact、诊断报告、异常堆栈和缓存都可能泄露可播放地址。
4. **自动刷新会与人工开发竞争**：Actions 直接提交 master 可能覆盖开发中的数据/代码变更；需要工作流并发锁、变更检测和“只提交生成文件”约束。
5. **HLS 播放受多重条件影响**：CORS、Mixed Content、codec、MSE、证书、并发连接和 Electron webSecurity 都可能让“HTTP 可达”变成“播放器不可播”。
6. **平台解析器易变且有条款风险**：B站/抖音/快手页面结构、风控、授权和服务条款会变化，必须保留 fixture、失败提示和维护责任边界。
7. **供应链范围比 Hls.js 大**：Electron/electron-builder、GitHub 源列表、GitHub 镜像代理、远程 M3U 内容都是供应链输入。
8. **打包环境不同于开发环境**：asar 只读、extraResources 路径、userData 写权限、Node 子进程启动时机、Windows 防火墙/杀毒软件都要实际验证。
9. **数据文件可能包含敏感信息**：当前外部刷新数据中已出现 `accountinfo` 等 URL 查询参数，不能默认视为无敏感信息；提交稳定快照前必须扫描、脱敏或明确接受风险。
10. **辅助模块不等于已上线能力**：CDN/酒店/聚合模块虽然存在测试，但没有接入主 pipeline；文档声称的功能不能直接当作生产能力。

---

## 6. 已完成的验证记录

- Node API：`node --test iptv-engine-b/node_api/tests/*.test.js` → **36/36 通过**。
- Python：在正确包路径运行 → **154/154 通过**；存在 pytest-asyncio 配置弃用警告。
- 根目录直接 `python -m pytest` → **39 个 ModuleNotFoundError**，入口不自洽。
- 前端旧 `vm.Script` 测试：`test_lesson_5.js`、`test_lessons_1_to_4.js`、`test_ui_sweeper.js` → 因 ESM 入口不兼容失败。
- 原生 ESM 实际加载 `app.js` → 因缺少 `cacheElements` named export 失败。
- 原生 ESM 直接调用 dataLoader → 字符串 `urls` 归一化后得到空频道。
- `writer.determine_output_path()` → 当前落到 `iptv-engine-b/data/channels.json`，不是播放器目录。
- 当前工作树：仅发现 `iptv-engine-b/data/channels.json` 外部刷新造成的未提交变更；本计划及新文档除外。

---

## 7. 第一批实施时的具体验收命令

```powershell
# 根目录
npm test

# Python（根目录统一入口修复后）
python -m pytest iptv-engine-b/python_engine/tests -q

# Node API
node --test iptv-engine-b/node_api/tests/*.test.js

# 前端原生 ESM/契约测试
node --test iptv-project/tests/*.test.js

# 开发模式启动
npm start

# portable 构建
npm run dist
```

portable 冒烟需观察：

1. Electron 能启动并读取 `iptv-project/data/channels.json`；
2. Node 服务只监听 `127.0.0.1:3000`，`/health` ready 后才启用相关解析；
3. 普通频道列表非空，字符串线路能播放或自动切换备用线路；
4. HTTP 源有风险提示；
5. 三个平台失败时显示不可用和重试，不返回占位 302；
6. 诊断报告可写入 userData，Token/完整播放 URL 不出现在报告；
7. 退出时 Node 子进程真正结束。

---

## 8. 实施前唯一需要保留的操作约束

- 不要回滚或覆盖 `iptv-engine-b/data/channels.json` 的现有未提交刷新结果。
- 不要把短时 Token 写入快照、日志、报告、Git 或远程 artifact。
- 不要在完成 P0 验收前同时进行大规模 P1/P2 重构。
