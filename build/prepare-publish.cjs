/* Publish prep: fill placeholders with real values and set git identity.
 *
 *   node build/prepare-publish.cjs --dry      preview only, writes nothing
 *   node build/prepare-publish.cjs --prepare read gh login -> fill config -> commit
 *
 * Only machine-decidable values are touched: GitHub owner, repo, contact email.
 * Copyright holder, pricing and code signing stay a human decision.
 * Console output is ASCII-only so it renders correctly in a GBK cmd console.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const MODE = process.argv[2] || '--dry';
const DRY = MODE !== '--prepare';

const FILES = ['README.md', 'COMMERCIAL.md', 'docs/index.html'];
const TOKENS = [
  'REPLACE_WITH_YOUR_EMAIL',
  'REPLACE_WITH_YOUR_REPO',
  'REPLACE_WITH_YOUR_OWNER'
];

function git(args, opts) {
  return cp.execFileSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8' }, opts || {})).trim();
}
function ghJson(args) {
  return JSON.parse(cp.execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8' }));
}

function whoami() {
  let owner = '';
  try { owner = cp.execFileSync('gh', ['api', 'user', '--jq', '.login'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch (e) { throw new Error('Cannot read GitHub login. Run: gh auth login'); }
  if (!owner) throw new Error('GitHub login is empty. Run: gh auth login');

  let email = '';
  try {
    const list = ghJson(['api', 'user/emails']);
    const arr = Array.isArray(list) ? list : [];
    const hit = arr.find(function (x) { return x.primary && x.verified; })
      || arr.find(function (x) { return x.verified; });
    email = hit ? String(hit.email) : '';
  } catch (_) { /* missing user:email scope -> use noreply address */ }
  if (!email) email = owner + '@users.noreply.github.com';
  return { owner: owner, email: email };
}

function main() {
  const who = DRY ? { owner: 'your-name', email: 'you@example.com' } : whoami();
  const repoName = require('../package.json').name;
  const repo = who.owner + '/' + repoName;
  const values = {
    REPLACE_WITH_YOUR_EMAIL: who.email,
    REPLACE_WITH_YOUR_REPO: repo,
    REPLACE_WITH_YOUR_OWNER: who.owner
  };

  console.log('GitHub user : ' + who.owner);
  console.log('Repository  : ' + repo);
  console.log('Commit email: ' + who.email);
  console.log('Mode        : ' + (DRY ? 'preview (no files written)' : 'write'));
  console.log('');

  // 1) product.config.json
  const cfgPath = path.join(ROOT, 'product.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.repository = repo;
  cfg.contact = who.email;
  console.log('[config] product.config.json -> repository=' + repo + ', contact=' + who.email);
  if (!DRY) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

  // 2) Replace placeholders in docs; check the in-memory result for leftovers.
  let left = 0;
  FILES.forEach(function (rel) {
    const p = path.join(ROOT, rel);
    let text = fs.readFileSync(p, 'utf8');
    let n = 0;
    TOKENS.forEach(function (t) {
      const parts = text.split(t);
      n += parts.length - 1;
      text = parts.join(values[t]);
    });
    TOKENS.forEach(function (t) { if (text.indexOf(t) >= 0) left++; });
    console.log('[docs]   ' + rel + ' -> ' + n + ' replacements');
    if (!DRY && n) fs.writeFileSync(p, text, 'utf8');
  });
  console.log('[check]  placeholder groups left after replacement: ' + left);
  if (left) throw new Error('Unhandled placeholder token remains');

  if (DRY) {
    console.log('');
    console.log('Preview complete. No files written.');
    return;
  }

  // 3) git identity
  git(['config', 'user.name', who.owner]);
  git(['config', 'user.email', who.email]);
  console.log('[git]    user.name / user.email configured');

  // 4) Fix the author of the unpushed initial commit (local history only).
  let hasHead = true;
  try { git(['rev-parse', 'HEAD']); } catch (_) { hasHead = false; }
  let pushed = false;
  try { git(['rev-parse', '@{u}']); pushed = true; } catch (_) { pushed = false; }
  if (hasHead && !pushed) {
    const author = git(['log', '-1', '--format=%ae']);
    if (/REPLACE|pdf-studio\.local/i.test(author)) {
      git(['commit', '--amend', '--reset-author', '--no-edit']);
      console.log('[git]    fixed author of the unpushed initial commit');
    }
  }

  // 5) Stage and commit if anything actually changed.
  git(['add', '-A']);
  let changed = false;
  try { git(['diff', '--cached', '--quiet']); } catch (_) { changed = true; }
  if (changed) {
    git(['commit', '-m', 'chore: fill publish info (repo, contact, landing page links)']);
    console.log('[git]    created publish-prep commit');
  } else {
    console.log('[git]    no changes, commit skipped');
  }
  console.log('');
  console.log('Ready.');
}

try { main(); }
catch (e) {
  console.error('Prepare failed: ' + (e && e.message || e));
  process.exit(1);
}
