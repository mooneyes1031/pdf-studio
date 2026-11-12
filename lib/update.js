/* 版本更新检查：只发一个不带任何标识的 GET，不上传文档、机器码或用户信息。
 * 未配置仓库时直接返回 unconfigured，不联网、不报错。
 */
'use strict';
const https = require('https');
const product = require('./product');

function compare(a, b) {
  const pa = String(a || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function check() {
  return new Promise(function (resolve) {
    const repo = product.repository;
    if (!repo || repo.indexOf('/') < 0) return resolve({ ok: false, reason: 'unconfigured' });
    let done = false;
    function finish(v) { if (!done) { done = true; resolve(v); } }
    const req = https.get({
      host: 'api.github.com',
      path: '/repos/' + repo + '/releases/latest',
      headers: { 'User-Agent': 'PDF-Studio/' + product.version, 'Accept': 'application/vnd.github+json' },
      timeout: 4000
    }, function (res) {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { s += d; if (s.length > 200000) req.destroy(); });
      res.on('end', function () {
        if (res.statusCode !== 200) return finish({ ok: false, reason: 'http-' + res.statusCode });
        try {
          const j = JSON.parse(s);
          const latest = String(j.tag_name || '').replace(/^v/, '');
          finish({
            ok: true, current: product.version, latest: latest,
            newer: compare(latest, product.version) > 0,
            url: String(j.html_url || ''), notes: String(j.body || '').slice(0, 400)
          });
        } catch (e) { finish({ ok: false, reason: 'parse' }); }
      });
    });
    req.on('timeout', function () { req.destroy(); finish({ ok: false, reason: 'timeout' }); });
    req.on('error', function () { finish({ ok: false, reason: 'network' }); });
  });
}
module.exports = { check: check, compare: compare };
