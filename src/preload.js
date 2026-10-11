const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hotline', {
  connect: (config) => ipcRenderer.invoke('connect', config),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  checkAdmin: () => ipcRenderer.invoke('check-admin'),
  getAdapters: () => ipcRenderer.invoke('get-adapters'),
  openNetworkAdapter: () => ipcRenderer.invoke('open-network-adapter'),
  setDnsQuick: (profile) => ipcRenderer.invoke('set-dns-quick', profile),
  getCurrentDns: () => ipcRenderer.invoke('get-current-dns'),
  testConnections: () => ipcRenderer.invoke('test-connections'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  onLog: (callback) => ipcRenderer.on('backend-log', (_, msg) => callback(msg)),
  onTrayToggle: (callback) => ipcRenderer.on('tray-toggle-connect', callback),
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  maximize: () => ipcRenderer.send('window-maximize'),
})
