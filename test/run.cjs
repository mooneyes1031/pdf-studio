/* PDF Studio 回归测试（纯 Node，不需要 Electron / 显示器）
 * 运行：npm test
 * 覆盖：关窗 flush 契约、备份组装与导入、store 损坏保护、PDF 注释对象、导出打包
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-studio-test-'));
const store = require(path.join(ROOT, 'lib', 'store'));
const backups = require(path.join(ROOT, 'lib', 'backup'));
const { writeAnnotations } = require(path.join(ROOT, 'lib', 'pdf-annotate'));
const { writeBundle } = require(path.join(ROOT, 'lib', 'export-bundle'));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' | ' + detail : '')); }
}
function eq(name, got, want) {
  ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

async function makePdf() {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  d.addPage([595, 842]);
  return await d.save();
}
const SIZES = [{ width: 595, height: 842 }, { width: 595, height: 842 }];
const RECT = [{ x: 0.1, y: 0.1, w: 0.3, h: 0.02 }];
const ANNOS = [
  { id: 'a1', type: 'highlight', page: 1, color: 'yellow', rects: RECT, text: '高亮' },
  { id: 'a2', type: 'underline', page: 1, color: 'red', rects: RECT, text: '下划线' },
  { id: 'a3', type: 'strike', page: 1, color: 'blue', rects: RECT, text: '删除线' },
  { id: 'a4', type: 'area', page: 1, color: 'green', rects: RECT, text: '区域' },
  { id: 'a5', type: 'pin', page: 2, color: 'orange', x: 0.5, y: 0.5, comment: '便签' },
  { id: 'a6', type: 'arrow', page: 2, color: 'purple', width: 3, x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.4, text: '箭头' },
  { id: 'a7', type: 'ink', page: 2, color: 'cyan', width: 4,
    points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.15 }, { x: 0.3, y: 0.12 }], text: '笔刷' }
];

async function main() {
  console.log('--- A. 关窗 flush / 全量备份 契约 ---');
  const mainSrc = read('main.js'), preSrc = read('preload.js');
  const appSrc = read('renderer/app.js'), htmlSrc = read('renderer/index.html');
  const pkg = JSON.parse(read('package.json'));
  ok('main.js 拦截 close 并等待 flush', /on\('close', onWindowClose\)/.test(mainSrc) && /app:flush/.test(mainSrc) && /app:flushDone/.test(mainSrc));
  ok('main.js 提供同步保存 IPC', /store:saveSync/.test(mainSrc));
  ok('main.js 提供导入 IPC', /store:import/.test(mainSrc) && /backups\.parse/.test(mainSrc));
  ok('preload 暴露 flush / 同步保存 / 导入', /saveDataSync/.test(preSrc) && /onFlush/.test(preSrc) && /flushDone/.test(preSrc) && /applyBackup/.test(preSrc));
  ok('app.js beforeunload 走同步 IPC', /saveDataSync\(snapshot\(\)\)/.test(appSrc));
  ok('app.js 监听 app:flush 并回复', /onFlush\(async/.test(appSrc) && /flushDone\(\)/.test(appSrc));
  ok('app.js 备份使用全量 snapshot', /PSBackup\.build\(snapshot\(\)/.test(appSrc));
  ok('index.html 加载备份模块', /\.\.\/lib\/backup\.js/.test(htmlSrc));
  ok('package.json 有 test 脚本', typeof pkg.scripts.test === 'string' && /test\/run\.cjs/.test(pkg.scripts.test));

  console.log('--- B. 备份组装 / 解析 / 合并 ---');
  const full = {
    folders: [{ id: 'f1', name: '读书笔记' }],
    notes: [
      { id: 'n1', title: '第一篇', body: '内容', updatedAt: '2026-01-01' },
      { id: 'n3', title: '备份独有', updatedAt: '2026-02-01' }
    ],
    annotations: { pA: [{ id: 'x1', type: 'highlight' }], pB: [{ id: 'x2' }, { id: 'x3' }] },
    recent: [{ path: 'C:/a.pdf', name: 'a.pdf' }],
    settings: { tool: 'ink', zoom: '1.25' }
  };
  const text = backups.build(full, { name: 'a.pdf', key: 'pA' });
  const parsed = backups.parse(text);
  ok('v3 备份解析成功', parsed.ok === true);
  eq('备份版本', parsed.version, 3);
  eq('文档数（全量，不是当前一个）', parsed.stats.documents, 2);
  eq('标注数（全量）', parsed.stats.annotations, 3);
  eq('备份保留两个文档的标注键', Object.keys(parsed.data.annotations).sort().join(','), 'pA,pB');
  ok('备份 JSON 含 data 全量字段', /"data"/.test(text) && !/"annotations":\s*\[/.test(text.slice(0, 400)));

  const v2 = JSON.stringify({ kind: 'pdf-studio-backup', version: 2,
    document: { name: 'a.pdf', key: 'pA' }, annotations: [{ id: 'old1' }],
    notes: [{ id: 'n0', title: '旧笔记' }], folders: [], recent: [], settings: {} });
  const p2 = backups.parse(v2);
  ok('兼容 v2 老格式', p2.ok === true && p2.stats.notes === 1 && p2.data.annotations.pA.length === 1);
  const noteOnly = backups.parse(JSON.stringify({ kind: 'pdf-studio-notes', notes: [{ id: 'n9', title: '笔记' }], folders: [] }));
  ok('兼容笔记单独导出格式', noteOnly.ok === true && noteOnly.stats.notes === 1);
  ok('拒绝损坏 JSON', backups.parse('{oops').ok === false);
  ok('拒绝非 PDF Studio 文件', backups.parse('{"kind":"something-else"}').ok === false);

  const cur = {
    notes: [{ id: 'n1', title: '本地较新', updatedAt: '2026-06-01' }, { id: 'n2', title: '本地独有' }],
    folders: [{ id: 'f1', name: '本地文件夹' }],
    annotations: { pA: [{ id: 'x1', type: 'underline' }], pC: [{ id: 'x9' }] },
    recent: [{ path: 'C:/local.pdf' }], settings: { tool: 'highlight' }
  };
  const merged = backups.mergeData(cur, parsed.data);
  eq('合并后笔记数（去重 + 补齐）', merged.notes.length, 3);
  ok('备份独有笔记被补齐', merged.notes.some(n => n.id === 'n3' && n.title === '备份独有'));
  eq('同 id 取较新版本', merged.notes.filter(n => n.id === 'n1')[0].title, '本地较新');
  eq('同 id 文件夹保留当前', merged.folders[0].name, '本地文件夹');
  eq('合并后文档数', Object.keys(merged.annotations).length, 3);
  eq('标注按 id 去重', merged.annotations.pA.length, 1);
  eq('设置以当前偏好优先', merged.settings.tool, 'highlight');
  eq('最近打开去重', merged.recent.length, 2);
  const replaced = backups.replaceData(parsed.data);
  eq('覆盖模式完全替换', replaced.notes.length, 2);
  eq('覆盖模式丢弃本地独有文档', Object.keys(replaced.annotations).indexOf('pC'), -1);
  eq('无 id 项不会被丢弃', backups.mergeById([{ title: 'a' }], [{ title: 'b' }], 'updatedAt').length, 2);

  console.log('--- C. store 损坏保护 / 滚动备份 ---');
  const sdir = path.join(TMP, 'store');
  const dataFile = store.init(sdir);
  eq('store 文件路径', dataFile, path.join(sdir, 'studio-data.json'));
  const d1 = Object.assign(store.blank(), { notes: [{ id: 'n1', title: '第一版' }] });
  const d2 = Object.assign(store.blank(), { notes: [{ id: 'n1', title: '第二版' }] });
  store.save(d1);
  eq('save/load 往返', store.load().notes[0].title, '第一版');
  store.init(sdir);                 // 重置备份节流，模拟新会话
  store.save(d2);
  eq('再次 save 后数据更新', store.load().notes[0].title, '第二版');
  ok('.bak 滚动备份存在', fs.existsSync(dataFile + '.bak'));
  eq('.bak 保存的是上一版', JSON.parse(fs.readFileSync(dataFile + '.bak', 'utf8')).notes[0].title, '第一版');
  ok('before-import 副本存在', !!store.backup('before-import') &&
    fs.readdirSync(sdir).some(f => f.indexOf('.before-import-') >= 0));

  const broken = '{ this is not json';
  fs.writeFileSync(dataFile, broken, 'utf8');
  store.init(sdir);
  const recovered = store.load();
  eq('损坏时返回空库而不是崩溃', recovered.notes.length, 0);
  ok('损坏时有明确警告', /损坏/.test(store.lastWarning()));
  const brokenCopies = fs.readdirSync(sdir).filter(f => f.indexOf('.broken-') >= 0);
  eq('损坏文件保留副本数', brokenCopies.length, 1);
  eq('副本内容与原损坏文件一致', fs.readFileSync(path.join(sdir, brokenCopies[0]), 'utf8'), broken);
  eq('normalize 容忍 null', store.normalize(null).notes.length, 0);
  eq('normalize 容忍错类型', store.normalize({ notes: 'oops', folders: 3 }).folders.length, 0);

  console.log('--- D. 真实 PDF 注释对象 ---');
  const raw = await makePdf();
  const out = await writeAnnotations(raw, ANNOS, SIZES);
  eq('写出 7 条注释', out.count, 7);
  ok('输出字节有效且变长', out.bytes.length > raw.length);
  const s = Buffer.from(out.bytes).toString('latin1');
  ok('含 /Annots', /\/Annots/.test(s));
  ['Highlight', 'Underline', 'StrikeOut', 'Square', 'Text', 'Line', 'Ink'].forEach(function (t) {
    ok('含 /Subtype /' + t, new RegExp('/Subtype\\s*/' + t + '(?![A-Za-z])').test(s));
  });
  ok('含 QuadPoints', /\/QuadPoints/.test(s));
  ok('含 InkList', /\/InkList/.test(s));
  ok('箭头含 ClosedArrow', /ClosedArrow/.test(s));
  const reloaded = await PDFDocument.load(out.bytes);
  eq('第 1 页注释数', reloaded.getPage(0).node.Annots().size(), 4);
  eq('第 2 页注释数', reloaded.getPage(1).node.Annots().size(), 3);
  const empty = await writeAnnotations(raw, [], SIZES);
  eq('无标注时不写注释', empty.count, 0);
  ok('无标注输出仍是合法 PDF', (await PDFDocument.load(empty.bytes)).getPageCount() === 2);

  console.log('--- E. 一键打包 ---');
  const srcPath = path.join(TMP, 'source.pdf');
  fs.writeFileSync(srcPath, Buffer.from(raw));
  const outdir = path.join(TMP, 'bundle', 'nested');
  const br = await writeBundle(outdir, {
    srcPath: srcPath, annotations: ANNOS, pageSizes: SIZES, wantPdf: true,
    files: [
      { name: '标注汇总.md', text: '# 汇总' },
      { name: '笔记与标注合订.md', text: '# 合订' },
      { name: '完整备份.json', text: text }
    ]
  });
  eq('打包写出 4 个文件', br.files.length, 4);
  ok('自动创建目标目录', fs.existsSync(outdir));
  ok('带注释 PDF 可重新打开', (await PDFDocument.load(fs.readFileSync(path.join(outdir, 'source-标注.pdf')))).getPageCount() === 2);
  eq('Markdown 内容正确', fs.readFileSync(path.join(outdir, '标注汇总.md'), 'utf8'), '# 汇总');
  ok('完整备份可解析', JSON.parse(fs.readFileSync(path.join(outdir, '完整备份.json'), 'utf8')).version === 3);
  const br2 = await writeBundle(path.join(TMP, 'bundle2'), {
    srcPath: srcPath, wantPdf: false,
    files: [{ name: 'a/b:c.md', text: 'x' }, { name: 'n.txt', text: 'y' }]
  });
  eq('wantPdf=false 时只写文本', br2.files.length, 2);
  ok('文件名净化非法字符', fs.existsSync(path.join(TMP, 'bundle2', 'a_b_c.md')));

  console.log('\n--- F. 发布链路契约 ---');
  const crypto = require('crypto');
  const cp = require('child_process');
  function hash(rel) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex'); }

  const cfgPath = path.join(ROOT, 'product.config.json');
  ok('product.config.json 存在且可解析', fs.existsSync(cfgPath) && typeof JSON.parse(read('product.config.json')) === 'object');
  const cfgKeys = Object.keys(JSON.parse(read('product.config.json')));
  ok('配置文件含 repository / contact', cfgKeys.indexOf('repository') >= 0 && cfgKeys.indexOf('contact') >= 0);

  const prodSrc = read('lib/product.js');
  ok('product.js 读取 product.config.json', /require\('\.\.\/product\.config\.json'\)/.test(prodSrc));
  ok('环境变量优先级高于配置文件', /env\.PDF_STUDIO_REPO \|\| cfg\.repository/.test(prodSrc));
  const probe = cp.execFileSync(process.execPath, ['-e',
    "const p=require('./lib/product');console.log(JSON.stringify({r:p.repository,h:p.homepage,rel:p.releases,pg:p.pages,c:p.contact}))"],
    { cwd: ROOT, env: Object.assign({}, process.env, { PDF_STUDIO_REPO: 'acme/pdf-studio', PDF_STUDIO_CONTACT: 'sales@acme.test' }), encoding: 'utf8' });
  const probed = JSON.parse(probe.trim());
  eq('注入仓库后 repository 正确', probed.r, 'acme/pdf-studio');
  eq('注入仓库后 homepage 正确', probed.h, 'https://github.com/acme/pdf-studio');
  eq('注入仓库后 releases 正确', probed.rel, 'https://github.com/acme/pdf-studio/releases');
  eq('注入仓库后 Pages 地址正确', probed.pg, 'https://acme.github.io/pdf-studio');
  eq('注入联系邮箱后 contact 正确', probed.c, 'sales@acme.test');
  // 未配置与已发布两种状态都要能过：发布后 product.config.json 会写入真实仓库地址
  ok('product.js 不硬编码假邮箱 / 假链接', !/REPLACE_WITH_YOUR_/.test(prodSrc) && /见仓库 COMMERCIAL\.md/.test(prodSrc));
  const cfgNow = JSON.parse(read('product.config.json'));
  if (cfgNow.repository) {
    ok('已发布配置中仓库地址格式正确', /^[^/\s]+\/[^/\s]+$/.test(cfgNow.repository), cfgNow.repository);
  } else {
    ok('未发布时仓库地址留空', cfgNow.contact === '');
  }

  const relYml = read('.github/workflows/release.yml');
  const ciYml = read('.github/workflows/ci.yml');
  ok('Release 构建注入 github.repository', /PDF_STUDIO_REPO: \$\{\{ github\.repository \}\}/.test(relYml));
  ok('Release 不再强制国内镜像', relYml.indexOf('ELECTRON_MIRROR:') < 0);
  ok('Release 附带关联脚本', /dist\/associate\.cmd/.test(relYml) && /dist\/unassociate\.cmd/.test(relYml));
  ok('Release 使用 RELEASE_NOTES.md', /body_path: RELEASE_NOTES\.md/.test(relYml));
  ok('CI 校验图标可复现', /git diff --exit-code -- build\/icon\.ico/.test(ciYml));
  ok('打包文件清单含 product.config.json', (pkg.build.files || []).indexOf('product.config.json') >= 0);

  const docsSrc = read('docs/index.html');
  // 发布前是占位域名，发布后是真实 owner/repo，两种状态都必须通过
  eq('落地页三个下载按钮指向 Releases', (docsSrc.match(/href="https:\/\/github\.com\/[^"]+\/releases\/latest"/g) || []).length, 3);
  ok('落地页不存在下载按钮自引用死链', !/href="#download">从 Releases 下载/.test(docsSrc));
  ok('README 给出一键发布命令', /publish\.cmd/.test(read('README.md')));
  ok('RELEASE_NOTES.md 存在且非空', read('RELEASE_NOTES.md').length > 400);
  const pubCmd = read('publish.cmd');
  ok('publish.cmd 检查登录并推 tag', /gh auth status/.test(pubCmd) && /v1\.0\.0/.test(pubCmd));

  const before = ['README.md', 'COMMERCIAL.md', 'docs/index.html', 'product.config.json'].map(hash);
  const dryOut = cp.execFileSync(process.execPath, ['build/prepare-publish.cjs', '--dry'], { cwd: ROOT, encoding: 'utf8' });
  const after = ['README.md', 'COMMERCIAL.md', 'docs/index.html', 'product.config.json'].map(hash);
  eq('prepare-publish --dry 不写任何文件', JSON.stringify(before), JSON.stringify(after));
  ok('dry-run 输出预览报告且不写文件', /preview \(no files written\)/.test(dryOut) && /Preview complete\. No files written\./.test(dryOut));
  ok('dry-run 报告占位符已全部覆盖', /placeholder groups left after replacement: 0/.test(dryOut));
  ok('prepare-publish 控制台输出为纯 ASCII（GBK cmd 不乱码）', !/[^\x00-\x7F]/.test(dryOut));

  // cmd.exe 对 LF-only 批处理会错位解析，必须保持 CRLF
  ['publish.cmd', 'run.cmd', 'associate.cmd', 'unassociate.cmd', 'build/associate.cmd', 'build/unassociate.cmd'].forEach(function (f) {
    const buf = fs.readFileSync(path.join(ROOT, f));
    const lf = (buf.toString('binary').match(/\n/g) || []).length;
    const crlf = (buf.toString('binary').match(/\r\n/g) || []).length;
    ok(f + ' 使用 CRLF 换行', lf > 0 && lf === crlf, 'lf=' + lf + ' crlf=' + crlf);
  });

  console.log('\n结果：' + pass + ' 项通过，' + fail + ' 项失败');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) {
  console.error('测试异常：' + (e && e.stack || e));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (x) {}
  process.exit(1);
});
