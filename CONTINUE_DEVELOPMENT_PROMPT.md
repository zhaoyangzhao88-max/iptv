# IPTV 项目跨电脑继续开发提示词

把代码克隆到新电脑后，打开 Claude Code，并将下面整段内容作为第一条提示词发送。

---

## 继续开发提示词

你现在接手的是一个 IPTV 单仓库项目。请先不要直接修改代码，也不要执行破坏性 Git 操作。先全面恢复开发上下文，再根据验证结果继续工作。

### 项目位置和基本信息

- 项目是 Windows 优先的个人本地 IPTV 播放器。
- 根目录包含：
  - `iptv-engine-b/`：Python 数据引擎和 Node redirect 微服务；
  - `iptv-project/`：Electron 播放器；
  - `.github/workflows/`：GitHub Actions 数据刷新流程。
- 当前主要开发目标是完善 P0 生产链路、质量门禁、Node 特殊平台 redirect、Electron 多数据源隔离和播放器可靠性。
- 不要假设文档中的历史测试数字仍然准确，必须以当前代码实际运行结果为准。

### 第一步：恢复现场，只读检查

请先执行并报告：

```powershell
git status --short --untracked-files=all
git branch -avv
git log --oneline --decorate -12
git stash list
```

然后阅读这些文件：

```text
README.md
OPTIMIZATION_PLAN.md
AUDIT_RESULT.md
package.json
iptv-project/package.json
iptv-engine-b/pyproject.toml
```

重点确认：

1. 当前分支和最近提交；
2. 是否存在未提交的业务代码、测试、计划文档或数据文件；
3. 是否存在 stash；
4. 是否有用户未提交的数据产物；
5. 不要执行 `git reset --hard`、`git clean -fd`、`git checkout --` 或删除 stash，除非我明确要求。

### 第二步：安装依赖并验证基线

如果依赖尚未安装：

```powershell
npm ci --prefix iptv-project
```

如果根目录将来增加了 lockfile，应优先使用根目录 lockfile；不要擅自升级依赖。

然后运行完整测试：

```powershell
npm test
```

必要时分别运行：

```powershell
npm run test:node
npm run test:python
npm run test:player
```

报告每个套件的真实通过数、失败数、警告和退出码。测试失败时先定位原因，不要为了让测试通过而删除或弱化测试。

### 第三步：验证 Electron 和 Node readiness

先验证开发模式：

```powershell
npm start --prefix iptv-project
```

确认：

- Electron 窗口实际出现且响应；
- Node 子服务启动；
- 服务只监听 `127.0.0.1:3000`；
- `http://127.0.0.1:3000/health` 返回成功；
- 应用能读取 `iptv-project/data/channels.json`；
- 没有明显的 ESM、数据契约或 preload 错误。

验证结束后，确认 Electron 及 Node 子进程都已退出。

### 第四步：检查打包能力

运行：

```powershell
npm run dist --prefix iptv-project
```

确认：

- Windows portable 文件生成；
- `iptv-project/dist/win-unpacked/` 生成；
- `resources/app.asar` 存在；
- `resources/node_api/` 存在；
- 打包版可以启动；
- 打包版的 Node 子服务仍然能通过 `/health`。

不要把 `node_modules/`、`dist/`、临时日志或本地用户数据提交到 Git，除非项目的 `.gitignore` 和产品要求明确规定需要提交。

### 当前已知验证基线

在上一台电脑上，以下验证已经通过，但换电脑后必须重新确认：

```text
Node API：41/41 通过
Python：160/160 通过
前端：13/13 通过
根 npm test：通过
Electron 开发模式启动：通过
开发模式 Node readiness：通过
Windows portable 构建：通过
打包版未解包目录启动：通过
打包版 Node extraResources：通过
打包版 /health：通过
```

### 当前已知待处理事项

请先检查这些问题是否仍然存在，再决定修复顺序：

1. Node redirect 默认 allowlist 中的 wildcard 子域名是否过宽，例如 `*.bilibili.com`、`*.douyin.com`、`*.kuaishou.com`；
2. `quality_gate.py` 的拒绝消息是否会把敏感键名直接写进日志或对外报告；
3. `iptv-project/app/index.html` 是否仍然依赖 `https://cdn.jsdelivr.net/npm/hls.js@latest`，从而导致离线播放不可靠；
4. `__providedFields` 非枚举属性是否适合远程数据合并流程；
5. 打包配置中是否需要补 `author` 和正式应用图标；
6. 是否还缺少真实频道播放、备用线路切换和诊断报告脱敏验证；
7. 是否存在未提交的 `iptv-project/data/channels.json` 用户数据刷新结果。不要擅自覆盖、回滚或清理该数据文件。

### 开始修改前的工作方式

- 先给出当前现场总结和建议计划；
- 多文件或跨模块修改前先说明影响范围；
- 修改前保留用户已有未提交内容；
- 不要应用旧 stash 覆盖当前分支；
- 代码、测试、文档修改分开考虑；
- 每完成一个逻辑单元就运行对应测试；
- 不要把临时测试产物、Token、完整播放 URL 或本地隐私数据写入 Git；
- 对安全、网络边界、redirect、文件写入和发布流程使用更严格的审查标准；
- 最后必须再次运行测试，并报告真实结果。

### 推荐的下一步

完成恢复检查后，优先进行一次只读代码审查，确认当前分支相对上述基线的变化。然后按以下顺序推进：

1. 修复或明确 Node wildcard allowlist 策略；
2. 脱敏 quality gate 的对外错误消息；
3. 决定是否把 Hls.js 固定为本地依赖；
4. 增加或执行播放器真实播放和备用线路验证；
5. 检查 portable 构建和退出清理；
6. 通过测试和审查后，再拆分为清晰的 Git 提交。

请先完成现场检查和测试，不要直接开始大规模重构。

---

## 新电脑上的辅助命令

克隆后可以先执行：

```powershell
git clone <你的仓库地址>
cd iptv
npm ci --prefix iptv-project
npm test
```

如果 Python 环境尚未准备好，再根据 `iptv-engine-b/python_engine/requirements.txt` 和 `iptv-engine-b/pyproject.toml` 安装依赖。

如果需要继续使用该提示词，直接把本文件内容复制给 Claude Code 即可。

## 推送前提醒

在旧电脑推送前，建议先确认：

```powershell
git status --short --untracked-files=all
git diff --check
git diff --stat
```

确认没有以下内容后再提交和推送：

- Token、账号、完整带参数播放 URL；
- 本地诊断报告；
- `node_modules/`；
- `dist/`；
- 临时缓存和日志；
- 不希望公开的数据快照。

建议先提交代码，再推送：

```powershell
git add <确认过的文件>
git commit -m "chore: preserve IPTV development progress"
git push origin master
```

如果当前仓库中混有不想公开的频道数据或敏感 URL，不要直接使用 `git add -A`；应先逐个检查和选择文件。
