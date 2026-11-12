'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  // 文件
  openDialog: () => ipcRenderer.invoke('file:openDialog'),
  readPdf: p => ipcRenderer.invoke('file:read', p),
  saveAnnotated: payload => ipcRenderer.invoke('file:saveAnnotated', payload),
  exportText: payload => ipcRenderer.invoke('file:exportText', payload),
  exportBundle: payload => ipcRenderer.invoke('file:exportBundle', payload),
  palette: () => ipcRenderer.invoke('app:palette'),
  product: () => ipcRenderer.invoke('app:product'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  reveal: p => ipcRenderer.invoke('file:reveal', p),
  openExternal: u => ipcRenderer.invoke('app:openExternal', u),
  // 引擎
  workerSource: () => ipcRenderer.invoke('engine:workerSource'),
  // 启动参数 / 菜单事件
  consumeInitialFile: () => ipcRenderer.invoke('app:consumeInitialFile'),
  onOpenFile: cb => ipcRenderer.on('file:open', (_e, p) => cb(p)),
  onMenuOpen: cb => ipcRenderer.on('menu:open', () => cb()),
  onMenuExport: cb => ipcRenderer.on('menu:export', () => cb()),
  onMenuFind: cb => ipcRenderer.on('menu:find', () => cb()),
  onMenuZoom: cb => ipcRenderer.on('menu:zoom', (_e, v) => cb(v)),
  onMenuReveal: cb => ipcRenderer.on('menu:reveal', () => cb()),
  onMenuHelp: cb => ipcRenderer.on('menu:help', () => cb()),
  onMenuUpdate: cb => ipcRenderer.on('menu:update', () => cb()),
  onMenuLicense: cb => ipcRenderer.on('menu:license', () => cb()),
  onMenuAbout: cb => ipcRenderer.on('menu:about', () => cb()),
  // 数据
  loadData: () => ipcRenderer.invoke('store:load'),
  saveData: d => ipcRenderer.invoke('store:save', d),
  saveDataSync: d => ipcRenderer.sendSync('store:saveSync', d),
  storeWarning: () => ipcRenderer.invoke('store:warning'),
  backupData: tag => ipcRenderer.invoke('store:backup', tag || 'manual'),
  importBackup: () => ipcRenderer.invoke('file:importBackup'),
  applyBackup: payload => ipcRenderer.invoke('store:import', payload),
  // 关窗 flush
  onFlush: cb => ipcRenderer.on('app:flush', () => cb()),
  flushDone: () => ipcRenderer.send('app:flushDone'),
  onMenuImport: cb => ipcRenderer.on('menu:import', () => cb())
});
