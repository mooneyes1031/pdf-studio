/* PDF Studio —— 备份组装 / 解析 / 合并
 * UMD：主进程用 require()，renderer 用 <script> 得到 window.PSBackup。
 * 单一数据源，避免「导出的格式」和「导入能认的格式」各写一套。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.PSBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var KIND = 'pdf-studio-backup';

  function shape(d) {
    var o = (d && typeof d === 'object') ? d : {};
    var ann = (o.annotations && typeof o.annotations === 'object' && !Array.isArray(o.annotations))
      ? o.annotations : {};
    var clean = {};
    Object.keys(ann).forEach(function (k) {
      clean[k] = Array.isArray(ann[k]) ? ann[k].filter(function (x) { return x && typeof x === 'object'; }) : [];
    });
    return {
      version: 1,
      folders: Array.isArray(o.folders) ? o.folders : [],
      notes: Array.isArray(o.notes) ? o.notes : [],
      annotations: clean,
      recent: Array.isArray(o.recent) ? o.recent : [],
      settings: (o.settings && typeof o.settings === 'object') ? o.settings : {}
    };
  }

  function statsOf(s) {
    var n = 0;
    Object.keys(s.annotations).forEach(function (k) { n += s.annotations[k].length; });
    return {
      folders: s.folders.length, notes: s.notes.length,
      documents: Object.keys(s.annotations).length,
      annotations: n, recent: s.recent.length
    };
  }

  /* 组装全量备份：data 必须是 S.data 的完整快照，不能只传当前文档标注 */
  function build(data, document) {
    return JSON.stringify({
      kind: KIND,
      version: 3,
      exportedAt: new Date().toISOString(),
      document: document || {},
      data: shape(data)
    }, null, 2);
  }

  /* 解析并兼容历史格式：v3 全量 / v2 单文档 / 笔记单独导出 */
  function parse(text) {
    var b;
    try { b = JSON.parse(String(text == null ? '' : text)); }
    catch (e) { return { ok: false, error: 'JSON 解析失败：' + (e && e.message || e) }; }
    if (!b || typeof b !== 'object') return { ok: false, error: '备份内容不是对象' };

    var raw;
    if (b.kind === KIND && b.data) {
      raw = b.data;                                  // v3 全量
    } else if (b.kind === KIND) {
      var one = {};
      if (b.document && b.document.key) one[b.document.key] = Array.isArray(b.annotations) ? b.annotations : [];
      raw = { folders: b.folders, notes: b.notes, annotations: one, recent: b.recent, settings: b.settings };
    } else if (b.kind === 'pdf-studio-notes') {
      raw = { folders: b.folders, notes: b.notes };
    } else {
      return { ok: false, error: '不是 PDF Studio 备份文件（kind 不匹配）' };
    }
    var s = shape(raw);
    return { ok: true, version: Number(b.version) || 1, data: s, stats: statsOf(s) };
  }

  /* 按 id 合并，同 id 取时间较新的一条；无 id 的项直接保留，不丢数据 */
  function mergeById(a, b, timeKey) {
    var out = [], seen = {};
    function key(x) { return String((x && (x[timeKey] || x.updatedAt || x.createdAt)) || ''); }
    function push(list) {
      (list || []).forEach(function (x) {
        if (x == null) return;
        if (x.id == null) { out.push(x); return; }
        if (!(x.id in seen)) { seen[x.id] = out.length; out.push(x); return; }
        if (key(x) > key(out[seen[x.id]])) out[seen[x.id]] = x;
      });
    }
    push(a); push(b);
    return out;
  }

  function mergeData(current, incoming) {
    var cur = shape(current), inc = shape(incoming);
    var ann = {};
    Object.keys(cur.annotations).forEach(function (k) { ann[k] = cur.annotations[k].slice(); });
    Object.keys(inc.annotations).forEach(function (k) {
      ann[k] = mergeById(ann[k] || [], inc.annotations[k], 'createdAt');
    });

    var recent = [], seen = {};
    inc.recent.concat(cur.recent).forEach(function (r) {
      var k = r && (r.path || r.key);
      if (!k || seen[k]) return;
      seen[k] = 1; recent.push(r);
    });

    return {
      version: 1,
      folders: mergeById(cur.folders, inc.folders, 'updatedAt'),
      notes: mergeById(cur.notes, inc.notes, 'updatedAt'),
      annotations: ann,
      recent: recent.slice(0, 8),
      settings: Object.assign({}, inc.settings, cur.settings)  // 当前偏好优先
    };
  }

  function replaceData(incoming) { return shape(incoming); }

  return { KIND: KIND, shape: shape, statsOf: statsOf, build: build, parse: parse,
    mergeById: mergeById, mergeData: mergeData, replaceData: replaceData };
});
