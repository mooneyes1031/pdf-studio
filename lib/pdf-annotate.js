'use strict';

// 把前端的比例坐标标注写成真实的 PDF 注释对象（/Annots）
// 前端坐标：0..1，相对页面显示区域，y 向下；PDF 坐标原点在左下。
const { PDFDocument, PDFName, PDFString, PDFHexString } = require('pdf-lib');

// 单一颜色数据源：前端色板通过 app:palette 读取这里，加颜色只改这一处
const COLORS = {
  yellow: [1.00, 0.83, 0.20],
  orange: [1.00, 0.60, 0.20],
  red:    [0.94, 0.27, 0.27],
  pink:   [1.00, 0.55, 0.75],
  purple: [0.66, 0.45, 0.95],
  blue:   [0.30, 0.62, 1.00],
  cyan:   [0.25, 0.82, 0.87],
  green:  [0.40, 0.85, 0.50],
  gray:   [0.55, 0.60, 0.66],
  dark:   [0.16, 0.19, 0.23]
};
const COLOR_NAMES = {
  yellow: '黄', orange: '橙', red: '红', pink: '粉', purple: '紫',
  blue: '蓝', cyan: '青', green: '绿', gray: '灰', dark: '墨'
};
const NAMES = {
  highlight: 'Highlight', underline: 'Underline', strike: 'StrikeOut',
  area: 'Square', pin: 'Text', arrow: 'Line', ink: 'Ink'
};
const cl = v => Math.max(0, Math.min(1, Number(v) || 0));

function pdfDate(d) {
  const p = n => String(n).padStart(2, '0');
  return 'D:' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}

/**
 * @param {Uint8Array|Buffer} srcBytes 原始 PDF 字节
 * @param {Array} annotations 标注数组
 *   { id, type, page(1-based), color, rects:[{x,y,w,h}], x, y, text, comment }
 * @param {Array} pageSizes [{width,height}] PDF 点数，索引 0 = 第 1 页
 * @returns {Promise<Uint8Array>} 带注释的新 PDF
 */
