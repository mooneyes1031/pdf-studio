/* 备用发布通道：只走 api.github.com 的 Git Data API，完全不碰 github.com。
 *
 * 适用：本机 github.com 的 GET 可用但 POST 被拦，导致 gh auth login / git push 都失败。
 *
 *   GH_TOKEN=xxx node build/publish-via-api.cjs --dry      预览，不联网、不写文件
 *   GH_TOKEN=xxx node build/publish-via-api.cjs             发布
 *
 * token 也可放在仓库根目录的 .github-token 文件里（已 gitignore，别提交）。
 * 需要 classic PAT，权限：repo + workflow（用于创建 tag 触发 Actions）。
 *
 * 做三件事：
 *   1. 把占位信息填成真实值并在本地提交（与 publish.cmd 的 prepare 等价）
 *   2. 建公开仓库 + 用 blob/tree/commit/refs 上传全部已跟踪文件与完整提交
 *   3. 建 v1.0.0 tag 触发 Release、开启 Pages(main/docs)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const DRY = process.argv.indexOf('--dry') >= 0;
const API = 'https://api.github.com';
const PKG = require('../package.json');
const REPO_NAME = PKG.name;
const TAG = 'v' + PKG.version;
const DOCS = ['README.md', 'COMMERCIAL.md', 'docs/index.html'];
const TOKENS = ['REPLACE_WITH_YOUR_EMAIL', 'REPLACE_WITH_YOUR_REPO', 'REPLACE_WITH_YOUR_OWNER'];

let TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
if (!TOKEN) {
  const f = path.join(ROOT, '.github-token');
  if (fs.existsSync(f)) TOKEN = fs.readFileSync(f, 'utf8').trim();
}
if (!TOKEN && !DRY) {
  console.error('缺少 GitHub token。设置 GH_TOKEN 环境变量，或写入 .github-token 文件。');
  process.exit(1);
}

function git(args) {
  return cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, url, body, expect) {
  const res = await fetch(API + url, {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pdf-studio-publisher/1.0',
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  const want = expect || [200, 201, 202, 204];
  if (!want.includes(res.status)) {
    const msg = data && data.message ? data.message : String(text).slice(0, 300);
    throw new Error(method + ' ' + url + ' -> HTTP ' + res.status + ': ' + msg);
  }
  return { status: res.status, data: data };
}

function isBinary(buf) {
  if (buf.includes(0)) return true;
  const s = buf.toString('utf8');
  return Buffer.compare(Buffer.from(s, 'utf8'), buf) !== 0;
}

function localFiles() {
  return git(['ls-files', '-z']).split('\0').filter(Boolean);
}

/* 新建的空仓库无法使用 Git Data API（POST /git/blobs 会 409 Git Repository is empty）。
 * 先用 Contents API 写一个引导文件生成初始 commit，之后再用 force update 覆盖 ref，
 * 引导 commit 会变成孤儿，不出现在最终历史里。 */
async function ensureInitialized(repoPath) {
  let ref = null;
  try { ref = (await api('GET', repoPath + '/git/ref/heads/main', undefined, [200])).data; } catch (_) { /* 空仓库 */ }
  if (ref) return { branch: 'main', refSha: ref.object.sha };
  try {
    await api('PUT', repoPath + '/contents/.pdf-studio-init', {
      message: 'Initialize repository',
      content: Buffer.from('PDF Studio bootstrap\n').toString('base64')
    }, [200, 201]);
  } catch (e) {
    console.log('[WARN] 引导文件写入：' + e.message);
  }
  const meta = (await api('GET', repoPath, undefined, [200])).data;
  const branch = meta.default_branch || 'main';
  ref = (await api('GET', repoPath + '/git/ref/heads/' + branch, undefined, [200])).data;
  return { branch: branch, refSha: ref.object.sha };
}

