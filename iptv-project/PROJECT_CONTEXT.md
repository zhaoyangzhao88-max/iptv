# IPTV 项目上下文说明

这份文档用于帮助其他大模型快速理解 `E:\vscode\iptv-project` 项目的目录结构、文件作用、内容摘要、运行流程和后续开发约束。

## 1. 项目定位

这是一个 **IPTV 直播源处理 + Electron 前端播放器** 项目。

项目主要做两件事：

1. 从多个公开 M3U 源抓取、合并、检测、清洗中国 IPTV 直播源。
2. 使用 Electron + HTML/CSS/JS 构建一个电视盒风格的三栏式 IPTV 播放界面。

当前项目包含：

- Python 直播源处理脚本
- M3U 原始播放列表
- M3U 清洗后的播放列表
- 健康检测报告
- 前端播放器页面
- Electron 启动入口
- NPM/Electron 依赖配置

## 2. 当前目录结构

```text
iptv-project/
├─ main.js
├─ package.json
├─ package-lock.json
├─ .gitignore
├─ README.md
├─ PROJECT_CONTEXT.md
│
├─ app/
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
│
├─ scripts/
│  └─ _test_sources.py
│
├─ playlists/
│  ├─ raw/
│  │  ├─ my_cn.m3u
│  │  ├─ all_china_local.m3u
│  └─ └─ premium_china_local.m3u
│  └─ processed/
│     ├─ premium_cn.m3u
│     ├─ final_cn.m3u
│     └─ perfect_china_local.m3u
│
├─ data/
│  ├─ channels.json
│  └─ stream_report.md
│
└─ node_modules/
```

> 注意：当前 `index.html` 已引用 `app.js`，但 `app.js` 尚未创建。后续核心控制逻辑应写入 `app/app.js`。

## 3. 根目录文件说明

### `main.js`

Electron 主进程入口。

主要作用：

- 创建 `BrowserWindow`
- 设置窗口尺寸为 `1280 x 720`
- 加载前端页面 `app/index.html`

关键内容：

```js
mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
```

注意：

- 当前配置包含：
  - `nodeIntegration: true`
  - `contextIsolation: false`
  - `webSecurity: false`
- 如果后续要增强安全性，需要谨慎调整这些配置，避免破坏本地文件访问或播放逻辑。

### `package.json`

NPM/Electron 项目配置。

主要内容：

```json
{
  "name": "owl-iptv-player",
  "version": "1.0.0",
  "description": "智能电视盒风格精品 IPTV 播放客户端",
  "main": "main.js",
  "scripts": {
    "start": "electron ."
  },
  "devDependencies": {
    "electron": "^31.7.7"
  }
}
```

启动命令：

```bash
npm start
```

### `package-lock.json`

NPM 依赖锁定文件。

作用：

- 锁定 Electron 及其依赖版本
- 保证不同环境安装依赖时尽量一致

### `.gitignore`

Git 忽略规则。

当前忽略：

```gitignore
node_modules/
__pycache__/
*.pyc
.DS_Store
.vscode/
```

### `README.md`

项目简要说明文件。

内容包括：

- 目录结构
- 脚本运行顺序
- 文件流向
- 前端说明
- Electron 启动说明

### `PROJECT_CONTEXT.md`

本文件。

作用：

- 给其他大模型理解项目结构、文件职责、数据流和后续开发约束
- 作为项目上下文摘要，避免其他模型误读目录或破坏流水线

## 4. `app/` 前端目录

### `app/index.html`

前端页面骨架，HTML5 标准页面。

主要作用：

- 定义三栏式 IPTV 播放界面
- 引入本地 `style.css`
- 引入后续创建的 `app/app.js`
- 引入本地固定版本的 Hls.js bundle（`hls.js@1.6.16`），不使用 CDN `latest`：

```html
<script src="../node_modules/hls.js/dist/hls.min.js"></script>
<script type="module" src="./app.js"></script>
```

页面结构：

```html
<main class="app-shell">
  <aside id="category-list">分类导航</aside>
  <section id="channel-grid">频道卡片网格</section>
  <aside id="player-container">
    <video id="video-element" controls playsinline></video>
    <section class="stats-panel">
      <strong id="current-channel"></strong>
      <strong id="current-latency"></strong>
      <strong id="watch-duration"></strong>
    </section>
  </aside>
</main>
```

当前页面中已有示例频道卡片，例如：

- 湖南卫视
- 浙江卫视
- 江苏卫视
- 东方卫视
- 北京卫视
- 广东卫视

后续 `app.js` 应该根据 `data/channels.json` 或 M3U 数据动态渲染这些频道卡片。

### `app/style.css`

前端样式表。

主要作用：

- 设置深邃暗黑极客风主题
- 定义三栏布局：
  - 左侧分类：`20%`
  - 中间频道网格：`35%`
  - 右侧播放器：`45%`
- 适配 `1280x720` 分辨率
- 隐藏横向滚动条
- 美化频道卡片、焦点状态、视频播放器和滚动条

关键设计：

- 主背景色：`#121214`
- 卡片背景色：`#1e1e24`
- 霓虹蓝焦点色：`#00d2ff`
- 绿色延迟标签：`#39ff88`
- 卡片圆角：`8px`

关键 CSS 类：

```css
.app-shell {
  display: grid;
  grid-template-columns: 20% 35% 45%;
}

.channel-card.focused,
.channel-card:focus-visible {
  border: 3px solid #00d2ff;
  box-shadow: 0 0 24px rgba(0, 210, 255, 0.5);
  transform: scale(1.03);
}

#video-element:fullscreen {
  width: 100vw;
  height: 100vh;
  z-index: 2147483647;
}
```

