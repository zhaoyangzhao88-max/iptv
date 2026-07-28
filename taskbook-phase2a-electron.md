本文是你唯一任务来源。换会话先读 PROGRESS.md。目的：Electron 安全加固——关 nodeIntegration，preload.js 暴露 IPC+文件读写，适配 app.js。不破坏功能>简洁>速度。

## 我替领导拍的板

- 只做安全加固（preload/main.js/app.js IPC 适配），不拆 app.js 模块
- v1 模块跳过（依赖断裂），Python 优化另开任务书 B
- 基线 82/82 测试绿灯不可退

## 界限

只改：`iptv-project/main.js`、`iptv-project/preload.js`（新建）、`iptv-project/app/app.js`。不改 HTML/CSS/Python/playlists/data。不新增 npm 依赖。顺手活进 BLOCKED.md。

## 现状（2026-07-27）

main.js：`nodeIntegration:true, contextIsolation:false, webSecurity:false`。已有 `window-min`/`window-close` IPC handler。

app.js 2776 行，用了 3 类 Node API：
- L34-36：`require('electron').ipcRenderer` → 窗口最小化/关闭（L1860/1865）
- L88-99：`getAvailableNodeModules()` → `require('fs')`+`require('path')`
- L404-405：`fs.readFile` 读 `data/channels.json`；L2290-2296：`fs.writeFileSync` 写诊断报告
- 引用了 `__dirname`（L404）→ contextIsolation 下不可用

核心问题：开 contextIsolation 后 `require()` 和 `__dirname` 在渲染进程全部失效。

**任务0 基线**
```bash
grep -c "nodeIntegration: true" iptv-project/main.js
wc -l iptv-project/app/app.js
grep -c "electronIpcRenderer\|getAvailableNodeModules" iptv-project/app/app.js
```
期望 1 / 2776 / >0。

## 任务1 创建 preload.js

`contextBridge.exposeInMainWorld('electronAPI', {...})`，暴露：`minimizeWindow`/`closeWindow`（ipcRenderer.send）、`readFile`/`writeFile`（fs 同步）、`pathJoin`/`pathDirname`（path 工具）、`getAppPath`（返回 __dirname）。

```bash
test -f iptv-project/preload.js && echo "PASS: file exists"
grep -q "contextBridge" iptv-project/preload.js && echo "PASS: contextBridge"
grep -q "minimizeWindow\|closeWindow" iptv-project/preload.js && echo "PASS: IPC"
grep -q "readFile\|writeFile" iptv-project/preload.js && echo "PASS: fs"
```
反向验证：故意漏掉 `readFile`→验收应红灯。

## 任务2 修改 main.js

webPreferences 改为：`nodeIntegration: false`、`contextIsolation: true`、`preload: path.join(__dirname, 'preload.js')`。已有 IPC handler 不动。

```bash
grep -q "nodeIntegration: false" iptv-project/main.js && echo "PASS"
grep -q "contextIsolation: true" iptv-project/main.js && echo "PASS"
grep -q "preload:" iptv-project/main.js && echo "PASS"
```

## 任务3 适配 app.js

**三步替换（只改 Node API 调用，不动 UI/播放器逻辑）：**

A. 删 L31-36 和 L88-99，替换为 `const electronAPI = window?.electronAPI || null;`
B. `nodeModules.fs.readFile(dataPath, ...)` → `electronAPI.readFile(dataPath)`（同步）。`__dirname` 用 `electronAPI.getAppPath()` 替代。
C. `electronIpcRenderer.send('window-min')` → `electronAPI.minimizeWindow()`

```bash
! grep -q "getAvailableNodeModules\|electronIpcRenderer\|require('electron')\|require('fs')" iptv-project/app/app.js && echo "PASS: old API removed"
grep -q "electronAPI" iptv-project/app/app.js && echo "PASS: new API used"
```

## 规矩

- 不新增 npm 依赖，不改 Electron 版本
- 不删 app.js UI/播放器逻辑
- preload 不暴露 `ipcRenderer.on`（防注入）
- 连败 3 次跳下一项

## 完成条件

1. main.js 三项安全配置全改 + preload 加载
2. app.js 零 `require()` 残留
3. Electron 启动：频道列表正常加载、窗口控制按钮可用
4. 浏览器打开 index.html 不报错（`electronAPI` 为 null 时优雅降级）
5. 交付 BLOCKED.md + PROGRESS.md
