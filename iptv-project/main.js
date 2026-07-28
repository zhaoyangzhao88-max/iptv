const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let nodeServerProcess = null;

function startNodeMicroservice() {
  const serverPath = path.join(__dirname, '..', 'iptv-engine-b', 'node_api', 'src', 'redirect_api.js');

  try {
    nodeServerProcess = fork(serverPath, [], {
      env: { ...process.env, PORT: '3000' },
      stdio: 'pipe',
      silent: true,
    });

    nodeServerProcess.stdout.on('data', (data) => {
      console.log(`[NodeAPI] ${data.toString().trim()}`);
    });

    nodeServerProcess.stderr.on('data', (data) => {
      console.warn(`[NodeAPI:err] ${data.toString().trim()}`);
    });

    nodeServerProcess.on('error', (err) => {
      console.error('[NodeAPI] Failed to start microservice:', err.message);
      nodeServerProcess = null;
    });

    nodeServerProcess.on('exit', (code) => {
      console.log(`[NodeAPI] Microservice exited with code ${code}`);
      nodeServerProcess = null;
    });

    console.log('[NodeAPI] Microservice started on port 3000');
  } catch (err) {
    console.error('[NodeAPI] Could not start microservice:', err.message);
    nodeServerProcess = null;
  }
}

function stopNodeMicroservice() {
  if (nodeServerProcess && !nodeServerProcess.killed) {
    nodeServerProcess.kill('SIGTERM');
    // Give the child process 3 seconds to exit gracefully
    setTimeout(() => {
      if (nodeServerProcess && !nodeServerProcess.killed) {
        nodeServerProcess.kill('SIGKILL');
      }
    }, 3000);
    nodeServerProcess = null;
    console.log('[NodeAPI] Microservice stopped.');
  }
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

  ipcMain.on('window-min', () => mainWindow.minimize());
  ipcMain.on('window-close', () => mainWindow.close());

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
}

app.whenReady().then(() => {
  startNodeMicroservice();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  stopNodeMicroservice();
});