### `app/app.js`

当前尚未创建。

后续应负责：

- 读取 `../data/channels.json`
- 渲染左侧分类导航
- 渲染中间频道卡片
- 点击或键盘选择频道后播放对应 HLS 地址
- 使用 Hls.js 或原生 `<video>` 播放 `.m3u8`
- 更新右侧状态面板：
  - 当前台号
  - 当前延迟
  - 累计观看时长
- 管理焦点状态 `.focused`
- 支持键盘上下左右选择频道

建议后续 `app.js` 不要直接依赖根目录路径，而应根据当前页面位置定位数据文件。

## 5. `scripts/` 脚本目录

> **注意**：M3U 直播源的数据处理（抓取、清洗、测速、去重、导出）已统一迁移至 **iptv-engine-b**（数据发动机），不再由此目录的脚本负责。详见 `../iptv-engine-b/handover_manual.md`。

### `scripts/_test_sources.py`

测试辅助脚本，用于验证直播源可用性。

## 6. `playlists/` 播放列表目录

播放列表文件为历史产出物或 iptv-engine-b 生成的目标文件，供前端播放器消费。

### `playlists/raw/`

存放原始或中间播放列表。

### `playlists/processed/`

存放清洗、优化、去重后的播放列表，适合播放器直接使用。

## 7. `data/` 数据目录

### `data/channels.json`

前端播放器推荐使用的数据源。

结构为 JSON 数组，每个频道对象包含：

```json
{
  "name": "CCTV-1",
  "group": "央视频道",
  "url": "http://38.75.136.137:98/gslb/dsdqpub/cctv1hd.m3u8?auth=testpub",
  "delay_ms": 1839.6
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `name` | 频道名称 |
| `group` | 频道分组，例如 `央视频道`、`卫视频道`、`地方频道` |
| `url` | 播放地址，通常是 `.m3u8` HLS 地址 |
| `delay_ms` | 测速延迟，单位毫秒 |

后续 `app/app.js` 应优先读取该文件渲染频道卡片。

### `data/stream_report.md`

频道健康检测报告。

内容结构：

```markdown
# IPTV 直播源健康检测报告

## 总体体检摘要

- 总检测频道数：148
- 正常数：61
- 异常/死链数：87
- HTTP 错误数：26
- 连接超时数：60
- 网络连接失败数：1

## 频道明细

| # | 频道名 | 分组 | 状态 | 延迟(ms) | 错误详情 | 播放URL |
|---|---|---|---|---:|---|---|
```

状态类型：

| 状态 | 含义 |
|---|---|
| 正常 | 直播源可用 |
| 劫持/非媒体流 | 返回内容不是媒体流，疑似 HTML 劫持 |
| HTTP 错误 | HTTP 状态码异常，例如 403、503、521 |
| 连接超时 | 请求超时 |
| 网络连接失败 | 网络层连接失败 |

## 8. `node_modules/`

NPM/Electron 依赖目录。

作用：

- 存放 Electron 及其依赖
- 不应手动整理或修改
- 已加入 `.gitignore`

其他模型处理项目时，不要尝试把 `node_modules` 的内容作为业务代码阅读或修改，除非明确要排查 Electron 依赖问题。

## 9. 数据流水线与前端启动

直播源数据处理已由 **iptv-engine-b** 自动化完成（详见 `../iptv-engine-b/handover_manual.md`）。前端启动：

```bash
npm start
```

## 10. 后续开发建议

### 应该优先创建 `app/app.js`

`app.js` 应承担播放器核心逻辑：

1. 读取 `../data/channels.json`
2. 按 `group` 生成左侧分类
3. 按当前分类渲染中间频道卡片
4. 点击频道后：
   - 设置 `.focused`
   - 更新当前频道名
   - 更新延迟
   - 使用 Hls.js 或原生 `<video>` 播放 `url`
5. 监听 `timeupdate` 或 `play` 状态，累计观看时长
6. 支持键盘方向键切换频道
7. 支持回车键播放频道

### 不要破坏现有目录约定

后续新增文件建议遵守：

```text
app/       → 前端页面、样式、脚本
scripts/   → Python 数据处理脚本
data/      → JSON、Markdown 报告等数据
playlists/ → M3U 播放列表
```

### 不要再引入根目录硬编码路径

所有脚本应继续使用：

```python
PROJECT_DIR = Path(__file__).resolve().parents[1]
```

不要写死：

```python
E:\vscode\iptv-project\...
```

### 前端读取数据时的路径建议

由于 `index.html` 位于：

```text
app/index.html
```

而数据位于：

```text
data/channels.json
```

前端相对路径建议为：

```text
../data/channels.json
```

如果 Electron 本地文件读取受限，后续可能需要：

- 使用 `fetch('../data/channels.json')`
- 或通过 `main.js` 暴露 IPC 读取文件
- 或将 JSON 内联到前端构建产物中

## 11. 给其他大模型的简要任务理解

如果另一个大模型要接手本项目，应理解为：

> 这是一个 IPTV 直播源清洗与播放项目。Python 脚本负责从公开源抓取、检测、清洗、去重 M3U 直播源，并生成 `data/channels.json` 和 `playlists/processed/*.m3u`。Electron 前端负责用三栏电视盒风格界面展示频道，并通过 Hls.js 播放 HLS 直播流。当前最关键的未完成部分是 `app/app.js`，它需要把 `data/channels.json` 绑定到页面，实现频道选择、HLS 播放、延迟显示和观看时长统计。
