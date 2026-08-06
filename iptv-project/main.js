const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { waitForHealth, stopChild } = require('./app/nodeReadiness.cjs');

const MAX_REPORT_BYTES = 1024 * 1024;
let nodeServerProcess = null;
let nodeReadiness = { ready: false, host: '127.0.0.1', port: 3000, error: null };

function isTrustedSender(event, window) {
  return event.sender === window.webContents;
}

function registerWindowIpc(mainWindow) {
  ipcMain.on('window-min', (event) => {
    if (isTrustedSender(event, mainWindow)) mainWindow.minimize();
  });
  ipcMain.on('window-close', (event) => {
    if (isTrustedSender(event, mainWindow)) mainWindow.close();
  });
  ipcMain.handle('get-node-readiness', (event) => {
    if (!isTrustedSender(event, mainWindow)) throw new Error('untrusted sender');
    return { ...nodeReadiness };
  });
  ipcMain.handle('read-public-snapshot', (event) => {
    if (!isTrustedSender(event, mainWindow)) throw new Error('untrusted sender');
    const snapshotPath = path.join(__dirname, 'data', 'channels.json');
    return fs.readFileSync(snapshotPath, 'utf8');
  });
  ipcMain.handle('write-diagnostic-report', (event, content) => {
    if (!isTrustedSender(event, mainWindow)) throw new Error('untrusted sender');
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_REPORT_BYTES) {
      throw new Error('diagnostic report is too large');
    }
    const reportDirectory = path.join(app.getPath('userData'), 'reports');
    const reportPath = path.join(reportDirectory, 'playback_client_report.md');
    fs.mkdirSync(reportDirectory, { recursive: true });
    const temporaryPath = `${reportPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, content, 'utf8');
    fs.renameSync(temporaryPath, reportPath);
    return reportPath;
  });
}

async function startNodeMicroservice() {
  let serverPath;
  if (app.isPackaged) {
    serverPath = path.join(process.resourcesPath, 'node_api', 'src', 'redirect_api.js');
  } else {
    serverPath = path.join(__dirname, '..', 'iptv-engine-b', 'node_api', 'src', 'redirect_api.js');
  }

  try {
    nodeReadiness = { ...nodeReadiness, ready: false, error: null };
    nodeServerProcess = fork(serverPath, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: '3000' },
      stdio: 'pipe',
      silent: true,
    });

    const child = nodeServerProcess;
    child.stdout.on('data', (data) => console.log(`[NodeAPI] ${data.toString().trim()}`));
    child.stderr.on('data', (data) => console.warn(`[NodeAPI:err] ${data.toString().trim()}`));
    child.on('error', (err) => {
      nodeReadiness = { ...nodeReadiness, ready: false, error: err.message };
      console.error('[NodeAPI] Failed to start microservice:', err.message);
    });
    child.on('exit', (code) => {
      nodeReadiness = { ...nodeReadiness, ready: false, error: code === 0 ? null : `exited with code ${code}` };
      console.log(`[NodeAPI] Microservice exited with code ${code}`);
      if (nodeServerProcess === child) nodeServerProcess = null;
    });

    const readiness = await waitForHealth({ isChildAlive: () => child.exitCode === null && !child.killed });
    nodeReadiness = { ready: true, host: readiness.host, port: readiness.port, error: null };
    console.log('[NodeAPI] Microservice ready on 127.0.0.1:3000');
    return readiness;
  } catch (err) {
    nodeReadiness = { ...nodeReadiness, ready: false, error: err.message };
    console.error('[NodeAPI] Could not start microservice:', err.message);
    const child = nodeServerProcess;
    nodeServerProcess = null;
    if (child && !child.killed) child.kill('SIGTERM');
    throw err;
  }
}

function stopNodeMicroservice() {
  const child = nodeServerProcess;
  if (!child) return Promise.resolve(false);
  nodeReadiness = { ...nodeReadiness, ready: false };
  return stopChild(child).then((killed) => {
    if (nodeServerProcess === child) nodeServerProcess = null;
    console.log(`[NodeAPI] Microservice stopped${killed ? ' forcefully' : ''}.`);
    return killed;
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    center: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  registerWindowIpc(mainWindow);

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
}

app.whenReady().then(async () => {
  try {
    await startNodeMicroservice();
    createWindow();
  } catch (_) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', (event) => {
  if (nodeServerProcess) {
    event.preventDefault();
    stopNodeMicroservice().finally(() => app.quit());
  }
});
