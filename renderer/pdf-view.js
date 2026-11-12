/* PDF Studio —— PDF 渲染 / 阅读 / 标注引擎
 * pdf.js 3.11.174 (legacy UMD)，worker 通过 data: URL 注入，不依赖网络、不依赖服务。
 * 标注类型：高亮 / 下划线 / 删除线 / 框选区域 / 便签 / 箭头(/Line) / 笔刷(/Ink)
 */
(function () {
  'use strict';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var V = {
    pdf: null, pages: [], sizes: [], count: 0, scale: 1, gen: 0,
    mode: 'text', tool: 'highlight', color: 'yellow',
    annos: [], findQ: '', findHits: [], findToken: 0,
    viewer: null, container: null, hooks: {}, workerReady: false,
    drag: null, scrollTimer: null,
    palette: { yellow: [1, 0.83, 0.2] }, brushWidth: 3
  };
  function emit(name) {
    var fn = V.hooks['on' + name];
    if (fn) { try { fn.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) { console.warn('hook ' + name, e); } }
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function rgbOf(k) { return V.palette[k] || V.palette.yellow || [1, 0.83, 0.2]; }
  function hex(k) {
    return '#' + rgbOf(k).map(function (v) {
      return Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
    }).join('');
  }
  function rgba(k, a) {
    return 'rgba(' + rgbOf(k).map(function (v) { return Math.round(clamp(v, 0, 1) * 255); }).join(',') + ',' + a + ')';
  }

  /* ---------------- worker ---------------- */
  async function ensureWorker() {
    if (V.workerReady) return;
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js 未加载');
    var src = await window.studio.workerSource();
    var bytes = new TextEncoder().encode(src), bin = '';
    for (var i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'data:text/javascript;base64,' + btoa(bin);
    V.workerReady = true;
  }

  /* ---------------- 打开与页面骨架 ---------------- */
  function makePage(num, pageProxy, size) {
    var el = document.createElement('div'); el.className = 'pdfpage'; el.dataset.page = num;
    var cv = document.createElement('canvas'); cv.className = 'pcanvas';
    var tl = document.createElement('div'); tl.className = 'layer textLayer';
    var an = document.createElement('div'); an.className = 'layer annoLayer';
    var se = document.createElement('div'); se.className = 'layer searchLayer';
    se.style.pointerEvents = 'none';
    var hit = document.createElement('div'); hit.className = 'layer hitLayer';
    var lb = document.createElement('div'); lb.className = 'pagelabel'; lb.textContent = num;
    el.appendChild(cv); el.appendChild(tl); el.appendChild(an); el.appendChild(se); el.appendChild(hit); el.appendChild(lb);
    return {
      num: num, page: pageProxy, el: el, canvas: cv, tl: tl, anno: an, search: se, hit: hit,
      inkSvg: null, tempSvg: null,
      w: size.width, h: size.height, tc: null, text: '', busy: false, rendered: false, task: null, vp: null
    };
  }

  async function open(bytes) {
    await ensureWorker();
    closeDom();
    var data = (bytes instanceof Uint8Array) ? bytes.slice() : new Uint8Array(bytes);
    V.pdf = await pdfjsLib.getDocument({ data: data, useSystemFonts: true }).promise;
    V.count = V.pdf.numPages;
    V.sizes = []; V.pages = []; V.findQ = ''; V.findHits = [];
    V.container.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var i = 1; i <= V.count; i++) {
      var pg = await V.pdf.getPage(i);
      var vp1 = pg.getViewport({ scale: 1 });
      var size = { width: vp1.width, height: vp1.height };
      V.sizes.push(size);
      var p = makePage(i, pg, size);
      V.pages.push(p); frag.appendChild(p.el);
    }
    V.container.appendChild(frag);
    V.viewer.scrollTop = 0;
    applyScale();
    return { pages: V.count, sizes: V.sizes.slice() };
  }

  function closeDom() {
    V.pages.forEach(function (p) { if (p.task) { try { p.task.cancel(); } catch (e) {} } });
    V.pdf = null; V.pages = []; V.sizes = []; V.count = 0; V.annos = [];
    V.findQ = ''; V.findHits = [];
    if (V.container) V.container.innerHTML = '';
  }
  function close() { closeDom(); }

  /* ---------------- 渲染 ---------------- */
  function applyScale() {
    if (!V.count) return;
    V.gen++;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    V.pages.forEach(function (p) {
      if (p.task) { try { p.task.cancel(); } catch (e) {} p.task = null; }
      p.busy = false; p.rendered = false; p.gen = V.gen;
      var vp = p.page.getViewport({ scale: V.scale });
      p.vp = vp;
      p.el.style.width = vp.width + 'px'; p.el.style.height = vp.height + 'px';
      p.canvas.width = Math.floor(vp.width * dpr); p.canvas.height = Math.floor(vp.height * dpr);
      p.canvas.style.width = vp.width + 'px'; p.canvas.style.height = vp.height + 'px';
      p.tl.innerHTML = ''; p.tl.style.setProperty('--scale-factor', V.scale);
      p.anno.innerHTML = ''; p.search.innerHTML = '';
      p.inkSvg = null; p.tempSvg = null;
    });
    setMode(V.mode);
    drawAnnos();
    renderVisible();
    V.pages.forEach(paintSearch);
  }

  function renderVisible() {
    if (!V.viewer || !V.count) return;
    var vr = V.viewer.getBoundingClientRect();
    V.pages.forEach(function (p) {
      var r = p.el.getBoundingClientRect();
      if (r.bottom > vr.top - 600 && r.top < vr.bottom + 900) renderPage(p);
    });
  }

  function renderPage(p) {
    if (p.busy || p.rendered || !p.page) return;
    p.busy = true;
    var gen = V.gen, vp = p.vp;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var ctx = p.canvas.getContext('2d', { alpha: false });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, p.canvas.width, p.canvas.height);
    var task = p.page.render({
      canvasContext: ctx, viewport: vp,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
    });
    p.task = task;
    task.promise.then(async function () {
      if (gen !== V.gen) return;
      if (!p.tc) p.tc = await p.page.getTextContent();
      if (gen !== V.gen) return;
      p.text = (p.tc.items || []).map(function (x) { return x.str; }).join(' ');
      p.tl.innerHTML = '';
      p.tl.style.setProperty('--scale-factor', V.scale);
      var rt = pdfjsLib.renderTextLayer({
        textContent: p.tc, container: p.tl, viewport: vp,
        textDivs: [], textContentItemsStr: [], enhanceTextSelection: true
      });
      if (rt && rt.promise) { try { await rt.promise; } catch (e) {} }
      if (gen !== V.gen) return;
      p.rendered = true;
      paintSearch(p);
      emit('Render', p.num);
    }).catch(function (e) {
      if (e && /Cancel/i.test(e.name || '')) return;
      console.warn('渲染第 ' + p.num + ' 页失败', e);
      emit('Error', '第 ' + p.num + ' 页渲染失败：' + (e && e.message || e));
    }).then(function () {
      if (p.task === task) { p.task = null; p.busy = false; }
    });
  }

  /* ---------------- 缩放 / 翻页 ---------------- */
  function setZoom(z) { V.scale = clamp(Number(z) || 1, 0.25, 4); applyScale(); emit('Zoom', V.scale); }
  function getZoom() { return V.scale; }
  function zoomBy(d) {
    if (d === 0) { fitWidth(); return; }
    var steps = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
    var cur = V.scale, next = null;
    if (d > 0) { for (var i = 0; i < steps.length; i++) if (steps[i] > cur + 0.01) { next = steps[i]; break; } }
    else { for (var j = steps.length - 1; j >= 0; j--) if (steps[j] < cur - 0.01) { next = steps[j]; break; } }
    setZoom(next == null ? cur : next);
  }
  function fitWidth() {
    if (!V.sizes.length) return;
    var w = (V.viewer.clientWidth || 900) - 56;
    setZoom(clamp(w / V.sizes[0].width, 0.25, 4));
  }
  function gotoPage(n) {
    if (!V.count) return;
    n = clamp(Math.round(Number(n) || 1), 1, V.count);
    var p = V.pages[n - 1];
    var top = p.el.getBoundingClientRect().top - V.viewer.getBoundingClientRect().top + V.viewer.scrollTop - 14;
    V.viewer.scrollTop = Math.max(0, top);
    renderVisible(); emit('Page', n, V.count);
  }
  function currentPage() {
    if (!V.viewer || !V.count) return 1;
    var top = V.viewer.getBoundingClientRect().top + 80;
    for (var i = 0; i < V.pages.length; i++) {
      if (V.pages[i].el.getBoundingClientRect().bottom > top) return i + 1;
    }
    return V.count;
  }
  function onScroll() {
    clearTimeout(V.scrollTimer);
    V.scrollTimer = setTimeout(function () { renderVisible(); emit('Page', currentPage(), V.count); }, 80);
  }

  /* ---------------- 目录 / 缩略图 ---------------- */
  async function destPage(dest) {
    try {
      var d = Array.isArray(dest) ? dest : await V.pdf.getDestination(String(dest));
      if (!d) return null;
      var ref = Array.isArray(d) ? d[0] : d;
      return await V.pdf.getPageIndex(ref) + 1;
    } catch (e) { return null; }
  }
  async function outlineData() {
    if (!V.pdf) return [];
    var ol = null;
    try { ol = await V.pdf.getOutline(); } catch (e) { return []; }
    var out = [];
    async function walk(items, depth) {
      for (var i = 0; i < (items || []).length && out.length < 500; i++) {
        var it = items[i], pg = it.dest ? await destPage(it.dest) : null;
        out.push({ title: String(it.title || '（无标题）'), page: pg, depth: depth });
        if (it.items && it.items.length) await walk(it.items, depth + 1);
      }
    }
    await walk(ol, 0);
    return out;
  }
  async function renderOutline(el, emptyEl) {
    var list = await outlineData();
    el.innerHTML = list.map(function (o) {
      return '<div class="olitem" data-p="' + (o.page || 0) + '" style="padding-left:' + (10 + o.depth * 14) + 'px">' +
        '<span class="tx" title="' + PS.esc(o.title) + '">' + PS.esc(o.title) + '</span>' +
        (o.page ? '<span class="pg">' + o.page + '</span>' : '') + '</div>';
    }).join('');
    if (emptyEl) emptyEl.hidden = list.length > 0;
    el.onclick = function (e) {
      var it = e.target.closest ? e.target.closest('.olitem[data-p]') : null;
      if (!it) return;
      var p = Number(it.getAttribute('data-p'));
      if (p > 0) gotoPage(p);
    };
    return list.length;
  }

  var thumbIO = null;
  async function renderThumbs(el, emptyEl) {
    if (thumbIO) { thumbIO.disconnect(); thumbIO = null; }
    if (!V.count) { el.innerHTML = ''; if (emptyEl) emptyEl.hidden = false; return 0; }
    if (emptyEl) emptyEl.hidden = true;
    el.innerHTML = V.pages.map(function (p) {
      return '<div class="thumb" data-p="' + p.num + '"><canvas width="120" height="160"></canvas><span>' + p.num + '</span></div>';
    }).join('');
    async function paint(node) {
      var num = Number(node.getAttribute('data-p'));
      var p = V.pages[num - 1]; if (!p || node.dataset.done) return;
      node.dataset.done = '1';
      var cv = node.querySelector('canvas');
      var s = clamp(120 / p.w, 0.05, 0.5);
      var vp = p.page.getViewport({ scale: s });
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      try { await p.page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; }
      catch (e) { /* 渲染中或取消，忽略 */ }
    }
    thumbIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) paint(en.target); });
    }, { root: el, rootMargin: '300px' });
    el.querySelectorAll('.thumb').forEach(function (t) { thumbIO.observe(t); });
    el.onclick = function (e) {
      var t = e.target.closest ? e.target.closest('.thumb[data-p]') : null;
      if (t) gotoPage(Number(t.getAttribute('data-p')));
    };
    return V.count;
  }
  function markThumb(n) {
    var el = document.getElementById('thumbList'); if (!el) return;
    el.querySelectorAll('.thumb').forEach(function (t) { t.classList.toggle('on', Number(t.getAttribute('data-p')) === n); });
  }

  /* ---------------- 全文查找 ---------------- */
  function paintSearch(p) {
    if (!p.search) return;
    p.search.innerHTML = '';
    if (!V.findQ || !p.rendered) return;
    var pr = p.el.getBoundingClientRect(), q = V.findQ.toLowerCase();
    Array.prototype.forEach.call(p.tl.querySelectorAll('span'), function (sp) {
      if (String(sp.textContent).toLowerCase().indexOf(q) < 0) return;
      var r = sp.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var m = document.createElement('div'); m.className = 'searchmark';
      m.style.left = (r.left - pr.left) + 'px'; m.style.top = (r.top - pr.top) + 'px';
      m.style.width = r.width + 'px'; m.style.height = r.height + 'px';
      p.search.appendChild(m);
    });
  }
  async function find(q) {
    var token = ++V.findToken;
    V.findQ = PS.strip(q);
    V.findHits = [];
    if (!V.findQ || !V.pdf) { V.pages.forEach(paintSearch); emit('Find', [], V.findQ); return []; }
    var target = V.findQ.toLowerCase();
    for (var i = 0; i < V.pages.length; i++) {
      if (token !== V.findToken) return V.findHits;
      var p = V.pages[i];
      if (!p.tc) { try { p.tc = await p.page.getTextContent(); } catch (e) { continue; } }
      p.text = (p.tc.items || []).map(function (x) { return x.str; }).join(' ');
      var low = p.text.toLowerCase(), from = 0, idx;
      while ((idx = low.indexOf(target, from)) >= 0 && V.findHits.length < 500) {
        V.findHits.push({
          page: p.num, index: idx,
          snippet: p.text.slice(Math.max(0, idx - 32), idx + target.length + 48)
        });
        from = idx + Math.max(1, target.length);
      }
      if (V.findHits.length >= 500) break;
    }
    if (token !== V.findToken) return V.findHits;
    V.pages.forEach(paintSearch);
    emit('Find', V.findHits.slice(), V.findQ);
    return V.findHits.slice();
  }
  function clearFind() { V.findToken++; V.findQ = ''; V.findHits = []; V.pages.forEach(paintSearch); emit('Find', [], ''); }
  function gotoHit(hit) {
    if (!hit) return;
    gotoPage(hit.page);
    setTimeout(function () { var p = V.pages[hit.page - 1]; if (p) { renderPage(p); paintSearch(p); } }, 220);
  }
  async function pageText(n) {
    var p = V.pages[(Number(n) || 1) - 1]; if (!p || !p.page) return '';
    if (!p.tc) p.tc = await p.page.getTextContent();
    p.text = (p.tc.items || []).map(function (x) { return x.str; }).join(' ');
    return p.text;
  }

  /* ---------------- SVG 图层（箭头 / 笔刷） ---------------- */
  function ensureSvg(p) {
    if (p.inkSvg && p.inkSvg.parentNode && p.tempSvg && p.tempSvg.parentNode) return;
    p.anno.querySelectorAll('svg').forEach(function (x) { x.remove(); });
    var W = p.vp ? p.vp.width : (p.el.clientWidth || 600);
    var H = p.vp ? p.vp.height : (p.el.clientHeight || 800);
    function mk(cls) {
      var s = svgEl('svg', {
        'class': cls, width: '100%', height: '100%',
        viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none'
      });
      s.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible;';
      return s;
    }
    p.inkSvg = mk('inkSvg');
    p.tempSvg = mk('tempSvg');
    p.tempSvg.style.zIndex = '10';
    p.anno.appendChild(p.inkSvg);
    p.anno.appendChild(p.tempSvg);
  }
  function arrowLine(x1, y1, x2, y2, col, lw) {
    var ang = Math.atan2(y2 - y1, x2 - x1), len = Math.max(9, lw * 3.4);
    var bx = x2 - len * 0.78 * Math.cos(ang), by = y2 - len * 0.78 * Math.sin(ang);
    return svgEl('line', {
      x1: x1, y1: y1, x2: bx, y2: by,
      stroke: col, 'stroke-width': lw, 'stroke-linecap': 'round'
    });
  }
  function arrowHead(x1, y1, x2, y2, col, lw) {
    var ang = Math.atan2(y2 - y1, x2 - x1), len = Math.max(9, lw * 3.4);
    var ax = x2 - len * Math.cos(ang - 0.42), ay = y2 - len * Math.sin(ang - 0.42);
    var bx = x2 - len * Math.cos(ang + 0.42), by = y2 - len * Math.sin(ang + 0.42);
    return svgEl('polygon', { points: x2 + ',' + y2 + ' ' + ax + ',' + ay + ' ' + bx + ',' + by, fill: col });
  }

  /* ---------------- 标注数据 ---------------- */
  function norm(a) {
    return {
      id: a.id || PS.uid('an'), type: a.type || 'highlight',
      page: clamp(Math.round(Number(a.page) || 1), 1, Math.max(1, V.count)),
      color: a.color || 'yellow',
      rects: (a.rects || []).map(function (r) {
        return { x: Number(r.x) || 0, y: Number(r.y) || 0, w: Number(r.w) || 0, h: Number(r.h) || 0 };
      }).filter(function (r) { return r.w > 0 && r.h > 0; }),
      x: Number(a.x) || 0, y: Number(a.y) || 0,
      x1: Number(a.x1) || 0, y1: Number(a.y1) || 0,
      x2: Number(a.x2) || 0, y2: Number(a.y2) || 0,
      points: (a.points || []).map(function (q) {
        return { x: Number(q.x) || 0, y: Number(q.y) || 0 };
      }),
      width: Number(a.width) || 2.6,
      text: String(a.text || ''), comment: String(a.comment || ''),
      createdAt: a.createdAt || PS.now()
    };
  }
  function setAnnotations(list) { V.annos = (list || []).map(norm); drawAnnos(); }
  function getAnnotations() { return V.annos.map(function (a) { return JSON.parse(JSON.stringify(a)); }); }
  function emitAnnos() { emit('Annos', getAnnotations()); }
  function addAnnotation(a) { var o = norm(a); V.annos.push(o); drawAnnos(); emitAnnos(); return o; }
  function removeAnnotation(id) { V.annos = V.annos.filter(function (a) { return a.id !== id; }); drawAnnos(); emitAnnos(); }
  function clearPage(n) {
    n = n || currentPage();
    var before = V.annos.length;
    V.annos = V.annos.filter(function (a) { return a.page !== n; });
    drawAnnos(); emitAnnos();
    return before - V.annos.length;
  }

  function drawAnnos() {
    V.pages.forEach(function (p) {
      p.anno.innerHTML = '';
      p.inkSvg = null; p.tempSvg = null;
      Array.prototype.forEach.call(p.hit.querySelectorAll('.pin'), function (x) { x.remove(); });
      ensureSvg(p);
    });
    V.annos.forEach(function (a) {
      var p = V.pages[a.page - 1]; if (!p) return;
      var col = hex(a.color);
      if (a.type === 'pin') {
        var pin = document.createElement('div');
        pin.className = 'pin'; pin.dataset.aid = a.id;
        pin.style.left = (a.x * 100) + '%'; pin.style.top = (a.y * 100) + '%';
        pin.style.background = col; pin.style.borderColor = 'rgba(0,0,0,.35)';
        pin.title = a.comment || a.text || '便签';
        pin.innerHTML = '<span>●</span>';
        pin.addEventListener('click', function (e) { e.stopPropagation(); emit('AnnoClick', a.id); });
        p.hit.appendChild(pin);
        return;
      }
      if (a.type === 'arrow' || a.type === 'ink') {
        var W = p.vp ? p.vp.width : 1, H = p.vp ? p.vp.height : 1;
        var lw = a.width || 2.6;
        if (a.type === 'arrow') {
          var x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
          var line = arrowLine(x1, y1, x2, y2, col, lw);
          var head = arrowHead(x1, y1, x2, y2, col, lw);
          line.dataset.aid = a.id; head.dataset.aid = a.id;
          p.inkSvg.appendChild(line); p.inkSvg.appendChild(head);
        } else {
          var pts = a.points.map(function (q) { return (q.x * W) + ',' + (q.y * H); }).join(' ');
          var pl = svgEl('polyline', {
            points: pts, fill: 'none', stroke: col, 'stroke-width': lw,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round'
          });
          pl.dataset.aid = a.id;
          p.inkSvg.appendChild(pl);
        }
        return;
      }
      a.rects.forEach(function (r) {
        var d = document.createElement('div');
        d.className = 'anno c-' + a.color; d.dataset.aid = a.id;
        if (a.type === 'highlight') { d.style.background = rgba(a.color, 0.5); d.style.mixBlendMode = 'multiply'; }
        else if (a.type === 'underline') { d.style.borderBottom = '2px solid ' + col; }
        else if (a.type === 'strike') {
          d.style.background = 'linear-gradient(to bottom,transparent 46%,' + col + ' 46%,' + col + ' 54%,transparent 54%)';
          d.style.mixBlendMode = 'multiply';
        } else {
          d.style.border = '2px solid ' + col; d.style.background = rgba(a.color, 0.10);
        }
        d.style.left = (r.x * 100) + '%'; d.style.top = (r.y * 100) + '%';
        d.style.width = (r.w * 100) + '%'; d.style.height = (r.h * 100) + '%';
        p.anno.insertBefore(d, p.inkSvg);
      });
    });
    emit('AnnoCount', V.annos.length);
  }
  function flash(id) {
    var els = document.querySelectorAll('[data-aid="' + id + '"]');
    Array.prototype.forEach.call(els, function (x) {
      x.classList.add('flash'); setTimeout(function () { x.classList.remove('flash'); }, 1300);
    });
    var a = V.annos.filter(function (x) { return x.id === id; })[0];
    if (a) gotoPage(a.page);
  }
  function segDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    var t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  function annoAt(pageNum, x, y) {
    for (var i = V.annos.length - 1; i >= 0; i--) {
      var a = V.annos[i]; if (a.page !== pageNum) continue;
      if (a.type === 'pin') {
        if (Math.abs(a.x - x) < 0.035 && Math.abs(a.y - y) < 0.045) return a;
      } else if (a.type === 'arrow') {
        if (segDist(x, y, a.x1, a.y1, a.x2, a.y2) < 0.020) return a;
      } else if (a.type === 'ink') {
        for (var j = 1; j < a.points.length; j++) {
          if (segDist(x, y, a.points[j - 1].x, a.points[j - 1].y, a.points[j].x, a.points[j].y) < 0.016) return a;
        }
      } else {
        for (var k = 0; k < a.rects.length; k++) {
          var r = a.rects[k];
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return a;
        }
      }
    }
    return null;
  }
  function setTool(tool, color) {
    V.tool = tool; V.color = color || V.color;
    var modes = {
      highlight: 'text', underline: 'text', strike: 'text', area: 'area',
      arrow: 'draw', ink: 'draw', pin: 'pin', browse: 'browse', erase: 'erase'
    };
    setMode(modes[tool] || 'text');
  }
  function setMode(m) {
    V.mode = m;
    V.pages.forEach(function (p) { p.el.className = 'pdfpage mode-' + m; });
  }
  function setPalette(colors, names) {
    if (colors && Object.keys(colors).length) V.palette = colors;
    V.colorNames = names || {};
    drawAnnos();
  }
  function setBrushWidth(w) { V.brushWidth = clamp(Number(w) || 3, 1, 12); }

  /* ---------------- 交互 ---------------- */
  function pageOf(node) {
    var el = node && node.closest ? node.closest('.pdfpage') : null;
    if (!el) return null;
    return V.pages[Number(el.dataset.page) - 1] || null;
  }
  function hitOf(node) { return node && node.closest ? node.closest('.hitLayer') : null; }
  function readerVisible() {
    var r = document.getElementById('readerView');
    return r && !r.hidden;
  }
  function relFromEvent(p, e) {
    var r = p.hit.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  }
  function tempRect(p, x0, y0, x1, y1, W, H) {
    var t = p.el.querySelector('.temp');
    if (x1 == null) { if (t) t.remove(); return; }
    if (!t) { t = document.createElement('div'); t.className = 'temp'; p.el.appendChild(t); }
    t.style.left = Math.min(x0, x1) * W + 'px';
    t.style.top = Math.min(y0, y1) * H + 'px';
    t.style.width = Math.abs(x1 - x0) * W + 'px';
    t.style.height = Math.abs(y1 - y0) * H + 'px';
  }
  // 箭头终点落在文字上时，自动把那段原文记进注释
  function textAtPoint(p, x, y) {
    if (!p.rendered) return '';
    var r = p.el.getBoundingClientRect();
    var cx = r.left + x * r.width, cy = r.top + y * r.height;
    var spans = p.tl.querySelectorAll('span'), best = '', bestD = 1e9;
    for (var i = 0; i < spans.length; i++) {
      var b = spans[i].getBoundingClientRect();
      if (!b.width) continue;
      var insideX = cx >= b.left && cx <= b.right;
      var dy = Math.max(b.top - cy, 0, cy - b.bottom);
      if (insideX && dy < 14 && dy < bestD) {
        var t = PS.strip(spans[i].textContent);
        if (t) { best = t; bestD = dy; }
      }
    }
    return best.slice(0, 300);
  }
  function clearPreview(p) {
    if (!p) return;
    if (p.tempSvg) p.tempSvg.innerHTML = '';
    var t = p.el.querySelector('.temp'); if (t) t.remove();
  }
  function drawPreview() {
    var d = V.drag; if (!d) return;
    var p = d.p; ensureSvg(p);
    p.tempSvg.innerHTML = '';
    var W = p.vp ? p.vp.width : 1, H = p.vp ? p.vp.height : 1;
    var col = hex(d.color), lw = d.width || 2.6;
    if (d.kind === 'area') {
      tempRect(p, d.x0, d.y0, d.x1, d.y1, W, H);
    } else if (d.tool === 'arrow') {
      var x1 = d.x0 * W, y1 = d.y0 * H, x2 = d.x1 * W, y2 = d.y1 * H;
      p.tempSvg.appendChild(arrowLine(x1, y1, x2, y2, col, lw));
      p.tempSvg.appendChild(arrowHead(x1, y1, x2, y2, col, lw));
    } else if (d.tool === 'ink') {
      var pts = d.points.map(function (q) { return (q.x * W) + ',' + (q.y * H); }).join(' ');
      p.tempSvg.appendChild(svgEl('polyline', {
        points: pts, fill: 'none', stroke: col, 'stroke-width': lw,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }));
    }
  }
  function onMouseDown(e) {
    if (!readerVisible()) return;
    if (V.mode !== 'area' && V.mode !== 'draw') return;
    var hit = hitOf(e.target), p = hit ? pageOf(hit) : null;
    if (!p) return;
    e.preventDefault();
    var r = p.hit.getBoundingClientRect();
    var x = clamp((e.clientX - r.left) / r.width, 0, 1);
    var y = clamp((e.clientY - r.top) / r.height, 0, 1);
    V.drag = {
      kind: V.mode, tool: V.tool, p: p, color: V.color, width: V.brushWidth,
      x0: x, y0: y, x1: x, y1: y, w: r.width, h: r.height, points: [{ x: x, y: y }]
    };
    drawPreview();
  }
  function onMouseMove(e) {
    var d = V.drag; if (!d) return;
    var r = d.p.hit.getBoundingClientRect();
    d.x1 = clamp((e.clientX - r.left) / r.width, 0, 1);
    d.y1 = clamp((e.clientY - r.top) / r.height, 0, 1);
    if (d.tool === 'ink') {
      var last = d.points[d.points.length - 1];
      var dist = Math.hypot((d.x1 - last.x) * r.width, (d.y1 - last.y) * r.height);
      if (dist >= 2.5) d.points.push({ x: d.x1, y: d.y1 });
    }
    drawPreview();
  }
  function onMouseUp(e) {
    if (V.drag) {
      var d = V.drag; V.drag = null;
      clearPreview(d.p);
      if (d.kind === 'area') {
        var x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
        var w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
        if (w > 0.008 && h > 0.006) {
          addAnnotation({ type: 'area', page: d.p.num, color: d.color, rects: [{ x: x, y: y, w: w, h: h }], text: '框选区域' });
        }
      } else if (d.tool === 'arrow') {
        if (Math.hypot((d.x1 - d.x0) * d.w, (d.y1 - d.y0) * d.h) > 8) {
          var target = textAtPoint(d.p, d.x1, d.y1);
          addAnnotation({
            type: 'arrow', page: d.p.num, color: d.color, width: d.width,
            x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1, text: target || ''
          });
          if (target) emit('Toast', '箭头已指向：' + target.slice(0, 24));
        }
      } else if (d.tool === 'ink' && d.points.length >= 2) {
        addAnnotation({ type: 'ink', page: d.p.num, color: d.color, width: d.width, points: d.points, text: '自由划线' });
      }
      return;
    }
    if (!readerVisible() || V.mode !== 'text') return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    var rects = Array.prototype.slice.call(range.getClientRects());
    var text = PS.strip(sel.toString());
    if (!text || !rects.length) return;
    var groups = {};
    rects.forEach(function (rc) {
      if (rc.width < 1 || rc.height < 1) return;
      var cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
      for (var i = 0; i < V.pages.length; i++) {
        var pr = V.pages[i].el.getBoundingClientRect();
        if (cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom) {
          (groups[V.pages[i].num] = groups[V.pages[i].num] || []).push({
            x: clamp((rc.left - pr.left) / pr.width, 0, 1),
            y: clamp((rc.top - pr.top) / pr.height, 0, 1),
            w: clamp(rc.width / pr.width, 0, 1), h: clamp(rc.height / pr.height, 0, 1)
          });
          break;
        }
      }
    });
    Object.keys(groups).forEach(function (num) {
      addAnnotation({ type: V.tool, page: Number(num), color: V.color, rects: groups[num], text: text });
    });
    try { sel.removeAllRanges(); } catch (err) {}
  }
  function onClick(e) {
    if (!readerVisible()) return;
    var pinEl = e.target.closest ? e.target.closest('.pin[data-aid]') : null;
    if (pinEl) return;
    if (V.mode !== 'pin' && V.mode !== 'erase') return;
    var hit = hitOf(e.target), p = hit ? pageOf(hit) : null;
    if (!p) return;
    var pt = relFromEvent(p, e);
    if (V.mode === 'erase') {
      var a = annoAt(p.num, pt.x, pt.y);
      if (a) { removeAnnotation(a.id); emit('Toast', '已擦除 1 条标注'); }
      return;
    }
    emit('Pin', { page: p.num, x: pt.x, y: pt.y, clientX: e.clientX, clientY: e.clientY });
  }

  function init(cfg) {
    V.viewer = cfg.viewer; V.container = cfg.container; V.hooks = cfg.hooks || {};
    V.viewer.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () {
      clearTimeout(V.scrollTimer);
      V.scrollTimer = setTimeout(function () { if (cfg.hooks && cfg.hooks.onFit) cfg.hooks.onFit(); renderVisible(); }, 200);
    });
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('click', onClick);
    V.drag = null;
    setTool('highlight', 'yellow');
  }

  window.PdfView = {
    init: init, open: open, close: close,
    setZoom: setZoom, getZoom: getZoom, zoomBy: zoomBy, fitWidth: fitWidth,
    gotoPage: gotoPage, currentPage: currentPage,
    renderOutline: renderOutline, renderThumbs: renderThumbs, markThumb: markThumb,
    find: find, clearFind: clearFind, gotoHit: gotoHit, pageText: pageText,
    setAnnotations: setAnnotations, getAnnotations: getAnnotations,
    addAnnotation: addAnnotation, removeAnnotation: removeAnnotation,
    clearPage: clearPage, flash: flash, drawAnnos: drawAnnos,
    setTool: setTool, setMode: setMode, setPalette: setPalette, setBrushWidth: setBrushWidth,
    colorHex: hex, textAtPoint: textAtPoint,
    getPageSizes: function () { return V.sizes.slice(); },
    getCount: function () { return V.count; },
    getScale: function () { return V.scale; },
    debug: function () { return { pages: V.count, scale: V.scale, mode: V.mode, annos: V.annos.length, rendered: V.pages.filter(function (p) { return p.rendered; }).length }; }
  };
})();
