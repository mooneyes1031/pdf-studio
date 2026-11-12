/* 一键打包的纯文件逻辑：选好目录后，一次写出带注释 PDF + 若干文本成品
 * 抽成独立模块，便于脱离原生对话框做验证。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeAnnotations } = require('./pdf-annotate');

async function writeBundle(dir, payload) {
  const p = payload || {};
  fs.mkdirSync(dir, { recursive: true });
  const written = [];

  if (p.wantPdf && p.srcPath && fs.existsSync(p.srcPath)) {
    const out = await writeAnnotations(
      fs.readFileSync(p.srcPath), p.annotations || [], p.pageSizes || []
    );
    const name = path.basename(p.srcPath, path.extname(p.srcPath)) + '-标注.pdf';
    const f = path.join(dir, name);
    fs.writeFileSync(f, Buffer.from(out.bytes));
    written.push(f);
  }

  (p.files || []).forEach(function (x) {
    const name = String(x && x.name || 'export.txt').replace(/[\\/:*?"<>|]/g, '_');
    const f = path.join(dir, name);
    fs.writeFileSync(f, String(x && x.text != null ? x.text : ''), 'utf8');
    written.push(f);
  });

  return { ok: true, dir: dir, files: written };
}

module.exports = { writeBundle };
