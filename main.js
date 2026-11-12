'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const { writeAnnotations, COLORS, COLOR_NAMES } = require('./lib/pdf-annotate');
const { writeBundle } = require('./lib/export-bundle');
const backups = require('./lib/backup');
const product = require('./lib/product');
const updater = require('./lib/update');

let win = null;
let initialFile = null;

function findPdfArg(argv) {
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i++) {
    const a = String(list[i] || '');
    if (/\.pdf$/i.test(a) && !a.startsWith('--')) {
      try { if (fs.existsSync(a)) return a; } catch (e) {}
    }
  }
  return null;
}
initialFile = findPdfArg(process.argv);

store.init(app.getPath('userData'));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    const p = findPdfArg(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (p) win.webContents.send('file:open', p);
    } else if (p) initialFile = p;
  });
}

function sendOpen(p) { if (win && p) win.webContents.send('file:open', p); }
app.on('open-file', (e, p) => { e.preventDefault(); if (win) sendOpen(p); else initialFile = p; });

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 640,
    title: product.name,
    backgroundColor: '#f6f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
  win.on('close', onWindowClose);
  buildMenu();
}

/* 关窗前先让 renderer 把最后一次编辑落盘，再销毁窗口。
 * beforeunload 里的异步 IPC 来不及完成，这里显式等一次 flushDone（2s 超时兜底）。*/
function onWindowClose(e) {
  if (!win || win.__flushing) return;
  const w = win, wc = w.webContents;
  if (wc.isDestroyed()) return;
  w.__flushing = true;
  e.preventDefault();

  let finished = false, timer = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    ipcMain.removeListener('app:flushDone', onDone);
    if (!w.isDestroyed()) w.destroy();
  };
  const onDone = () => finish();
  ipcMain.on('app:flushDone', onDone);
  timer = setTimeout(finish, 2000);
  try { wc.send('app:flush'); } catch (err) { finish(); }
}

function buildMenu() {
  const tpl = [
    {
      label: '文件', submenu: [
        { label: '打开 PDF…', accelerator: 'CmdOrCtrl+O', click: () => win && win.webContents.send('menu:open') },
        { label: '导出中心…', accelerator: 'CmdOrCtrl+E', click: () => win && win.webContents.send('menu:export') },
        { label: '导入备份 / 恢复数据…', click: () => win && win.webContents.send('menu:import') },
        { type: 'separator' },
        { label: '在文件夹中显示当前 PDF', click: () => win && win.webContents.send('menu:reveal') },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '编辑', submenu: [
        { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
        { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图', submenu: [
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => win && win.webContents.send('menu:zoom', 1) },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => win && win.webContents.send('menu:zoom', -1) },
        { label: '适应宽度', accelerator: 'CmdOrCtrl+0', click: () => win && win.webContents.send('menu:zoom', 0) },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => win && win.webContents.send('menu:find') },
        { type: 'separator' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { label: '重新加载', role: 'reload' }
      ]
    },
    {
      label: '帮助', submenu: [
        { label: '使用帮助', click: () => win && win.webContents.send('menu:help') },
        { label: '检查更新…', click: () => win && win.webContents.send('menu:update') },
        { type: 'separator' },
        { label: '许可信息', click: () => win && win.webContents.send('menu:license') },
        { label: '关于 ' + product.name, click: () => win && win.webContents.send('menu:about') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* ---------------- IPC ---------------- */
ipcMain.handle('engine:workerSource', () => {
  return fs.readFileSync(path.join(__dirname, 'renderer', 'vendor', 'pdf.worker.min.js'), 'utf8');
});
// 颜色表只有一个数据源（lib/pdf-annotate.js），前端色板从这里读
ipcMain.handle('app:palette', () => ({ colors: COLORS, names: COLOR_NAMES }));
ipcMain.handle('app:product', () => product);
ipcMain.handle('app:checkUpdate', () => updater.check());
ipcMain.handle('app:initialFile', () => initialFile);
ipcMain.handle('app:consumeInitialFile', () => { const p = initialFile; initialFile = null; return p; });

ipcMain.handle('file:openDialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择 PDF', properties: ['openFile'],
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle('file:read', async (_e, p) => {
  if (!p || !/\.pdf$/i.test(p)) throw new Error('不是 PDF 路径');
  const b = fs.readFileSync(p);
  return { name: path.basename(p), path: p, size: b.length, bytes: new Uint8Array(b) };
});

ipcMain.handle('file:saveAnnotated', async (_e, payload) => {
  const srcPath = payload && payload.srcPath;
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error('源 PDF 不存在：' + srcPath);
  const base = path.basename(srcPath, path.extname(srcPath));
  const dir = path.dirname(srcPath);
  const r = await dialog.showSaveDialog(win, {
    title: '保存带标注的 PDF',
    defaultPath: path.join(dir, base + '-标注.pdf'),
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  const target = r.filePath;
  const src = fs.readFileSync(srcPath);
  const out = await writeAnnotations(src, payload.annotations || [], payload.pageSizes || []);
  fs.writeFileSync(target, Buffer.from(out.bytes));
  return { ok: true, path: target, count: out.count };
});

ipcMain.handle('file:reveal', (_e, p) => { if (p) shell.showItemInFolder(p); return true; });
ipcMain.handle('app:openExternal', (_e, u) => { if (/^https?:\/\//i.test(u)) shell.openExternal(u); return true; });

ipcMain.handle('store:load', () => store.load());
ipcMain.handle('store:save', (_e, d) => store.save(d));
// beforeunload 专用：同步 IPC，保证窗口销毁前一定写完
ipcMain.on('store:saveSync', (e, d) => {
  try { store.save(d); e.returnValue = true; }
  catch (err) { console.error('同步保存失败', err); e.returnValue = false; }
});
ipcMain.handle('store:warning', () => store.lastWarning());
ipcMain.handle('store:backup', (_e, tag) => store.backup(tag || 'manual'));

ipcMain.handle('file:importBackup', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择 PDF Studio 备份文件',
    properties: ['openFile'],
    filters: [{ name: 'JSON 备份', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
  try { return { ok: true, path: r.filePaths[0], text: fs.readFileSync(r.filePaths[0], 'utf8') }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
});

/* 导入：解析 → 留一份导入前副本 → 合并/覆盖 → 原子写盘，返回新数据给 renderer 刷新 */
ipcMain.handle('store:import', (_e, payload) => {
  const p = payload || {};
  const parsed = backups.parse(p.text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const current = store.load();
  const before = store.backup('before-import');
  const next = p.mode === 'replace'
    ? backups.replaceData(parsed.data)
    : backups.mergeData(current, parsed.data);
  store.save(next);
  return { ok: true, data: next, stats: parsed.stats, before: before };
});

// 一键打包：选一个文件夹，同时写出带注释 PDF + 若干文本成品
ipcMain.handle('file:exportBundle', async (_e, payload) => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择导出文件夹',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '导出到这里'
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
  return await writeBundle(r.filePaths[0], payload);
});

ipcMain.handle('file:exportText', async (_e, payload) => {
  const r = await dialog.showSaveDialog(win, {
    title: '导出', defaultPath: payload && payload.defaultName || 'export.md',
    filters: [{ name: '文本', extensions: [(payload && payload.ext) || 'md'] }]
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, String(payload && payload.text || ''), 'utf8');
  return { ok: true, path: r.filePath };
});
