'use strict';
const fs = require('fs');
const path = require('path');

let FILE = null;
let warning = '';
let lastBackupAt = 0;
const BACKUP_INTERVAL = 60 * 1000;   // .bak 最多每分钟滚动一次，避免每次按键都复制整份数据

function init(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  FILE = path.join(userDataDir, 'studio-data.json');
  warning = '';
  lastBackupAt = 0;
  return FILE;
}
function blank() {
  return {
    version: 1,
    folders: [],      // {id,name,parent}
    notes: [],        // {id,title,folder,body,tags,order,source,createdAt,updatedAt}
    annotations: {},  // pdfKey -> [annotation]
    recent: [],       // {key,name,path,pages,openedAt}
    settings: {}
  };
}
function normalize(d) {
  const b = blank();
  if (!d || typeof d !== 'object') return b;
  b.folders = Array.isArray(d.folders) ? d.folders : [];
  b.notes = Array.isArray(d.notes) ? d.notes : [];
  b.annotations = d.annotations && typeof d.annotations === 'object' ? d.annotations : {};
  b.recent = Array.isArray(d.recent) ? d.recent : [];
  b.settings = d.settings && typeof d.settings === 'object' ? d.settings : {};
  return b;
}

/* 复制当前磁盘上的数据文件。tag='bak' 为覆盖式滚动备份，其余 tag 带时间戳不覆盖 */
function backup(tag) {
  if (!FILE || !fs.existsSync(FILE)) return '';
  const t = new Date().toISOString().replace(/[:.]/g, '-');
  const name = FILE + '.' + (tag || 'bak') + (tag === 'bak' ? '' : '-' + t);
  try { fs.copyFileSync(FILE, name); return name; }
  catch (e) { console.warn('备份数据文件失败：' + (e.message || e)); return ''; }
}
function rollingBackup() {
  const now = Date.now();
  if (now - lastBackupAt < BACKUP_INTERVAL) return '';
  // 只有真的产生了备份才计时：首次保存时文件尚不存在，不能白占一个节流周期
  const out = backup('bak');
  if (out) lastBackupAt = now;
  return out;
}

/* 损坏时绝不静默吞掉：先留副本，再通过 warning() 让界面明确告警 */
function load() {
  warning = '';
  if (!FILE) return blank();
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); }
  catch (e) {
    if (e && e.code !== 'ENOENT') warning = '读取数据文件失败：' + (e.message || e);
    return blank();
  }
  try { return normalize(JSON.parse(raw)); }
  catch (e) {
    const saved = backup('broken');
    warning = saved
      ? '数据文件损坏，已保留副本 ' + path.basename(saved) + '。请先从「文件 → 导入备份」恢复，不要直接开始编辑。'
      : '数据文件损坏，且副本保存失败：' + (e.message || e);
    console.error(warning);
    return blank();
  }
}
function save(d) {
  if (!FILE) throw new Error('store 未初始化');
  const data = normalize(d);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  rollingBackup();          // 备份的是磁盘上的旧版本，必须在 rename 之前
  fs.renameSync(tmp, FILE); // 原子替换，避免写一半
  return true;
}
function file() { return FILE; }
function lastWarning() { return warning; }

module.exports = { init, load, save, blank, normalize, file, backup, lastWarning };