function prepareLocal(who) {
  const repo = who.login + '/' + REPO_NAME;
  const values = {
    REPLACE_WITH_YOUR_EMAIL: who.email,
    REPLACE_WITH_YOUR_REPO: repo,
    REPLACE_WITH_YOUR_OWNER: who.login
  };
  const cfgPath = path.join(ROOT, 'product.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.repository = repo;
  cfg.contact = who.email;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

  let n = 0;
  DOCS.forEach(function (rel) {
    const p = path.join(ROOT, rel);
    let s = fs.readFileSync(p, 'utf8');
    TOKENS.forEach(function (t) {
      const parts = s.split(t);
      n += parts.length - 1;
      s = parts.join(values[t]);
    });
    fs.writeFileSync(p, s, 'utf8');
  });

  git(['config', 'user.name', who.login]);
  git(['config', 'user.email', who.email]);
  // 修正未推送的初始提交作者（本地历史，无远端）
  let pushed = false;
  try { git(['rev-parse', '@{u}']); pushed = true; } catch (_) { pushed = false; }
  if (!pushed) {
    if (/REPLACE|pdf-studio\.local/i.test(git(['log', '-1', '--format=%ae']))) {
      git(['commit', '--amend', '--reset-author', '--no-edit']);
    }
  }
  git(['add', '-A']);
  let changed = false;
  try { git(['diff', '--cached', '--quiet']); } catch (_) { changed = true; }
  if (changed) git(['commit', '-m', 'chore: fill publish info (repo, contact, landing page links)']);
  return { repo: repo, replacements: n };
}

async function main() {
  const files = localFiles();
  let total = 0, bins = 0;
  files.forEach(function (f) {
    const b = fs.readFileSync(path.join(ROOT, f));
    total += b.length;
    if (isBinary(b)) bins++;
  });
  console.log('本地已跟踪文件：' + files.length + ' 个，' + (total / 1024).toFixed(1) + ' KB（二进制 ' + bins + ' 个）');
  console.log('目标标签：' + TAG + '  分支：main  落地页：/docs');
  if (DRY) {
    console.log('\n[DRY] 预览完成，未联网、未写文件。');
    console.log('[DRY] 实际发布时会：建公开仓库 -> 上传 ' + files.length + ' 个 blob -> 建 tree/commit -> 建 refs/heads/main 与 refs/tags/' + TAG + ' -> 开启 Pages');
    return;
  }

  const me = (await api('GET', '/user')).data;
  let email = me.email || '';
  try {
    const list = (await api('GET', '/user/emails')).data || [];
    const hit = list.find(x => x.primary && x.verified) || list.find(x => x.verified);
    if (hit) email = hit.email;
  } catch (_) { /* fine-grained token 可能没有 user:email */ }
  if (!email) email = me.login + '@users.noreply.github.com';
  console.log('GitHub 账号：' + me.login + ' <' + email + '>');

  const prep = prepareLocal({ login: me.login, email: email });
  console.log('本地配置已填写：' + prep.repo + '（替换 ' + prep.replacements + ' 处）');

  // 重新枚举（prepareLocal 可能改变文件内容，但不改变文件清单）
  const uploadFiles = localFiles();
  const repoPath = '/repos/' + prep.repo;
  let exists = false;
  try { await api('GET', repoPath, undefined, [200]); exists = true; } catch (_) { exists = false; }
  if (!exists) {
    await api('POST', '/user/repos', {
      name: REPO_NAME,
      description: PKG.description,
      private: false,
      auto_init: false,
      has_wiki: false,
      has_projects: false
    });
    console.log('已创建公开仓库 ' + prep.repo);
  } else {
    console.log('仓库 ' + prep.repo + ' 已存在（上次运行创建），继续复用');
  }

  const init = await ensureInitialized(repoPath);
  console.log('仓库已初始化，分支 ' + init.branch);

  // 逐文件上传 blob（串行 + 小间隔，避免 secondary rate limit）
  const tree = [];
  for (let i = 0; i < uploadFiles.length; i++) {
    const f = uploadFiles[i];
    const buf = fs.readFileSync(path.join(ROOT, f));
    const bin = isBinary(buf);
    const r = await api('POST', repoPath + '/git/blobs', {
      content: bin ? buf.toString('base64') : buf.toString('utf8'),
      encoding: bin ? 'base64' : 'utf-8'
    });
    tree.push({ path: f.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: r.data.sha });
    if ((i + 1) % 10 === 0 || i + 1 === uploadFiles.length) {
      console.log('  已上传 blob ' + (i + 1) + '/' + uploadFiles.length);
    }
    await sleep(80);
  }

  const t = await api('POST', repoPath + '/git/trees', { tree: tree });
  console.log('已创建 tree ' + t.data.sha.slice(0, 8));

  const message = git(['log', '--reverse', '--format=%s', '--max-count=1']).trim() || 'Initial commit';
  const stamp = new Date().toISOString();
  const who = { name: me.login, email: email, date: stamp };
  let c;
  try {
    // 单一 root commit：引导 commit 被 force update 后成为孤儿，历史保持干净
    c = await api('POST', repoPath + '/git/commits', {
      message: message, tree: t.data.sha, parents: [], author: who, committer: who
    });
  } catch (e) {
    c = await api('POST', repoPath + '/git/commits', {
      message: message, tree: t.data.sha, parents: [init.refSha], author: who, committer: who
    });
    console.log('[INFO] 使用引导 commit 作为父提交');
  }
  console.log('已创建 commit ' + c.data.sha.slice(0, 8));

  await api('PATCH', repoPath + '/git/refs/heads/' + init.branch, { sha: c.data.sha, force: true });
  await api('PATCH', repoPath, { default_branch: init.branch });
  console.log('已更新 ' + init.branch + ' 分支并设为默认');

  const tg = await api('POST', repoPath + '/git/tags', {
    tag: TAG, message: 'PDF Studio ' + PKG.version, object: c.data.sha, type: 'commit', tagger: who
  });
  await api('POST', repoPath + '/git/refs', { ref: 'refs/tags/' + TAG, sha: tg.data.sha });
  console.log('已创建 tag ' + TAG + '（触发 Release 构建）');

  try {
    await api('POST', repoPath + '/pages', { source: { branch: 'main', path: '/docs' } });
    console.log('已开启 GitHub Pages（main / docs）');
  } catch (e) {
    console.log('[WARN] Pages 未能自动开启，请在仓库 Settings -> Pages 手动选 main / docs：' + e.message);
  }

  console.log('\n============================================================');
  console.log(' 仓库    : https://github.com/' + prep.repo);
  console.log(' Release : https://github.com/' + prep.repo + '/releases/tag/' + TAG);
  console.log(' Actions : https://github.com/' + prep.repo + '/actions');
  console.log(' Pages   : https://' + me.login + '.github.io/' + REPO_NAME + '/');
  console.log('============================================================');
  console.log('\n注意：Release 的 exe 由 GitHub Actions 在云端构建，本机不需要访问 github.com。');
  console.log('若 Actions 未自动触发，可在 Actions 页面手动运行 "Build and Release"。');
}

main().catch(function (e) {
  console.error('\n发布失败：' + (e && e.message || e));
  process.exit(1);
});
