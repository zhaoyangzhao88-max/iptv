# IPTV 项目交接状态

更新时间：2026-08-07

## 当前目标

本阶段目标已达成：补强 discovery 的隐私与篡改防护、重新验证当前 Python 全量测试、确认 hls.js 固定版本与打包内容、用用户提供的公开 HLS 测试流做真实出画面验证，并为渲染器补充明确 CSP。代码改动已本地提交，但推送因当前环境无法访问 GitHub 而待定。

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

使用用户提供、无需鉴权的公开 HLS 测试流，通过 `window.owlIptv.playChannel()` 走真实播放器管线（player.js + 本地 hls.js 1.6.16）在真实 Electron 中验证（可复用探针 `iptv-project/scripts/real-playback-probe-url.cjs`，`PLAY_URL`/`RUN_NAME` 环境变量驱动）：

1. **Mux TS 流** `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`
   - `readyState=4`、`paused=false`、`error=null`；`currentTime` 从 9.6s 推进到 13.6s（帧在动）。
   - 自适应码率：848×480 → **1920×1080**。
   - 证据：`iptv-project/test-evidence/2026-08-07-public-hls-mux/`。

2. **Apple fMP4 流** `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8`
   - `readyState=4`、播放中、`currentTime` 从 13.2s 推进到 17.2s、1920×1080、无媒体错误。
   - 证据：`iptv-project/test-evidence/2026-08-07-public-hls-apple-fmp4/`。

3. **Akamai 直播流** `https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8`
   - **未出画面**：源端返回 **404**（该测试 host 已退役）。播放器正确走 `levelLoadError → 重试 1 次 → 切换备用线路 → 标记频道不可用`，属于故障处理管线工作正常，非播放器缺陷。
   - 证据：`iptv-project/test-evidence/2026-08-07-public-hls-akamai-live/`。

4. **Unified Tears-of-Steel** `https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8`
   - **未出画面**：manifest 获取在应用 1.5s 连接预算内超时（`manifestLoadTimeOut`），源站从当前网络不可达/过慢。播放器正确 `HLS 连接超时 → 切换备用线路 → 标记频道不可用`。
   - 证据：`iptv-project/test-evidence/2026-08-07-public-hls-tears-of-steel/`。

结论：播放器对**可到达的流真实出画面**（2/2，TS 与 fMP4 均验证）；不可达的 2 个流在两端都验证了故障处理管线正确。

### 渲染器 CSP（本轮新增，已验证）

- `app/index.html` 增加最小 CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss: blob:; font-src 'self' data:; worker-src 'self' blob:`。
- 效果：Electron `Insecure Content-Security-Policy` 安全告警已从渲染器日志消失（验证运行日志 0 条 CSP 警告）。
- 兼容性：在 CSP 生效下重跑 Mux 流真实播放探针仍 `REAL-PLAYBACK OK`（readyState 4、帧推进、1080p）；Player 套件 33/33 通过。`'self'` 在 file:// 协议下可正常放行本地脚本。

### 提交与推送状态

- 本地已提交：`36412c2 feat: harden discovery source admission privacy`（discovery 隐私加固 + 测试 + 文档修正）。
- 本地已提交：`1e842f4 feat: add renderer CSP and URL-driven playback probe`（CSP + 探针）。
- **推送未完成**：当前环境无法访问 github.com / raw.githubusercontent.com（curl 与 git 均超时），`git push` 超时、`git ls-remote` 超时；`origin/master` 停在更早提交，本地 `master` ahead 3。网络恢复后执行 `git push origin master` 即可。

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
- 真实播放探针是人工验证工具，未接入 `npm test`；探针运行会写入 `test-evidence/` 与临时 `user-data`，属于有意的人工验证产物，非只读。
- **推送待办**：`git push origin master` 需网络能访问 GitHub 时执行（当前环境 GitHub 不可达）。

## 下一步开发顺序

1. **推送**：网络恢复后执行 `git push origin master`（本地已有 3 个待推提交，含本轮 2 个）。
2. 可选：接入真实直播源（如某平台公开直播地址）做第三条真实出画面交叉验证；当前 2/2 可到达流已验证。
3. 决定是否提供 `.ico`/品牌信息。
4. 收到明确指示后再做进一步改动；否则保持工作树原样。
