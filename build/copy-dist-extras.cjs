/* 打包完成后把分发用的文件关联脚本复制到 dist/ */
'use strict';
const fs = require('fs');
const path = require('path');
const src = __dirname;
const dst = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(dst)) { console.error('dist 不存在，先执行 npm run pack'); process.exit(1); }
['associate.cmd', 'unassociate.cmd'].forEach(function (f) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
  console.log('已复制 dist/' + f);
});
