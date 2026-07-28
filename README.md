# IPTV 聚合引擎 + 播放器

> IPTV channel aggregation engine + Electron player

## 📁 项目结构

```
iptv/
├── iptv-engine-b/          # 🔧 数据引擎 (Python + Node.js)
│   ├── python_engine/      #   Python 核心：频道抓取/清洗/测速/排序/导出
│   │   ├── src/            #   main.py 14 步流水线
│   │   └── tests/          #   pytest 测试套件
│   ├── node_api/           #   Node.js 重定向微服务 (B站/抖音/快手 流解析)
│   └── .github/workflows/  #   CI/CD 自动化
│
├── iptv-project/           # 🖥️ Electron 播放器前端
│   ├── main.js             #   Electron 主进程
│   ├── app/                #   前端界面 (ES Modules)
│   │   ├── modules/        #   8 个模块（播放器、状态、虚拟网格等）
│   │   ├── index.html      #   三栏式 TV 风格界面
│   │   └── style.css       #   赛博朋克暗黑主题
│   ├── data/               #   频道数据
│   └── tests/              #   前端测试
│
├── AUDIT_RESULT.md         # 📋 多阶段审计报告
└── README.md               # 本文件
```

## 🚀 快速开始

### 数据引擎

```bash
cd iptv-engine-b
pip install -r python_engine/requirements.txt
python python_engine/src/main.py
```

### 前端播放器

```bash
cd iptv-project
npm install
npm start
```

### Node.js 微服务

```bash
cd iptv-engine-b/node_api
node src/redirect_api.js
```

## 🧪 测试

```bash
# Python 全量测试
python -m pytest iptv-engine-b/python_engine/tests/ -v

# Node.js API 测试
cd iptv-engine-b/node_api && node --test tests/*.test.js

# 前端测试
cd iptv-project && node tests/test_lesson_10.js
```

## 📦 打包

```bash
cd iptv-project
npm run dist  # 生成 dist/OwlIPTV.exe 便携版
```

## ✨ 特性

- **频道聚合**：从多个 M3U 源自动抓取、去重、清洗频道名称
- **智能测速**：异步 TS 级二进制探针 + 302 劫持检测 + 广告关键词过滤
- **信誉系统**：基于历史测速信誉分的自动淘汰机制
- **组播支持**：UDP/RTP 组播源自动识别与隔离
- **直播平台解析**：B站/抖音/快手 真实流地址动态解析（含降级）
- **虚拟网格**：2 列大卡片 TV 风格滚动 + 键盘遥控器导航
- **主备切换**：HLS.js 多线路自动故障转移
