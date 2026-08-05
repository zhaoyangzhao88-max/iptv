# IPTV 项目整理说明

本项目已按“直播源处理流水线”整理目录结构，避免脚本、原始播放列表、清洗结果和前端文件混放在根目录。

## 目录结构

```text
iptv-project/
├─ main.js                      # Electron 启动入口
├─ package.json                 # Electron/NPM 项目配置
├─ package-lock.json            # NPM 依赖锁定文件
│
├─ app/                         # 前端页面
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
│
├─ scripts/                     # Python 辅助脚本
│  └─ _test_sources.py
│
├─ playlists/                   # M3U 播放列表
│  ├─ raw/                      # 原始或中间播放列表
│  │  ├─ my_cn.m3u
│  │  ├─ all_china_local.m3u
│  │  └─ premium_china_local.m3u
│  └─ processed/                # 清洗、检测、去重后的播放列表
│     ├─ premium_cn.m3u
│     ├─ final_cn.m3u
│     └─ perfect_china_local.m3u
│
├─ data/                        # 检测报告和前端数据
│  ├─ channels.json
│  └─ stream_report.md
│
├─ node_modules/                # Electron 依赖目录，已加入 .gitignore
├─ .gitignore
└─ README.md
```

## 直播源数据处理

直播源数据的抓取、清洗、测速、去重和 `channels.json` 生成已统一由 **iptv-engine-b**（数据发动机）自动化完成，详见 `../iptv-engine-b/handover_manual.md`。

## Electron 前端启动

如果只想打开当前播放器界面，可以运行：

```bash
npm start
```

`main.js` 已更新为加载 `app/index.html`。

## 前端

前端文件位于 `app/`：

- `index.html`：三栏式 IPTV 播放界面骨架
- `style.css`：深邃暗黑极客风样式
- `app.js`：后续用于频道数据绑定、播放器控制和状态面板更新

`index.html` 已引用本地 `style.css`、后续 `app.js`，以及锁定版本的本地 Hls.js bundle：

```text
./node_modules/hls.js/dist/hls.min.js
```

Hls.js 版本在 `package.json` 中使用精确版本号锁定，并随 Electron 应用一起打包，因此播放器启动不依赖 jsDelivr 或其他外部 CDN。当前 Windows 构建保持 portable 目标；Windows 图标暂未配置，待正式 `.ico` 品牌资产提交后再加入构建配置。代码签名和发布者身份也需要正式发布信息后单独配置。

## 发布与 redirect 安全边界

- 播放器继续使用本地锁定的 Hls.js bundle，避免 CDN 漂移和离线启动失败。
- Node redirect 服务只接受 HTTPS、无凭据且命中平台 allowlist 的最终播放 URL；上游 API/页面地址不自动视为播放地址。例如 `api.live.bilibili.com` 仅用于解析，不默认作为 redirect 目标。
- 动态 CDN 主机只有在确认由对应 resolver 返回后，才添加最窄的平台级 allowlist 条目；不使用 `*.com`、`*.cn` 等宽泛 wildcard，也不自动发现并放行主机。
- resolver 失败保持可重试的 `503`，不会重定向到 `m3u8BaseUrl` 占位地址。
- 真实网络 E2E、上游页面/API 契约变化和未来未观测 CDN 不作为稳定 CI 依赖；应使用注入 fixture 测试并在发布前另行验证。
