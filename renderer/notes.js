/* PDF Studio —— 公共小工具 + 自由文档式笔记本
 * 依赖：无（window.PS / window.Notes 供 pdf-view.js 与 app.js 使用）
 */
(function () {
  'use strict';

  /* ---------------- 公共工具 ---------------- */
  var seq = 0;
  function uid(p) { return (p || 'id') + '-' + Date.now().toString(36) + '-' + (++seq).toString(36); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function strip(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function now() { return new Date().toISOString(); }

  var toastTimer = null;
  function toast(msg, isErr) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = String(msg == null ? '' : msg).slice(0, 240);
    t.title = String(msg == null ? '' : msg).slice(0, 1000);
    t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 2600);
  }

  function dialog(opts) {
    return new Promise(function (resolve) {
      var host = document.getElementById('dlgHost');
      if (!host) { resolve(null); return; }
      var mask = document.createElement('div');
      mask.className = 'mask';
      var html = '<div class="dlg"><h3>' + esc(opts.title || '') + '</h3>';
      if (opts.text) html += '<p>' + esc(opts.text).replace(/\n/g, '<br>') + '</p>';
      if (opts.input !== undefined) {
        html += '<p>' + esc(opts.label || '') + '</p><input id="dlgInput" value="' + esc(opts.input || '') + '">';
      }
      if (opts.options) {
        html += '<p>' + esc(opts.label || '') + '</p><select id="dlgSel">' +
          opts.options.map(function (o, i) {
            return '<option value="' + esc(o.value) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(o.label) + '</option>';
          }).join('') + '</select>';
      }
      html += '<div class="acts">';
      (opts.buttons || [{ label: '确定', value: true }, { label: '取消', value: null }]).forEach(function (b, i) {
        html += '<button class="mini' + (b.danger ? ' del' : '') + '" data-i="' + i + '">' + esc(b.label) + '</button>';
      });
      html += '</div></div>';
      mask.innerHTML = html;
      host.appendChild(mask);

      function done(v) { if (mask.parentNode) mask.parentNode.removeChild(mask); resolve(v); }
      var buttons = opts.buttons || [{ label: '确定', value: true }, { label: '取消', value: null }];
      mask.addEventListener('click', function (e) {
        if (e.target === mask) { done(null); return; }
        var b = e.target.closest ? e.target.closest('button[data-i]') : null;
        if (!b) return;
        var def = buttons[Number(b.getAttribute('data-i'))];
        if (!def) { done(null); return; }
        if (def.value === null) { done(null); return; }
        if (opts.options) { done(document.getElementById('dlgSel').value); return; }
        if (opts.input !== undefined) { done(document.getElementById('dlgInput').value); return; }
        done(true);
      });
      var input = document.getElementById('dlgInput');
      if (input) {
        input.focus(); input.select();
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
          if (e.key === 'Escape') done(null);
        });
      }
      mask.addEventListener('keydown', function (e) { if (e.key === 'Escape') done(null); });
    });
  }
  function confirmBox(title, text) {
    return dialog({ title: title, text: text }).then(function (v) { return v === true; });
  }
  function promptBox(title, label, def) {
    return dialog({ title: title, label: label, input: def || '' }).then(function (v) {
      return v === null || strip(v) === '' ? null : strip(v);
    });
  }

  /* ---------------- Markdown（先转义再渲染，防注入） ---------------- */
  function inline(s) {
    return s
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_m, t, u) {
        return '<a href="' + u + '" data-ext="' + u + '">' + t + '</a>';
      })
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }
  function md(src) {
    var blocks = [];
    var s = esc(String(src || ''));
    s = s.replace(/```([\s\S]*?)```/g, function (_m, code) {
      blocks.push('<pre><code>' + code.replace(/^\n/, '') + '</code></pre>');
      return '\u0000B' + (blocks.length - 1) + '\u0000';
    });
    s = s.replace(/`([^`\n]+)`/g, function (_m, c) { return '<code>' + c + '</code>'; });

    var lines = s.split(/\r?\n/), out = [], para = [], listType = null, quote = [];
    function flushPara() { if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; } }
    function flushList() { if (listType) { out.push('</' + listType + '>'); listType = null; } }
    function flushQuote() { if (quote.length) { out.push('<blockquote>' + inline(quote.join('<br>')) + '</blockquote>'); quote = []; } }
    function flushAll() { flushPara(); flushList(); flushQuote(); }

    lines.forEach(function (ln) {
      var b = /^\u0000B(\d+)\u0000$/.exec(ln);
      if (b) { flushAll(); out.push(blocks[Number(b[1])]); return; }
      if (!ln.trim()) { flushAll(); return; }
      if (/^(---+|\*\*\*+|___+)\s*$/.test(ln)) { flushAll(); out.push('<hr>'); return; }
      var h = /^(#{1,3})\s+(.*)$/.exec(ln);
      if (h) { flushAll(); var n = h[1].length; out.push('<h' + n + '>' + inline(h[2]) + '</h' + n + '>'); return; }
      if (/^&gt;\s?/.test(ln)) { flushPara(); flushList(); quote.push(ln.replace(/^&gt;\s?/, '')); return; }
      flushQuote();
      var li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(ln);
      if (li) {
        flushPara();
        var want = /^\d/.test(li[1]) ? 'ol' : 'ul';
        if (listType !== want) { flushList(); out.push('<' + want + '>'); listType = want; }
        var body = li[2], task = /^\[([ xX])\]\s*(.*)$/.exec(body);
        if (task) {
          out.push('<li class="task"><input type="checkbox" disabled' + (task[1] !== ' ' ? ' checked' : '') + '> ' + inline(task[2]) + '</li>');
        } else out.push('<li>' + inline(body) + '</li>');
        return;
      }
      flushList();
      para.push(ln);
    });
    flushAll();
    return out.join('\n') || '<p class="hint">（空笔记）</p>';
  }

  window.PS = {
    uid: uid, esc: esc, strip: strip, now: now, toast: toast, dialog: dialog,
    confirm: confirmBox, prompt: promptBox, md: md
  };

  /* ---------------- 笔记本 ---------------- */
  var N = {
    data: null, save: null, hooks: {}, id: null, q: '', collapsed: {}, preview: false
  };
  var $ = function (s) { return document.querySelector(s); };

  function note(id) { return (N.data.notes || []).filter(function (n) { return n.id === id; })[0] || null; }
  function folder(id) { return (N.data.folders || []).filter(function (f) { return f.id === id; })[0] || null; }
  function changed() { if (N.save) N.save(); if (N.hooks.onStatus) N.hooks.onStatus(); }
  function count() { return (N.data.notes || []).length; }

  function folderOptions(sel) {
    var list = [{ id: '', name: '（未归类）' }].concat(N.data.folders || []);
    sel.innerHTML = list.map(function (f) {
      return '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>';
    }).join('');
  }

  function renderTree() {
    var tree = $('#noteTree'), res = $('#noteResults');
    if (!tree) return;
    if (N.q) {
      tree.hidden = true; res.hidden = false;
      var q = N.q.toLowerCase();
      var hits = (N.data.notes || []).filter(function (n) {
        return (n.title + ' ' + (n.body || '') + ' ' + (n.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0;
      });
      res.innerHTML = hits.length ? hits.map(function (n) {
        var b = String(n.body || '');
        var i = b.toLowerCase().indexOf(q);
        var snip = i < 0 ? b.slice(0, 70) : b.slice(Math.max(0, i - 24), i + 60);
        return '<div class="nres" data-id="' + esc(n.id) + '"><b>' + esc(n.title || '未命名') + '</b><span>' + esc(snip) + '</span></div>';
      }).join('') : '<div class="empty">没有匹配的笔记</div>';
      return;
    }
    tree.hidden = false; res.hidden = true;

    var folders = N.data.folders || [], notes = N.data.notes || [];
    var html = '';
    function emitFolder(f, depth) {
      var open = !N.collapsed[f.id];
      html += '<div class="nfolder" data-fid="' + esc(f.id) + '" style="padding-left:' + (9 + depth * 13) + 'px">' +
        '<span class="caret">' + (open ? '▾' : '▸') + '</span><span class="nm">' + esc(f.name) + '</span>' +
        '<button class="mini fadd" data-add="' + esc(f.id) + '" title="在此新建笔记" style="margin-left:auto">＋</button></div>';
      if (!open) return;
      notes.filter(function (n) { return n.folder === f.id; }).forEach(function (n) {
        html += noteRow(n, depth + 1);
      });
      folders.filter(function (x) { return x.parent === f.id; }).forEach(function (x) { emitFolder(x, depth + 1); });
    }
    function noteRow(n, depth) {
      return '<div class="nrow' + (n.id === N.id ? ' on' : '') + '" data-id="' + esc(n.id) + '" style="padding-left:' + (9 + depth * 13) + 'px">' +
        '<span class="nm">' + esc(n.title || '未命名') + '</span>' +
        (n.source && n.source.page ? '<span class="pg">P' + esc(n.source.page) + '</span>' : '') + '</div>';
    }
    folders.filter(function (f) { return !f.parent || !folder(f.parent); }).forEach(function (f) { emitFolder(f, 0); });
    notes.filter(function (n) { return !n.folder || !folder(n.folder); }).forEach(function (n) { html += noteRow(n, 0); });
    if (!html) html = '<div class="empty">还没有笔记<br>点上方「＋ 笔记」开始</div>';
    tree.innerHTML = html;
  }

  function renderEditor() {
    var n = note(N.id);
    var head = $('.notehead');
    if (!n) { if (head) head.hidden = true; return; }
    if (head) head.hidden = false;
    $('#noteTitle').value = n.title || '';
    $('#noteTags').value = (n.tags || []).join(', ');
    folderOptions($('#noteFolder'));
    $('#noteFolder').value = n.folder || '';
    $('#noteBody').value = n.body || '';
    N.preview = false;
    $('#noteBody').hidden = false;
    $('#notePreviewOut').hidden = true;
    $('#notePreview').classList.remove('on');
    var when = n.updatedAt ? new Date(n.updatedAt) : null;
    $('#noteFoot').textContent = '创建 ' + (n.createdAt || '').slice(0, 16).replace('T', ' ') +
      ' · 更新 ' + (when ? when.toLocaleString('zh-CN') : '—') +
      (n.source && n.source.name ? ' · 来源《' + n.source.name + '》第 ' + n.source.page + ' 页' : '');
  }

  function showNote(id) {
    N.id = id;
    $('#readerView').hidden = true;
    $('#noteView').hidden = false;
    // 中间区域切到笔记时，左侧自动定位到笔记 tab
    setLeftTab('notes');
    renderTree(); renderEditor();
    if (N.hooks.onView) N.hooks.onView('note');
    $('#noteBody').focus();
  }
  function showReader() {
    $('#noteView').hidden = true;
    $('#readerView').hidden = false;
    if (N.hooks.onView) N.hooks.onView('reader');
  }
  function setLeftTab(name) {
    document.querySelectorAll('[data-ltab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-ltab') === name); });
    ['outline', 'thumbs', 'notes'].forEach(function (k) {
      var el = document.getElementById('panel' + k.charAt(0).toUpperCase() + k.slice(1));
      if (el) el.hidden = (k !== name);
    });
  }

  function createNote(fid) {
    var n = {
      id: uid('note'), title: '未命名笔记', folder: fid || '', body: '', tags: [],
      order: (N.data.notes || []).length, source: null,
      createdAt: now(), updatedAt: now()
    };
    N.data.notes.push(n);
    changed(); showNote(n.id);
    $('#noteTitle').focus(); $('#noteTitle').select();
    return n;
  }
  async function createFolder(parent) {
    var name = await PS.prompt('新建文件夹', '文件夹名称', '新建文件夹');
    if (!name) return;
    N.data.folders.push({ id: uid('fld'), name: name, parent: parent || '' });
    changed(); renderTree();
  }
  async function renameFolder(f) {
    var name = await PS.prompt('重命名文件夹', '文件夹名称', f.name);
    if (!name) return;
    f.name = name; changed(); renderTree();
  }
  async function deleteFolder(f) {
    var kids = (N.data.folders || []).filter(function (x) { return x.parent === f.id; });
    var notes = (N.data.notes || []).filter(function (n) { return n.folder === f.id; });
    if (!await PS.confirm('删除文件夹', '「' + f.name + '」下有 ' + notes.length + ' 篇笔记、' + kids.length + ' 个子文件夹。\n笔记会移到「未归类」，子文件夹会一起删除。')) return;
    notes.forEach(function (n) { n.folder = ''; });
    N.data.folders = N.data.folders.filter(function (x) { return x.id !== f.id && x.parent !== f.id; });
    changed(); renderTree();
  }
  async function folderMenu(f) {
    var v = await PS.dialog({
      title: '文件夹：' + f.name, label: '选择操作',
      options: [
        { value: 'sub', label: '在此新建子文件夹' },
        { value: 'note', label: '在此新建笔记' },
        { value: 'rename', label: '重命名' },
        { value: 'delete', label: '删除文件夹' }
      ]
    });
    if (v === 'sub') await createFolder(f.id);
    else if (v === 'note') createNote(f.id);
    else if (v === 'rename') await renameFolder(f);
    else if (v === 'delete') await deleteFolder(f);
  }
  async function noteMenu(n) {
    var opts = [{ value: 'rename', label: '重命名' }, { value: 'move', label: '移动到文件夹…' }, { value: 'delete', label: '删除笔记' }];
    var v = await PS.dialog({ title: '笔记：' + (n.title || '未命名'), label: '选择操作', options: opts });
    if (v === 'rename') {
      var t = await PS.prompt('重命名笔记', '标题', n.title);
      if (t) { n.title = t; n.updatedAt = now(); changed(); renderTree(); renderEditor(); }
    } else if (v === 'move') {
      var choices = [{ value: '', label: '（未归类）' }].concat((N.data.folders || []).map(function (f) { return { value: f.id, label: f.name }; }));
      var f = await PS.dialog({ title: '移动到文件夹', label: '目标文件夹', options: choices });
      if (f !== null) { n.folder = f; n.updatedAt = now(); changed(); renderTree(); renderEditor(); }
    } else if (v === 'delete') {
      if (await PS.confirm('删除笔记', '确定删除「' + (n.title || '未命名') + '」？此操作不可撤销。')) deleteNote(n.id, true);
    }
  }
  function deleteNote(id, skipConfirm) {
    N.data.notes = N.data.notes.filter(function (x) { return x.id !== id; });
    if (N.id === id) N.id = null;
    changed(); renderTree();
    if (!skipConfirm) { /* 由调用方决定视图 */ }
    if (note(N.id)) renderEditor(); else showReader();
  }

  function insertQuote(text, page, docName) {
    var t = PS.strip(text || '').slice(0, 600);
    if (!t) { PS.toast('先在 PDF 里选中一段文字，或直接点「插入笔记」插入当前页出处', true); return; }
    if (!note(N.id)) createNote('');
    var n = note(N.id);
    if (!n.title || n.title === '未命名笔记') n.title = docName ? docName.replace(/\.pdf$/i, '') + ' · 读书笔记' : '读书笔记';
    if (!n.source) n.source = { name: docName || '', page: page || 1 };
    var cite = '> ' + t.replace(/\n/g, '\n> ') + '\n>\n> —— 《' + (docName || '当前文档') + '》 第 ' + (page || 1) + ' 页\n\n';
    n.body = (n.body ? n.body.replace(/\s*$/, '') + '\n\n' : '') + cite;
    n.updatedAt = now();
    changed(); showNote(n.id);
    var ta = $('#noteBody'); ta.scrollTop = ta.scrollHeight;
    PS.toast('已插入第 ' + (page || 1) + ' 页出处');
  }

  function allMarkdown() {
    function emit(n, depth) {
      return '#'.repeat(Math.min(3, depth + 1)) + ' ' + (n.title || '未命名') + '\n\n' +
        (n.tags && n.tags.length ? '标签：' + n.tags.join(' / ') + '\n\n' : '') +
        (n.body || '') + '\n\n---\n\n';
    }
    var out = '# PDF Studio · 笔记导出\n\n导出时间：' + new Date().toLocaleString('zh-CN') + '\n\n';
    var notes = N.data.notes || [], used = {};
    function walk(parent, depth) {
      (N.data.folders || []).filter(function (f) { return (f.parent || '') === parent; }).forEach(function (f) {
        out += '#'.repeat(Math.min(3, depth + 1)) + ' ' + f.name + '\n\n';
        notes.filter(function (n) { return n.folder === f.id; }).forEach(function (n) { used[n.id] = 1; out += emit(n, depth + 1); });
        walk(f.id, depth + 1);
      });
    }
    walk('', 0);
    notes.filter(function (n) { return !used[n.id]; }).forEach(function (n) { out += emit(n, 0); });
    return out;
  }

  function init(cfg) {
    N.data = cfg.data; N.save = cfg.save; N.hooks = cfg.hooks || {};
    N.collapsed = (cfg.data.settings && cfg.data.settings.collapsedNotes) || {};
    renderTree(); renderEditor();

    $('#noteSearch').addEventListener('input', function (e) { N.q = PS.strip(e.target.value); renderTree(); });
    $('#newNote').addEventListener('click', function () { createNote(''); });
    $('#newFolder').addEventListener('click', function () { createFolder(''); });
    $('#collapseAll').addEventListener('click', function () {
      var anyOpen = (N.data.folders || []).some(function (f) { return !N.collapsed[f.id]; });
      (N.data.folders || []).forEach(function (f) { N.collapsed[f.id] = anyOpen; });
      N.data.settings.collapsedNotes = N.collapsed;
      changed(); renderTree();
    });
    $('#noteTree').addEventListener('click', function (e) {
      var add = e.target.closest ? e.target.closest('[data-add]') : null;
      if (add) { createNote(add.getAttribute('data-add')); return; }
      var frow = e.target.closest ? e.target.closest('[data-fid]') : null;
      if (frow) {
        var fid = frow.getAttribute('data-fid');
        N.collapsed[fid] = !N.collapsed[fid];
        N.data.settings.collapsedNotes = N.collapsed;
        changed(); renderTree(); return;
      }
      var row = e.target.closest ? e.target.closest('.nrow[data-id]') : null;
      if (row) showNote(row.getAttribute('data-id'));
    });
    $('#noteTree').addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var f = e.target.closest ? e.target.closest('[data-fid]') : null;
      var r = e.target.closest ? e.target.closest('.nrow[data-id]') : null;
      if (f) folderMenu(folder(f.getAttribute('data-fid')));
      else if (r) { var n = note(r.getAttribute('data-id')); if (n) noteMenu(n); }
    });
    $('#noteResults').addEventListener('click', function (e) {
      var r = e.target.closest ? e.target.closest('.nres[data-id]') : null;
      if (r) showNote(r.getAttribute('data-id'));
    });

    var timer = null;
    function edited() {
      var n = note(N.id); if (!n) return;
      n.title = $('#noteTitle').value;
      n.tags = $('#noteTags').value.split(/[,，]/).map(PS.strip).filter(Boolean);
      n.folder = $('#noteFolder').value;
      n.body = $('#noteBody').value;
      n.updatedAt = now();
      clearTimeout(timer);
      timer = setTimeout(function () { changed(); var keep = N.id; renderTree(); N.id = keep; }, 300);
      $('#noteFoot').textContent = '编辑中 · 自动保存';
    }
    ['#noteTitle', '#noteTags', '#noteBody'].forEach(function (s) { $(s).addEventListener('input', edited); });
    $('#noteFolder').addEventListener('change', edited);
    $('#notePreview').addEventListener('click', function () {
      N.preview = !N.preview;
      $('#noteBody').hidden = N.preview;
      $('#notePreviewOut').hidden = !N.preview;
      this.classList.toggle('on', N.preview);
      if (N.preview) $('#notePreviewOut').innerHTML = PS.md($('#noteBody').value);
    });
    $('#notePreviewOut').addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[data-ext]') : null;
      if (a && window.studio) window.studio.openExternal(a.getAttribute('data-ext'));
    });
    $('#noteDelete').addEventListener('click', async function () {
      var n = note(N.id); if (!n) return;
      if (await PS.confirm('删除笔记', '确定删除「' + (n.title || '未命名') + '」？此操作不可撤销。')) deleteNote(n.id, true);
    });
    $('#noteBack').addEventListener('click', showReader);
    $('#noteExport').addEventListener('click', async function () {
      if (!window.studio) return;
      var v = await PS.dialog({
        title: '导出笔记', label: '导出范围',
        options: [
          { value: 'all-md', label: '全部笔记 → 一个 Markdown' },
          { value: 'all-json', label: '全部笔记 → JSON 备份' },
          { value: 'one-md', label: '当前笔记 → Markdown' }
        ]
      });
      if (v === null) return;
      var n = note(N.id);
      if (v === 'all-md') {
        await window.studio.exportText({ defaultName: 'pdf-studio-notes.md', ext: 'md', text: allMarkdown() });
      } else if (v === 'all-json') {
        await window.studio.exportText({
          defaultName: 'pdf-studio-notes.json', ext: 'json',
          text: JSON.stringify({ kind: 'pdf-studio-notes', version: 1, folders: N.data.folders, notes: N.data.notes }, null, 2)
        });
      } else if (v === 'one-md') {
        if (!n) { PS.toast('先打开一篇笔记', true); return; }
        await window.studio.exportText({ defaultName: (n.title || 'note').replace(/[\\/:*?"<>|]/g, '_') + '.md', ext: 'md', text: '# ' + n.title + '\n\n' + n.body });
      }
      PS.toast('已导出');
    });
  }

  window.Notes = {
    init: init, renderTree: renderTree, showNote: showNote, showReader: showReader,
    setLeftTab: setLeftTab, insertQuote: insertQuote, count: count,
    current: function () { return note(N.id); }, allMarkdown: allMarkdown,
    setData: function (d) { N.data = d; renderTree(); renderEditor(); }
  };
})();
