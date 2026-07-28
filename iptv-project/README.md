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

`index.html` 已引用本地 `style.css`、后续 `app.js`，以及 Hls.js CDN：

```text
https://cdn.jsdelivr.net/npm/hls.js@latest
```