async function writeAnnotations(srcBytes, annotations, pageSizes) {
  const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const now = pdfDate(new Date());
  const pages = doc.getPageCount();
  let written = 0;

  const byPage = {};
  (annotations || []).forEach(a => {
    const p = Math.max(1, Math.min(pages, Number(a.page) || 1));
    (byPage[p] = byPage[p] || []).push(a);
  });

  Object.keys(byPage).forEach(pNumStr => {
    const pNum = Number(pNumStr);
    const page = doc.getPage(pNum - 1);
    const size = (pageSizes && pageSizes[pNum - 1]) || page.getSize();
    const W = Number(size.width) || 595, H = Number(size.height) || 842;

    function addDict(dict) {
      const ref = doc.context.register(doc.context.obj(dict));
      let arr = page.node.Annots();
      if (!arr) { arr = doc.context.obj([]); page.node.set(PDFName.of('Annots'), arr); }
      arr.push(ref);
      written++;
    }
    const quadsOf = rects => {
      const q = [];
      (rects || []).forEach(r => {
        const x1 = Math.max(0, r.x) * W;
        const x2 = Math.min(1, r.x + r.w) * W;
        const yTop = Math.max(0, r.y) * H;
        const yBot = Math.min(1, r.y + r.h) * H;
        const y1 = H - yBot, y2 = H - yTop;   // PDF: y1 下, y2 上
        if (x2 > x1 && y2 > y1) q.push([x1, y2, x2, y2, x1, y1, x2, y1], { x1, y1, x2, y2 });
      });
      const points = q.filter(x => Array.isArray(x)).flat();
      const boxes = q.filter(x => !Array.isArray(x));
      return { points, boxes };
    };
    const rectOf = boxes => boxes.length ? [
      Math.min.apply(null, boxes.map(b => b.x1)), Math.min.apply(null, boxes.map(b => b.y1)),
      Math.max.apply(null, boxes.map(b => b.x2)), Math.max.apply(null, boxes.map(b => b.y2))
    ] : [0, 0, 0, 0];

    byPage[pNum].forEach(a => {
      const type = NAMES[a.type] || 'Highlight';
      const C = COLORS[a.color] || COLORS.yellow;
      const contents = String(a.comment || a.text || '').slice(0, 1000);
      const common = {
        Type: PDFName.of('Annot'),
        P: page.ref,
        F: 4,                                   // Print
        T: PDFString.of('PDF Studio'),
        NM: PDFString.of(String(a.id || ('ps-' + written))),
        M: PDFString.of(now),
        CreationDate: PDFString.of(now),
        C: C,
        CA: a.type === 'area' ? 1 : 0.45,
        Contents: PDFHexString.fromText(contents || ' ')
      };

      if (type === 'Text') {
        const px = cl(a.x) * W;
        const py = H - cl(a.y) * H;
        addDict(Object.assign({}, common, {
          Subtype: PDFName.of('Text'),
          Rect: [px, py - 20, px + 20, py],
          Name: PDFName.of('Note'),
          Open: false,
          CA: 1
        }));
        return;
      }

      // 箭头：/Line + 终点 ClosedArrow 线端
      if (type === 'Line') {
        const x1 = cl(a.x1) * W, x2 = cl(a.x2) * W;
        const y1 = H - cl(a.y1) * H, y2 = H - cl(a.y2) * H;
        const lw = Math.max(1, Number(a.width) || 2.5);
        const pad = lw + 8;
        addDict(Object.assign({}, common, {
          Subtype: PDFName.of('Line'),
          Rect: [Math.min(x1, x2) - pad, Math.min(y1, y2) - pad,
            Math.max(x1, x2) + pad, Math.max(y1, y2) + pad],
          L: [x1, y1, x2, y2],
          LE: [PDFName.of('None'), PDFName.of('ClosedArrow')],
          IC: C,
          BS: doc.context.obj({ W: lw, S: PDFName.of('S') }),
          CA: 1
        }));
        return;
      }

      // 自由笔刷：/Ink + InkList（一笔一条路径）
      if (type === 'Ink') {
        const pts = [];
        (a.points || []).forEach(pt => {
          if (!pt) return;
          const x = cl(pt.x) * W, y = H - cl(pt.y) * H;
          if (Number.isFinite(x) && Number.isFinite(y)) pts.push(x, y);
        });
        if (pts.length < 4) return;
        const xs = [], ys = [];
        for (let i = 0; i < pts.length; i += 2) { xs.push(pts[i]); ys.push(pts[i + 1]); }
        const lw = Math.max(1, Number(a.width) || 2.6);
        const pad = lw + 2;
        addDict(Object.assign({}, common, {
          Subtype: PDFName.of('Ink'),
          Rect: [Math.min.apply(null, xs) - pad, Math.min.apply(null, ys) - pad,
            Math.max.apply(null, xs) + pad, Math.max.apply(null, ys) + pad],
          InkList: [pts],
          BS: doc.context.obj({ W: lw, S: PDFName.of('S') }),
          CA: 1
        }));
        return;
      }

      const { points, boxes } = quadsOf(a.rects || []);
      if (!points.length) return;
      const Rect = rectOf(boxes);
      if (Rect[2] <= Rect[0] || Rect[3] <= Rect[1]) return;

      if (type === 'Square') {
        addDict(Object.assign({}, common, {
          Subtype: PDFName.of('Square'), Rect: Rect,
          IC: C,
          BS: doc.context.obj({ W: 2, S: PDFName.of('S') }),
          CA: 1
        }));
        return;
      }
      if (type === 'Underline' || type === 'StrikeOut') {
        // 线型注释的 QuadPoints：把文字矩形压成一条细线
        const line = [];
        boxes.forEach(b => {
          const y = type === 'Underline' ? b.y1 : (b.y1 + b.y2) / 2;
          const t = Math.max(0.6, (b.y2 - b.y1) * 0.06);
          line.push(b.x1, y + t, b.x2, y + t, b.x1, y - t, b.x2, y - t);
        });
        addDict(Object.assign({}, common, {
          Subtype: PDFName.of(type), Rect: Rect, QuadPoints: line, CA: 1
        }));
        return;
      }
      addDict(Object.assign({}, common, {
        Subtype: PDFName.of('Highlight'), Rect: Rect, QuadPoints: points
      }));
    });
  });

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes: bytes, count: written };
}

module.exports = { writeAnnotations, COLORS, COLOR_NAMES, NAMES };
