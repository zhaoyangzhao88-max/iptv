# IPTV 项目交接状态

更新时间：2026-08-07

## 当前目标

本阶段目标已达成：补强 discovery 的隐私与篡改防护、重新验证当前 Python 全量测试、确认 hls.js 固定版本与打包内容、并用用户提供的公开 HLS 测试流做真实出画面验证。所有工作保持既有用户改动不覆盖、不提交、不推送。

## 已完成内容

### discovery 隐私与 accepted 输入边界加固（本轮新增）

`iptv-engine-b/python_engine/src/discovery.py`：

- 候选记录的 `source_page` 在持久化前经 `sanitize_url()` 脱敏，避免 page 携带的 token/secret 写入 `discovery_candidates.json`。
- `validate_candidate()` 在通过前增加 `contains_sensitive_url()` 检查：带敏感 query（token/signature/secret 等）、凭据的候选直接拒绝并脱敏 URL，不再进入 accepted。
- 校验异常不再记录原始网络/异常文本，统一为稳定泛化原因 `candidate validation failed`，避免 provider 细节泄露。

`iptv-engine-b/python_engine/src/source_config.py`：

- `_load_discovered_sources()` 在加载手工/外部写入的 accepted 记录时，再次执行统一 URL 安全策略 `is_safe_fetch_url()`；伪造的私网/非公网 accepted URL 不会被合并进授权源。

`iptv-engine-b/python_engine/tests/test_discovery.py` 新增回归：

- 敏感 query/path/fragment 的候选在持久化文件（candidates + accepted）中不出现 token/secret。
- 校验异常消息中的泄露文本不会进入结果。
- 手工伪造的 accepted 记录（私网 URL 或非 discovered-low trust_tier）被 `_load_discovered_sources()` 拒绝。

### 全量验证（当前代码，2026-08-07）

- Python（`npm run test:python`）：**177 passed**，退出码 0。
- Node（`npm run test:node`）：**51/51 passed**。
- Player（`npm run test:player`）：**33/33 passed**。
- 嵌套 `npm test`：退出码 0（Node 51、Python 177、Player 33 全部通过）。
- `node --check iptv-project/app/checker-worker.js`：通过。
- `git diff --check`：无空白错误。
- `uv.lock`：不存在。
- 工作树：`channels.json` 未改动；既有用户未提交改动、pytest 日志、证据文件均保留。

### hls.js 版本与打包确认（本轮验证）

- `hls.js` 已固定为精确版本 **1.6.16**（`package.json`、`package-lock.json`、已安装 `node_modules/hls.js/package.json` 三者一致）。
- 渲染器 `app/index.html` 使用本地 bundle `../node_modules/hls.js/dist/hls.min.js`，不是 CDN `latest`。
- `tests/p0_c_electron_readiness.test.js` 断言依赖恰好为 `1.6.16` 且不存在 jsdelivr/hls.js@latest。
- 打包产物 `dist/win-unpacked/resources/app.asar` 清单包含 `\node_modules\hls.js\dist\hls.min.js` 与 `\app\index.html`（通过 `@electron/asar` 工具级确认）。
- 修正了 `PROJECT_CONTEXT.md` 中过时的 CDN `hls.js@latest` 文档引用，使其与实际本地固定 bundle 一致。

### 真实出画面验证（本轮新增证据）

使用用户提供、无需鉴权的公开 HLS 测试流，通过 `window.owlIptv.playChannel()` 走真实播放器管线（player.js + 本地 hls.js 1.6.16）在真实 Electron 中验证：

1. **Mux TS 流** `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`
   - `readyState=4`、`paused=false`、`error=null`；`currentTime` 从 9.6s 推进到 13.6s（帧在动）。
   - 自适应码率：848×480 → **1920×1080**。
   - 事件：`loadstart → loadedmetadata → canplay → playing`。
   - 证据：`iptv-project/test-evidence/2026-08-07-public-hls-mux/`（含 frame.png、playback-state.json、renderer-console.log）。

2. **Apple fMP4 流** `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8`
   - `readyState=4`、播放中、`currentTime` 从 13.2s 推进到 17.2s、1920×1080、无媒体错误。
   - 证据：`iptv-project/test-evidence/2026-08-07-public-hls-apple-fmp4/`。

两次运行都有少量 transient 事件（`waiting`/`bufferStalledError`/`bufferSeekOverHole`）但均自动恢复；`event.pull.hebtv.com/live/live101.m3u8` 的 `ERR_ABORTED` 是应用自动播放上一个已看频道被切换测试流时主动中止的预期行为。

## 关键技术决策

- discovery 只消费本地 JSON，验证前统一用 `contains_sensitive_url()` + `is_safe_fetch_url()` 把关；持久化边界用 `sanitize_url()` 脱敏；异常原因稳定泛化。
- `source_config` 合并 discovered 源时二次执行安全 URL 校验，accepted 且 enabled 且 trust_tier=discovered-low 是唯一准入门槛。
- 保留默认 Node redirect allowlist（用户已确认暂不收窄），仅在交接记录标记“待实际部署 host inventory 再评估”。
- 不补充正式 Windows `.ico`、品牌信息或 author 占位（用户已确认延后）。
- 不提交、推送、reset、clean、stash；不覆盖 `channels.json`、日志和既有用户改动。

## 修改过的核心文件

### 本轮改动

- `iptv-engine-b/python_engine/src/discovery.py`
- `iptv-engine-b/python_engine/src/source_config.py`
- `iptv-engine-b/python_engine/tests/test_discovery.py`
- `iptv-project/PROJECT_CONTEXT.md`（仅修正过时 hls.js 文档引用）
- 既有 `iptv-engine-b/python_engine/tests/test_lesson_6.py`（上一阶段已改）

### 先前计划完成的核心文件

- `iptv-engine-b/python_engine/src/url_policy.py`、`request_client.py`、`fetcher.py`、`parser.py`、`quality_gate.py`
- `iptv-project/app/modules/{dataLoader,diagnostic,urlPolicy,player}.js`、`iptv-project/app/checker-worker.js`
- 对应回归测试文件。

## 测试与验证结果（当前代码，2026-08-07）

- 聚焦测试：`test_discovery.py` + `test_lesson_6.py` + `test_source_config_health.py` + `test_source_health.py` = 19 passed。
- 全量 Python：177 passed。
- Node：51/51；Player：33/33；嵌套 `npm test` 全绿。
- `git diff --check` 干净；`uv.lock` 不存在；`channels.json` 与既有用户改动保留。
- 真实播放：两条公开流均出画面、帧推进、1080p，证据文件已落盘。

## 已知问题 / 待办

- `iptv-engine-b/python_engine/data/discovered_sources.json` 尚不存在：discovery 运行后会生成；当前为安全的空回退。
- Node redirect allowlist 仍为相对宽泛的默认值；已确认暂不收窄，待实际 resolver host inventory 后再评估。
- 没有正式 Windows `.ico` 与发布品牌信息；已确认延后。
- 真实播放探针是人工验证工具，未接入 `npm test`；探针日志指出渲染器缺少明确的 Content-Security-Policy（Electron 安全告警，非播放失败）。
- 探针运行会写入 `test-evidence/` 与临时 `user-data`，属于有意的人工验证产物，非只读。

## 下一步开发顺序

1. （本阶段验证已完成）若用户需要，可运行 Akamai 直播流或 Tears-of-Steel 作第三条交叉验证。
2. 正式决定是否把 CSP 加入渲染器（发布前安全收尾）。
3. 决定是否提供 `.ico`/品牌信息，或是否提交/推送当前改动。
4. 收到明确指示后再提交或推送；否则保持工作树原样。
