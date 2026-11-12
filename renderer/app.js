/* PDF Studio —— renderer 主控制器 */
(async function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  if (!window.studio) {
    document.body.innerHTML = '<div style="max-width:520px;margin:120px auto;font:14px/1.9 system-ui;color:#1f2328">' +
      '<h2>请在 PDF Studio 桌面应用中打开</h2><p>这个页面依赖 Electron 提供的本地文件能力，' +
      '直接双击 HTML 是无法读取 PDF 的。</p><p>请在项目目录运行 <code>run.cmd</code>，' +
      '或把 PDF 拖到应用窗口里。</p></div>';
    return;
  }

  // 颜色表由主进程单一数据源提供（lib/pdf-annotate.js）
  var PAL = { colors: { yellow: [1, 0.83, 0.2] }, names: {} };
  try { PAL = (await window.studio.palette()) || PAL; } catch (e) {}
  PAL.colors = PAL.colors || { yellow: [1, 0.83, 0.2] };
  PAL.names = PAL.names || {};

  var PRODUCT = { name: 'PDF Studio', version: '1.0.0', tagline: '', copyright: '', license: '', homepage: '' };
  try { PRODUCT = (await window.studio.product()) || PRODUCT; } catch (e) {}

  var D;
  try { D = await window.studio.loadData(); } catch (e) { D = {}; }
  D = D || {};
  D.folders = Array.isArray(D.folders) ? D.folders : [];
  D.notes = Array.isArray(D.notes) ? D.notes : [];
  D.annotations = (D.annotations && typeof D.annotations === 'object') ? D.annotations : {};
  D.recent = Array.isArray(D.recent) ? D.recent : [];
  D.settings = (D.settings && typeof D.settings === 'object') ? D.settings : {};

  var S = {
    data: D, key: null, path: null, name: '', pageSizes: [], annos: [],
    tool: D.settings.tool || 'highlight', color: D.settings.color || 'yellow',
    saveT: null, findT: null, pendingPin: null, findHits: [],
    brushWidth: D.settings.brushWidth || 3
  };

  /* 数据文件损坏时明确告警，绝不静默当成空库 */
  try {
    var bootWarn = window.studio.storeWarning ? await window.studio.storeWarning() : '';
    if (bootWarn) {
      console.warn(bootWarn);   // 主进程已记为 error，这里只是界面提示，不污染错误监控
      var warnBar = document.createElement('div');
      warnBar.setAttribute('role', 'alert');
      warnBar.style.cssText = 'position:fixed;right:14px;bottom:34px;z-index:70;' +
        'max-width:min(460px,calc(100vw - 28px));padding:10px 32px 10px 12px;' +
        'background:#fff3cd;color:#7a4b00;border:1px solid #e6c37a;border-radius:8px;' +
        'font-size:12px;line-height:1.7;box-shadow:0 4px 16px rgba(0,0,0,.12)';
      warnBar.textContent = bootWarn;
      var warnX = document.createElement('button');
      warnX.textContent = '×';
      warnX.title = '关闭';
      warnX.style.cssText = 'position:absolute;right:6px;top:4px;border:0;background:none;' +
        'color:#7a4b00;font-size:16px;line-height:1;cursor:pointer';
      warnX.onclick = function () { warnBar.remove(); };
      warnBar.appendChild(warnX);
      document.body.appendChild(warnBar);
      PS.toast('数据文件异常，已保留副本', true);
    }
  } catch (e) {}

  var HINTS = {
    highlight: '拖选文字即可高亮', underline: '拖选文字加下划线', strike: '拖选文字加删除线',
    area: '在页面上拖出一个方框', arrow: '从空白处拖向目标文字，自动生成箭头',
    ink: '按住拖动自由划线，粗细可调', pin: '在页面上点一下放便签',
    browse: '只读模式，可选中复制文字', erase: '点已有标注即可擦除'
  };
  var TYPES = {
    highlight: '高亮', underline: '下划线', strike: '删除线', area: '区域',
    arrow: '箭头', ink: '笔刷', pin: '便签'
  };

  /* ---------------- 持久化 ---------------- */
  function snapshot() { return JSON.parse(JSON.stringify(S.data)); }
  function queueSave() {
    $('#stSave').textContent = '未保存…';
    clearTimeout(S.saveT);
    S.saveT = setTimeout(saveNow, 320);
  }
  async function saveNow() {
    clearTimeout(S.saveT);
    try {
      await window.studio.saveData(snapshot());
      var d = new Date();
      $('#stSave').textContent = '已保存 ' + String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    } catch (e) { $('#stSave').textContent = '保存失败'; PS.toast('保存失败：' + (e.message || e), true); }
  }
  // 兜底：同步 IPC，窗口销毁前一定能写完（主进程的 close 拦截才是主路径）
  window.addEventListener('beforeunload', function () {
    try {
      if (window.studio.saveDataSync) window.studio.saveDataSync(snapshot());
      else window.studio.saveData(snapshot());
    } catch (e) {}
  });
  // 主路径：主进程拦下 close，发 app:flush，等这里 saveNow 完成再销毁窗口
  if (window.studio.onFlush) {
    window.studio.onFlush(async function () {
      try { await saveNow(); }
      catch (e) { console.error('关窗保存失败', e); }
      finally { try { window.studio.flushDone(); } catch (e) {} }
    });
  }

  function fileKey(u8) {
    var h = 0x811c9dc5, n = u8.length, step = Math.max(1, Math.floor(n / 131072));
    for (var i = 0; i < n; i += step) { h ^= u8[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= n; h = Math.imul(h, 0x01000193) >>> 0;
    return 'p' + n.toString(36) + '-' + h.toString(16);
  }

  /* ---------------- 状态栏 / 列表 ---------------- */
  function updateStatus() {
    $('#stNote').textContent = Notes.count() + ' 篇笔记';
    $('#stAnno').textContent = S.annos.length + ' 条标注';
    $('#annoCount').textContent = S.annos.length;
  }
  function setRightTab(name) {
    $$('[data-rtab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-rtab') === name); });
    $('#panelAnno').hidden = (name !== 'anno');
    $('#panelSearch').hidden = (name !== 'search');
  }
  function renderRecent() {
    var box = $('#recent');
    if (!S.data.recent.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div style="font-weight:600;color:#1f2328;margin-bottom:4px">最近打开</div>' +
      S.data.recent.map(function (r) {
        return '<div class="r" data-p="' + PS.esc(r.path) + '">' + PS.esc(r.name) +
          ' <span style="float:right">' + (r.pages || '?') + ' 页</span></div>';
      }).join('');
  }
  function renderAnnoList() {
    updateStatus();
    var box = $('#annoList');
    if (!S.annos.length) {
      box.innerHTML = '<div class="empty">当前文档还没有标注。<br>选中文字即可高亮，<br>或切到「框选区域 / 便签」。</div>';
      return;
    }
    box.innerHTML = S.annos.map(function (a, i) {
      return '<div class="aitem" data-id="' + PS.esc(a.id) + '">' +
        '<div class="ah"><span class="badge t-' + PS.esc(a.type) + '">' + (TYPES[a.type] || '标注') + '</span>' +
        '<span>第 ' + a.page + ' 页</span><span style="margin-left:auto">#' + (i + 1) + '</span></div>' +
        '<div class="aquote">' + PS.esc(annoQuote(a)) + '</div>' +
        '<textarea class="acomment" data-id="' + PS.esc(a.id) + '" placeholder="给这条标注写备注…">' + PS.esc(a.comment || '') + '</textarea>' +
        '<div class="arow"><button class="mini" data-go="' + PS.esc(a.id) + '">定位</button>' +
        '<button class="mini del" data-del="' + PS.esc(a.id) + '">删除</button></div></div>';
    }).join('');
  }
  function findAnno(id) { return S.annos.filter(function (a) { return a.id === id; })[0] || null; }
  function colorName(k) { return PAL.names[k] || k || ''; }
  function annoQuote(a) {
    if (a.comment) return a.comment;
    if (a.type === 'arrow') return '→ 指向：' + (a.text || '页面位置');
    if (a.type === 'ink') return '自由划线 · ' + (a.points || []).length + ' 个笔迹点';
    return a.text || '（无文字）';
  }

  function renderSearchList(hits, q) {
    var box = $('#searchList');
    var head = '<div class="rbar">' + (q ? '共找到 ' + hits.length + ' 处' : '全文查找') + '</div>';
    if (!q) { box.innerHTML = head + '<div class="empty">在顶栏输入关键词，<br>会列出所有页的匹配位置。</div>'; return; }
    if (!hits.length) { box.innerHTML = head + '<div class="empty">没有找到「' + PS.esc(q) + '」</div>'; return; }
    box.innerHTML = head + hits.map(function (h, i) {
      var s = PS.esc(h.snippet);
      var re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      s = s.replace(re, function (m) { return '<b>' + m + '</b>'; });
      return '<div class="sres" data-i="' + i + '"><span class="ctx">第 ' + h.page + ' 页</span> ' + s + '</div>';
    }).join('');
  }

  /* ---------------- 打开 PDF ---------------- */
  async function openPath(p) {
    if (!p) return;
    PS.toast('正在打开 PDF…');
    try {
      var f = await window.studio.readPdf(p);
      var key = fileKey(f.bytes);
      var info = await PdfView.open(f.bytes);

      S.key = key; S.path = f.path; S.name = f.name; S.pageSizes = info.sizes;
      S.annos = (S.data.annotations[key] || []).slice();
      PdfView.setAnnotations(S.annos);

      $('#docName').textContent = f.name;
      $('#docName').title = f.path;
      $('#pageTotal').textContent = '/ ' + info.pages;
      $('#pageNum').max = info.pages;
      $('#pageNum').value = '1';
      $('#pageNum').disabled = false;
      $('#findInput').disabled = false;
      $('#prevBtn').disabled = false; $('#nextBtn').disabled = false;
      $('#welcome').hidden = true; $('#viewer').hidden = false;
      Notes.showReader();

      S.data.recent = [{ key: key, name: f.name, path: f.path, pages: info.pages, openedAt: PS.now() }]
        .concat(S.data.recent.filter(function (r) { return r.path !== f.path; })).slice(0, 8);
      queueSave();
      renderRecent();
      renderAnnoList();
      renderSearchList([], '');

      await PdfView.renderOutline($('#outlineTree'), $('#outlineEmpty'));
      await PdfView.renderThumbs($('#thumbList'), $('#thumbEmpty'));
      PdfView.markThumb(1);

      var z = S.data.settings.zoom || '1';
      $('#zoomSel').value = z;
      if (z === 'fit') PdfView.fitWidth(); else PdfView.setZoom(parseFloat(z) || 1);

      updateStatus();
      PS.toast('已打开：' + f.name + '（' + info.pages + ' 页）');
    } catch (e) {
      console.error(e);
      PS.toast('打开失败：' + (e && e.message || e), true);
    }
  }
  async function pickOpen() {
    try { var p = await window.studio.openDialog(); if (p) await openPath(p); }
    catch (e) { PS.toast('打开对话框失败：' + (e.message || e), true); }
  }

  /* ---------------- 导出中心 ---------------- */
  function buildAnnoSummary() {
    var lines = ['# 标注汇总', '',
      '- 文档：' + (S.name || '—'),
      '- 导出时间：' + new Date().toLocaleString('zh-CN'),
      '- 共 ' + S.annos.length + ' 条标注', '', '---', ''];
    var byPage = {};
    S.annos.forEach(function (a) { (byPage[a.page] = byPage[a.page] || []).push(a); });
    Object.keys(byPage).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (pg) {
      lines.push('## 第 ' + pg + ' 页', '');
      byPage[pg].forEach(function (a, i) {
        lines.push((i + 1) + '. **' + (TYPES[a.type] || a.type) + '** · ' + colorName(a.color) + '色');
        if (a.type === 'arrow') lines.push('   - 指向原文：' + (a.text || '（页面位置）'));
        else if (a.type === 'ink') lines.push('   - 自由笔迹：' + (a.points || []).length + ' 点，粗细 ' + (a.width || 2.6));
        else if (a.text) lines.push('   > ' + PS.strip(a.text).slice(0, 400));
        if (a.comment) lines.push('   - 批注：' + PS.strip(a.comment));
        lines.push('');
      });
    });
    return lines.join('\n');
  }
  function buildCombined() {
    return '# ' + (S.name || 'PDF Studio') + ' · 笔记与标注合订\n\n导出时间：' +
      new Date().toLocaleString('zh-CN') + '\n\n---\n\n# 第一部分 · 自由笔记\n\n' +
      Notes.allMarkdown() + '\n---\n\n# 第二部分 · 标注汇总\n\n' + buildAnnoSummary();
  }
  function buildBackup() {
    // 必须是 S.data 全量：标注按 pdfKey 挂在 data.annotations 上，只写 S.annos 会丢其它文档
    if (!window.PSBackup) throw new Error('备份模块未加载');
    return window.PSBackup.build(snapshot(), { name: S.name, path: S.path, key: S.key });
  }

  /* 导入备份 / 恢复数据 */
  async function importBackup() {
    if (!window.PSBackup) { PS.toast('备份模块未加载，无法导入', true); return; }
    var r;
    try { r = await window.studio.importBackup(); }
    catch (e) { PS.toast('读取备份失败：' + (e.message || e), true); return; }
    if (!r || r.canceled) return;
    if (!r.ok) { PS.toast('读取备份失败：' + (r.error || ''), true); return; }

    var info = window.PSBackup.parse(r.text);
    if (!info.ok) { PS.toast(info.error, true); return; }
    var st = info.stats;
    var mode = await PS.dialog({
      title: '导入备份',
      text: '备份 v' + info.version + '，包含 ' + st.notes + ' 篇笔记 / ' + st.folders +
        ' 个文件夹 / ' + st.documents + ' 个文档的 ' + st.annotations + ' 条标注。\n' +
        '导入前会自动把当前数据另存一份副本。',
      label: '恢复方式',
      options: [
        { value: 'merge', label: '合并（推荐）：保留现有内容，按 id 补齐并取较新版本' },
        { value: 'replace', label: '覆盖：用备份完全替换当前数据' }
      ]
    });
    if (!mode) return;
    if (mode === 'replace' && !await PS.confirm('确认覆盖',
      '当前所有笔记与标注将被备份内容替换。\n导入前会自动留副本，但仍建议先手动导出一次。')) return;

    var res;
    try { res = await window.studio.applyBackup({ text: r.text, mode: mode }); }
    catch (e) { PS.toast('导入失败：' + (e.message || e), true); return; }
    if (!res || !res.ok) { PS.toast('导入失败：' + ((res && res.error) || ''), true); return; }

    // 原地替换，保持 Notes 持有的 data 引用有效
    Object.keys(S.data).forEach(function (k) { delete S.data[k]; });
    Object.keys(res.data).forEach(function (k) { S.data[k] = res.data[k]; });
    S.annos = ((S.key && S.data.annotations[S.key]) || []).slice();
    PdfView.setAnnotations(S.annos);
    Notes.setData(S.data);
    restoreTools();
    var z = S.data.settings.zoom || '1';
    $('#zoomSel').value = z;
    if (z === 'fit') PdfView.fitWidth(); else PdfView.setZoom(parseFloat(z) || 1);
    renderRecent(); renderAnnoList(); renderSearchList([], ''); updateStatus();
    PS.toast('已导入：' + st.notes + ' 篇笔记 / ' + st.annotations + ' 条标注');
  }

  async function exportCenter() {
    var v = await PS.dialog({
      title: '导出中心', label: '选择要导出的内容',
      options: [
        { value: 'bundle', label: '一键打包：带注释 PDF + 3 份文档（推荐）' },
        { value: 'pdf', label: '带真实注释对象的新 PDF' },
        { value: 'summary', label: '标注汇总 → Markdown' },
        { value: 'combined', label: '笔记 + 标注合订 → Markdown' },
        { value: 'backup', label: '完整备份 → JSON' },
        { value: 'import', label: '导入备份 / 恢复数据…' }
      ]
    });
    if (v === null) return;
    if (v === 'import') return importBackup();
    if (!S.path) { PS.toast('先打开一个 PDF', true); return; }
    if (v === 'pdf') return doExport();
    if (v === 'bundle') {
      try {
        var r = await window.studio.exportBundle({
          srcPath: S.path, annotations: S.annos, pageSizes: S.pageSizes,
          wantPdf: S.annos.length > 0,
          files: [
            { name: '标注汇总.md', text: buildAnnoSummary() },
            { name: '笔记与标注合订.md', text: buildCombined() },
            { name: '完整备份.json', text: buildBackup() }
          ]
        });
        if (!r || r.canceled) return;
        PS.toast('已导出 ' + r.files.length + ' 个文件');
        if (await PS.confirm('打包完成', '已写入 ' + r.files.length + ' 个文件到：\n' + r.dir + '\n\n点「确定」打开所在文件夹。')) {
          window.studio.reveal(r.files[0]);
        }
      } catch (e) { PS.toast('打包失败：' + (e.message || e), true); }
      return;
    }
    var map = {
      summary: { name: '标注汇总.md', ext: 'md', text: buildAnnoSummary },
      combined: { name: '笔记与标注合订.md', ext: 'md', text: buildCombined },
      backup: { name: 'pdf-studio-备份.json', ext: 'json', text: buildBackup }
    };
    var it = map[v]; if (!it) return;
    try {
      var rr = await window.studio.exportText({ defaultName: it.name, ext: it.ext, text: it.text() });
      if (rr && rr.ok) PS.toast('已导出：' + rr.path);
    } catch (e) { PS.toast('导出失败：' + (e.message || e), true); }
  }

  /* ---------------- 导出真实 PDF 注释 ---------------- */
  async function doExport() {
    if (!S.path) { PS.toast('先打开一个 PDF', true); return; }
    if (!S.annos.length) { PS.toast('当前文档还没有标注', true); return; }
    try {
      var r = await window.studio.saveAnnotated({
        srcPath: S.path, annotations: S.annos, pageSizes: S.pageSizes
      });
      if (!r || r.canceled) return;
      var show = await PS.confirm('导出完成',
        '共写入 ' + r.count + ' 条真实 PDF 注释对象。\n文件：' + r.path +
        '\n\n这份 PDF 在 Adobe Reader / 浏览器 / 微信里都能看到标注，也可以直接发给别人。\n点「确定」在文件夹中显示。');
      if (show) window.studio.reveal(r.path);
      PS.toast('已导出 ' + r.count + ' 条注释');
    } catch (e) { PS.toast('导出失败：' + (e.message || e), true); }
  }

  /* ---------------- 初始化各模块 ---------------- */
  Notes.init({
    data: S.data,
    save: queueSave,
    hooks: {
      onStatus: updateStatus,
      onView: function (v) { if (v === 'reader') { /* 阅读视图 */ } }
    }
  });

  PdfView.init({
    viewer: $('#viewer'), container: $('#pages'),
    hooks: {
      onAnnos: function (list) {
        S.annos = list;
        if (S.key) S.data.annotations[S.key] = list;
        queueSave(); renderAnnoList();
      },
      onAnnoCount: function () { /* 由 onAnnos 统一刷新 */ },
      onAnnoClick: function (id) {
        setRightTab('anno');
        var item = $('.aitem[data-id="' + id + '"]');
        if (item) {
          $$('.aitem').forEach(function (x) { x.classList.remove('on'); });
          item.classList.add('on'); item.scrollIntoView({ block: 'center' });
        }
      },
      onPage: function (n, total) {
        $('#pageNum').value = n;
        $('#stPage').textContent = '第 ' + n + ' / ' + total + ' 页';
        PdfView.markThumb(n);
      },
      onZoom: function (z) { $('#stZoom').textContent = Math.round(z * 100) + '%'; },
      onFind: function (hits, q) { S.findHits = hits.slice(); renderSearchList(hits, q); if (q) setRightTab('search'); },
      onPin: function (info) {
        S.pendingPin = info;
        var box = $('#pinBox');
        box.style.display = 'block';
        box.style.left = Math.min(window.innerWidth - 270, Math.max(8, info.clientX)) + 'px';
        box.style.top = Math.min(window.innerHeight - 170, Math.max(8, info.clientY)) + 'px';
        $('#pinText').value = '';
        $('#pinText').focus();
      },
      onToast: function (m) { PS.toast(m); },
      onError: function (m) { PS.toast(m, true); },
      onFit: function () { if ($('#zoomSel').value === 'fit') PdfView.fitWidth(); }
    }
  });

  /* ---------------- 调色板 / 粗细（颜色只有后端一个数据源） ---------------- */
  function renderPalette() {
    $('#colors').innerHTML = Object.keys(PAL.colors).map(function (k) {
      return '<i class="color' + (k === S.color ? ' on' : '') + '" data-c="' + PS.esc(k) +
        '" title="' + PS.esc(PAL.names[k] || k) + '" style="background:' + PdfView.colorHex(k) + '"></i>';
    }).join('');
  }
  PdfView.setPalette(PAL.colors, PAL.names);
  PdfView.setBrushWidth(S.brushWidth);
  $('#brushWidth').value = String(S.brushWidth);
  renderPalette();

  /* ---------------- 顶栏 / 工具条事件 ---------------- */
  $('#openBtn').addEventListener('click', pickOpen);
  $('#welcomeOpen').addEventListener('click', pickOpen);
  $('#exportBtn').addEventListener('click', exportCenter);
  $('#recent').addEventListener('click', function (e) {
    var r = e.target.closest ? e.target.closest('.r[data-p]') : null;
    if (r) openPath(r.getAttribute('data-p'));
  });

  $$('.tool').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.tool').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      S.tool = b.getAttribute('data-tool');
      S.data.settings.tool = S.tool; queueSave();
      PdfView.setTool(S.tool, S.color);
      $('#toolHint').textContent = HINTS[S.tool] || '';
    });
  });
  $('#colors').addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('.color[data-c]') : null;
    if (!c) return;
    $$('#colors .color').forEach(function (x) { x.classList.remove('on'); });
    c.classList.add('on');
    S.color = c.getAttribute('data-c');
    S.data.settings.color = S.color; queueSave();
    PdfView.setTool(S.tool, S.color);
  });
  $('#brushWidth').addEventListener('change', function (e) {
    S.brushWidth = Number(e.target.value) || 3;
    S.data.settings.brushWidth = S.brushWidth; queueSave();
    PdfView.setBrushWidth(S.brushWidth);
  });
  function restoreTools() {
    S.tool = S.data.settings.tool || 'highlight';
    S.color = S.data.settings.color || 'yellow';
    S.brushWidth = S.data.settings.brushWidth || 3;
    $$('.tool').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tool') === S.tool); });
    $$('#colors .color').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-c') === S.color); });
    PdfView.setTool(S.tool, S.color);
    PdfView.setBrushWidth(S.brushWidth);
    $('#brushWidth').value = String(S.brushWidth);
    $('#toolHint').textContent = HINTS[S.tool] || '';
  }
  restoreTools();

  $('#prevBtn').addEventListener('click', function () { PdfView.gotoPage(PdfView.currentPage() - 1); });
  $('#nextBtn').addEventListener('click', function () { PdfView.gotoPage(PdfView.currentPage() + 1); });
  $('#pageNum').addEventListener('change', function (e) { PdfView.gotoPage(e.target.value); });
  $('#zoomSel').addEventListener('change', function (e) {
    var v = e.target.value;
    if (v === 'fit') PdfView.fitWidth(); else PdfView.setZoom(parseFloat(v));
    S.data.settings.zoom = v; queueSave();
  });
  $('#findInput').addEventListener('input', function (e) {
    var q = e.target.value;
    clearTimeout(S.findT);
    S.findT = setTimeout(function () { PdfView.find(q); }, 280);
  });
  $('#insertQuote').addEventListener('click', async function () {
    if (!S.path) { PS.toast('先打开 PDF', true); return; }
    var pg = PdfView.currentPage();
    var sel = window.getSelection();
    var t = sel ? PS.strip(sel.toString()) : '';
    if (!t) {
      try { t = PS.strip((await PdfView.pageText(pg)).slice(0, 180)); } catch (e) {}
    }
    Notes.insertQuote(t, pg, S.name);
  });

  $$('[data-ltab]').forEach(function (b) {
    b.addEventListener('click', function () { Notes.setLeftTab(b.getAttribute('data-ltab')); });
  });
  $$('[data-rtab]').forEach(function (b) {
    b.addEventListener('click', function () { setRightTab(b.getAttribute('data-rtab')); });
  });

  $('#clearAnno').addEventListener('click', async function () {
    if (!S.path) return;
    var n = PdfView.currentPage();
    if (await PS.confirm('清空本页标注', '将删除第 ' + n + ' 页的全部标注，确定？')) {
      var c = PdfView.clearPage(n);
      PS.toast('已清空第 ' + n + ' 页的 ' + c + ' 条标注');
    }
  });
  $('#annoList').addEventListener('input', function (e) {
    if (!e.target.classList || !e.target.classList.contains('acomment')) return;
    var a = findAnno(e.target.getAttribute('data-id'));
    if (!a) return;
    a.comment = e.target.value;
    if (S.key) S.data.annotations[S.key] = S.annos;
    queueSave();
  });
  $('#annoList').addEventListener('change', function (e) {
    if (e.target.classList && e.target.classList.contains('acomment')) PdfView.setAnnotations(S.annos);
  });
  $('#annoList').addEventListener('click', function (e) {
    var del = e.target.closest ? e.target.closest('[data-del]') : null;
    if (del) { PdfView.removeAnnotation(del.getAttribute('data-del')); return; }
    var go = e.target.closest ? e.target.closest('[data-go]') : null;
    if (go) { PdfView.flash(go.getAttribute('data-go')); return; }
    var item = e.target.closest ? e.target.closest('.aitem[data-id]') : null;
    if (item && !e.target.closest('textarea')) PdfView.flash(item.getAttribute('data-id'));
  });
  $('#searchList').addEventListener('click', function (e) {
    var r = e.target.closest ? e.target.closest('.sres[data-i]') : null;
    if (!r) return;
    var hit = S.findHits[Number(r.getAttribute('data-i'))];
    if (hit) PdfView.gotoHit(hit);
  });

  /* 便签弹层 */
  $('#pinCancel').addEventListener('click', function () { $('#pinBox').style.display = 'none'; S.pendingPin = null; });
  $('#pinOk').addEventListener('click', function () {
    if (!S.pendingPin) return;
    PdfView.addAnnotation({
      type: 'pin', page: S.pendingPin.page, x: S.pendingPin.x, y: S.pendingPin.y,
      color: S.color, comment: $('#pinText').value, text: '便签'
    });
    $('#pinBox').style.display = 'none'; S.pendingPin = null;
    PS.toast('便签已添加');
  });

  /* 拖入 PDF */
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (f.path) openPath(f.path);
    else PS.toast('请从系统文件管理器拖入 PDF', true);
  });

  /* ---------------- 帮助 / 关于 / 许可 / 检查更新 ---------------- */
  function infoBox(title, text) {
    return PS.dialog({ title: title, text: text, buttons: [{ label: '关闭', value: null }] });
  }
  function showAbout() {
    return infoBox('关于 ' + PRODUCT.name,
      PRODUCT.name + ' v' + PRODUCT.version + '\n' + (PRODUCT.tagline || '') + '\n\n' +
      (PRODUCT.copyright || '') + '\n许可：' + (PRODUCT.license || '') + '\n' +
      '非商用免费，商业使用需单独书面授权。\n\n' +
      '数据全部保存在本机，不联网上传文档。\n' +
      '主页：' + (PRODUCT.homepage || '尚未配置发布仓库'));
  }
  function showHelp() {
    return infoBox('使用帮助',
      '阅读：顶栏「打开 PDF」，或把文件拖进窗口；Ctrl+F 全文查找。\n\n' +
      '标注：先选工具再操作。高亮/下划线/删除线用拖选文字；框选/箭头/笔刷按住拖动；便签点一下；橡皮可擦除。\n\n' +
      '笔记：左侧「笔记」页签可建文件夹与笔记；阅读时点「插入笔记」把选中文字和页码插进当前笔记。\n\n' +
      '导出：点「导出中心」，可导出带真实 PDF 注释的新文件、Markdown 汇总、合订文档或完整备份。\n\n' +
      '恢复：「文件 → 导入备份 / 恢复数据」，支持合并与覆盖；导入前会自动留副本。\n\n' +
      '数据：自动保存在本机，关窗前强制落盘；请勿手动删除用户数据目录下的备份文件。');
  }
  function showLicense() {
    return infoBox('许可信息',
      PRODUCT.name + ' 按 ' + (PRODUCT.license || '') + ' 发布。\n\n' +
      '个人、教育、研究、公益组织等非商业用途免费，可查看与修改源码。\n' +
      '任何商业目的的使用或分发，需要版权所有者单独书面授权。\n\n' +
      '完整条款见安装目录 LICENSE；商业授权见 COMMERCIAL.md；隐私说明见 PRIVACY.md；第三方组件见 NOTICE。');
  }
  async function checkUpdate() {
    PS.toast('正在检查更新…');
    var r;
    try { r = await window.studio.checkUpdate(); }
    catch (e) { PS.toast('检查更新失败：' + (e.message || e), true); return; }
    if (!r || !r.ok) {
      var why = {
        unconfigured: '尚未配置发布仓库，暂时无法检查更新。',
        network: '网络连接不可用，请稍后再试。',
        timeout: '检查超时，请稍后再试。',
        parse: '更新信息解析失败。'
      }[r && r.reason] || ('检查失败（' + ((r && r.reason) || '未知原因') + '）');
      PS.toast(why, true);
      return;
    }
    if (!r.newer) { infoBox('检查更新', '当前已是最新版本 v' + r.current + '。'); return; }
    var go = await PS.confirm('发现新版本',
      '当前版本 v' + r.current + '，最新版本 v' + r.latest + '。\n' +
      (r.notes ? '\n更新内容：' + String(r.notes).slice(0, 200) + '\n' : '') +
      '\n点「确定」打开发布页面，是否下载由你决定。');
    if (go && r.url) window.studio.openExternal(r.url);
  }

  /* 菜单 / 双击文件关联 */
  window.studio.onMenuOpen(pickOpen);
  window.studio.onMenuExport(exportCenter);
  window.studio.onMenuImport(importBackup);
  if (window.studio.onMenuAbout) {
    window.studio.onMenuAbout(showAbout);
    window.studio.onMenuHelp(showHelp);
    window.studio.onMenuLicense(showLicense);
    window.studio.onMenuUpdate(checkUpdate);
  }
  window.studio.onMenuFind(function () { $('#findInput').focus(); });
  window.studio.onMenuZoom(function (v) {
    if (v === 0) { $('#zoomSel').value = 'fit'; PdfView.fitWidth(); }
    else {
      PdfView.zoomBy(v);
      var z = String(PdfView.getScale());
      if ($$('#zoomSel option').some(function (o) { return o.value === z; })) $('#zoomSel').value = z;
    }
  });
  window.studio.onMenuReveal(function () { if (S.path) window.studio.reveal(S.path); });
  window.studio.onOpenFile(function (p) { openPath(p); });

  /* 启动参数（双击 .pdf 打开走这里） */
  renderRecent(); renderAnnoList(); renderSearchList([], '');
  updateStatus();
  try {
    var first = await window.studio.consumeInitialFile();
    if (first) await openPath(first);
  } catch (e) { console.warn('启动参数处理失败', e); }

  window.__studioApp = {
    state: function () {
      return { key: S.key, path: S.path, name: S.name, tool: S.tool, color: S.color,
        annos: S.annos.length, notes: Notes.count(), pdf: PdfView.debug() };
    },
    openPath: openPath,
    export: doExport,
    exportCenter: exportCenter,
    importBackup: importBackup,
    exports: function () { return { summary: buildAnnoSummary(), combined: buildCombined(), backup: buildBackup() }; },
    backupModule: function () { return window.PSBackup || null; },
    palette: function () { return PAL; },
    product: function () { return PRODUCT; },
    about: showAbout, help: showHelp, license: showLicense, checkUpdate: checkUpdate,
    brushWidth: function () { return S.brushWidth; },
    find: function (q) { return PdfView.find(q); },
    gotoPage: function (n) { PdfView.gotoPage(n); },
    addAnno: function (a) { return PdfView.addAnnotation(a); },
    getAnnos: function () { return PdfView.getAnnotations(); },
    notes: function () { return Notes; }
  };
})();
