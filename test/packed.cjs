/* 打包产物校验（不需要 GitHub，也不需要额外依赖）
 *   node test/packed.cjs          静态校验：三个产物、asar 内容、图标、许可文本、换行符
 *   node test/packed.cjs --run    额外启动 win-unpacked 里的真实 Electron，用 CDP 读产品信息
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const asar = require('@electron/asar');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const VER = require('../package.json').version;
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' | ' + detail : '')); }
}
function size(p) { try { return fs.statSync(p).size; } catch (_) { return 0; } }

function staticCheck() {
  console.log('--- 打包产物 ---');
  const setup = path.join(DIST, 'PDF-Studio-Setup-' + VER + '.exe');
  const portable = path.join(DIST, 'PDF-Studio-' + VER + '-portable.exe');
  const green = path.join(DIST, 'win-unpacked', 'PDF Studio.exe');
  ok('dist/ 存在', fs.existsSync(DIST));
  ok('NSIS 安装器存在且 > 50MB', size(setup) > 50 * 1024 * 1024, size(setup));
  ok('便携版存在且 > 50MB', size(portable) > 50 * 1024 * 1024, size(portable));
  ok('绿色版主程序存在', size(green) > 50 * 1024 * 1024, size(green));

  console.log('\n--- 分发附件 ---');
  ['associate.cmd', 'unassociate.cmd'].forEach(function (f) {
    const p = path.join(DIST, f);
    const b = fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0);
    const lf = (b.toString('binary').match(/\n/g) || []).length;
    const crlf = (b.toString('binary').match(/\r\n/g) || []).length;
    ok('dist/' + f + ' 存在且为 CRLF', b.length > 0 && lf > 0 && lf === crlf);
  });

  console.log('\n--- app.asar 内容 ---');
  const archive = path.join(DIST, 'win-unpacked', 'resources', 'app.asar');
  ok('app.asar 存在', size(archive) > 0, size(archive));
  ok('app.asar 体积受控（< 8MB）', size(archive) < 8 * 1024 * 1024, size(archive));
  if (!size(archive)) return;
  // asar.listPackage 在 Windows 返回反斜杠路径，统一成正斜杠再比对
  const list = asar.listPackage(archive).map(function (x) { return x.replace(/\\/g, '/'); });
  const has = function (s) { return list.indexOf(s) >= 0; };
  ok('含 product.config.json（product.js 运行时依赖）', has('/product.config.json'));
  ok('含 lib/product.js', has('/lib/product.js'));
  ok('含 lib/backup.js', has('/lib/backup.js'));
  ok('含 renderer/index.html', has('/renderer/index.html'));
  ok('含 pdf.js worker', has('/renderer/vendor/pdf.worker.min.js'));
  ok('source map 已裁剪', !list.some(function (x) { return x.endsWith('.map'); }));
  ok('pdf-lib 冗余发行目录已裁剪', !list.some(function (x) { return /node_modules\/pdf-lib\/(dist|es)\//.test(x); }));
  try {
    const raw = asar.extractFile(archive, 'product.config.json').toString('utf8');
    const cfg = JSON.parse(raw);
    ok('asar 内配置可解析且字段齐全', typeof cfg.repository === 'string' && typeof cfg.contact === 'string');
  } catch (e) { ok('asar 内配置可解析且字段齐全', false, e.message); }

  console.log('\n--- 品牌与许可资源 ---');
  const ico = fs.readFileSync(path.join(ROOT, 'build', 'icon.ico'));
  ok('多尺寸 ICO 已生成', ico.length > 100 * 1024 && ico.readUInt16LE(4) >= 5, 'bytes=' + ico.length + ' frames=' + ico.readUInt16LE(4));
  ok('PNG 图标已生成', size(path.join(ROOT, 'build', 'icon.png')) > 1000);
  const lic = fs.readFileSync(path.join(ROOT, 'build', 'license.txt'));
  ok('安装器许可文本为 UTF-16LE BOM', lic[0] === 0xFF && lic[1] === 0xFE);
  const nsh = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'), 'utf8');
  ok('安装器不抢 .pdf 默认关联', !/WriteRegStr HKCU "Software\\Classes\\\.pdf" ""/.test(nsh));
  ok('安装器不弹 MessageBox', !/MessageBox/.test(nsh));
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function runCheck() {
  console.log('\n--- 真实 Electron 启动 ---');
  const exe = path.join(DIST, 'win-unpacked', 'PDF Studio.exe');
  if (!fs.existsSync(exe)) { ok('绿色版可启动', false, 'exe 不存在'); return; }
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-studio-e2e-'));
  // 宿主 WorkBuddy 会设置 ELECTRON_RUN_AS_NODE=1，让 exe 退化成 Node CLI 并拒绝
  // 所有 Chromium 参数。启动真实窗口必须剥离它，同时去掉注入的 NODE_OPTIONS。
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const child = cp.spawn(exe, ['--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run'],
    { stdio: 'ignore', env: env });
  let ws = null, timer = null;
  const cleanup = function () {
    try { if (ws) ws.close(); } catch (_) {}
    try { cp.execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  };
  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      try {
        const r = await fetch('http://127.0.0.1:' + port + '/json/list');
        targets = await r.json();
        if (targets.some(function (t) { return t.type === 'page' && /index\.html/.test(t.url); })) break;
      } catch (_) { /* not up yet */ }
    }
    const page = (targets || []).find(function (t) { return t.type === 'page' && /index\.html/.test(t.url); });
    ok('Electron 启动并暴露调试页面', !!page, 'targets=' + JSON.stringify((targets || []).map(function (t) { return t.url; })));
    if (!page) return;

    const result = await new Promise(function (resolve, reject) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      timer = setTimeout(function () { reject(new Error('CDP timeout')); }, 12000);
      ws.onopen = function () {
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
          expression: "JSON.stringify({title:document.title, product:window.__studioApp&&window.__studioApp.product(), api:!!(window.studio&&window.studio.product), palette:window.__studioApp&&Object.keys((window.__studioApp.palette()||{}).colors||{}).length, colorNames:window.__studioApp&&Object.keys((window.__studioApp.palette()||{}).names||{}).length})",
          returnByValue: true
        } }));
      };
      ws.onmessage = function (ev) {
        const m = JSON.parse(ev.data);
        if (m.id === 1) { clearTimeout(timer); resolve(m); }
      };
      ws.onerror = function (e) { clearTimeout(timer); reject(new Error('WebSocket error')); };
    });
    const val = result.result && result.result.result && result.result.result.value;
    const data = val ? JSON.parse(val) : {};
    ok('renderer 无致命异常（__studioApp 可用）', !!data.product, JSON.stringify(result).slice(0, 300));
    ok('产品信息来自 asar 内模块', data.product && data.product.name === 'PDF Studio', JSON.stringify(data.product));
    ok('版本号与 package.json 一致', data.product && data.product.version === VER);
    ok('contextBridge API 可用', data.api === true);
    ok('10 色调色板可用', data.palette === 10, 'palette=' + data.palette);
    ok('调色板中文名齐全', data.colorNames === 10, 'colorNames=' + data.colorNames);
    ok('窗口标题正确', /PDF Studio/.test(data.title || ''), data.title);
  } catch (e) {
    ok('Electron 端到端检查', false, e.message);
  } finally { cleanup(); }
}

(async function () {
  staticCheck();
  if (process.argv.indexOf('--run') >= 0) await runCheck();
  console.log('\n结果：' + pass + ' 项通过，' + fail + ' 项失败');
  process.exit(fail ? 1 : 0);
})();
