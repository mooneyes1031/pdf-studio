/* 产品信息单一数据源：菜单、关于框、检查更新、文档、安装包都从这里读。
 *
 * 优先级：环境变量 > product.config.json > 内置默认值。
 *   - 本地开发：什么都不配也能跑，「检查更新」会给出友好提示而不是报错。
 *   - 一键发布：publish.cmd 会自动写好 product.config.json。
 *   - GitHub Actions：构建时用 PDF_STUDIO_REPO 注入 github.repository，
 *     所以正式 Release 里的 exe 自带正确的更新地址与仓库链接。
 */
'use strict';
const pkg = require('../package.json');
const env = process.env || {};

let cfg = {};
try { cfg = require('../product.config.json'); } catch (_) { /* 源码版允许缺省 */ }
if (!cfg || typeof cfg !== 'object') cfg = {};

// 形如 "your-name/pdf-studio"；留空时「检查更新」返回 unconfigured
const REPO = String(env.PDF_STUDIO_REPO || cfg.repository || '').trim();
const owner = REPO ? REPO.split('/')[0] : '';
const repo = REPO ? REPO.split('/')[1] || 'pdf-studio' : 'pdf-studio';
const CONTACT = String(env.PDF_STUDIO_CONTACT || cfg.contact || '').trim();

module.exports = Object.freeze({
  name: 'PDF Studio',
  tagline: '把阅读、标注与笔记留在本机',
  version: pkg.version,
  copyright: 'Copyright (c) 2026 PDF Studio Authors',
  author: 'PDF Studio Authors',
  // 未配置时给一个诚实的值，避免界面上出现假邮箱或空白
  contact: CONTACT || '见仓库 COMMERCIAL.md',
  license: 'PolyForm Noncommercial 1.0.0',
  licenseUrl: 'https://polyformproject.org/licenses/noncommercial/1.0.0/',
  repository: REPO,
  homepage: REPO ? 'https://github.com/' + REPO : '',
  releases: REPO ? 'https://github.com/' + REPO + '/releases' : '',
  pages: owner ? 'https://' + owner + '.github.io/' + repo : '',
  brand: Object.freeze({
    ink: '#0F172A', amber: '#FBBF24', paper: '#FFFFFF', slate: '#475569'
  }),
  buildYear: '2026'
});
