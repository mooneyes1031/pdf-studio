/* 从 EULA.md 生成 NSIS 安装向导用的 license.txt。
 * NSIS Unicode 的 LicenseData 需要 UTF-16LE BOM 才能正确显示中文，
 * 所以不能直接把 .md 交给 electron-builder。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let t = fs.readFileSync(path.join(root, 'EULA.md'), 'utf8');
t = t.replace(/\r\n/g, '\n')
  .replace(/^#{1,6}\s*/gm, '')
  .replace(/\*\*/g, '')
  .replace(/^>\s?/gm, '')
  .replace(/`/g, '')
  .replace(/^---$/gm, '────────────────────────────')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .trim() + '\n';
const bom = Buffer.from([0xFF, 0xFE]);
const out = Buffer.concat([bom, Buffer.from(t, 'utf16le')]);
fs.writeFileSync(path.join(__dirname, 'license.txt'), out);
console.log('已生成 build/license.txt（UTF-16LE BOM，' + out.length + ' 字节）');
