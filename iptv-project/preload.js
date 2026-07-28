const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// preload.js 位于项目根目录，__dirname 即为项目根路径
const APP_ROOT = __dirname;

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-min'),
  closeWindow: () => ipcRenderer.send('window-close'),
  readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
  writeFile: (filePath, data) => { fs.writeFileSync(filePath, data, 'utf8'); },
  pathJoin: (...segments) => path.join(...segments),
  getAppPath: () => APP_ROOT
});
