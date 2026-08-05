const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-min'),
  closeWindow: () => ipcRenderer.send('window-close'),
  readPublicSnapshot: () => ipcRenderer.invoke('read-public-snapshot'),
  getNodeReadiness: () => ipcRenderer.invoke('get-node-readiness'),
  writeDiagnosticReport: (content) => ipcRenderer.invoke('write-diagnostic-report', content),
});
