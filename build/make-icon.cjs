/* 生成 PDF Studio 品牌图标：build/icon.ico（多尺寸 32bpp DIB）+ build/icon.png（预览）
 * 方案 A「取景框」：深墨蓝圆角底 + 白色四角取景框 + 琥珀高亮条 + 石板灰文字线。
 * 纯几何、纯 Node、无第三方依赖，4x4 超采样抗锯齿。小尺寸自动加粗，16px 仍可辨。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = __dirname;
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const INK = [15, 23, 42];        // #0F172A 品牌深墨蓝
const WHITE = [255, 255, 255];
const AMBER = [251, 191, 36];    // #FBBF24 品牌琥珀
const SLATE = [71, 85, 105];     // #475569

/* 四角取景框的 8 条短线段（归一化 0..1） */
const SEGS = [
  [0.2125, 0.3625, 0.2125, 0.2125], [0.2125, 0.2125, 0.3625, 0.2125],
  [0.6375, 0.2125, 0.7875, 0.2125], [0.7875, 0.2125, 0.7875, 0.3625],
  [0.7875, 0.6375, 0.7875, 0.7875], [0.7875, 0.7875, 0.6375, 0.7875],
  [0.3625, 0.7875, 0.2125, 0.7875], [0.2125, 0.7875, 0.2125, 0.6375]
];

function rr(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, 0), w), cy = Math.min(Math.max(y, 0), h);
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const dx = Math.max(r - x, 0, x - (w - r));
  const dy = Math.max(r - y, 0, y - (h - r));
  return dx * dx + dy * dy <= r * r;
}
function inRoundRect(px, py, x, y, w, h, r) {
  return px >= x && px <= x + w && py >= y && py <= y + h &&
    rr(px - x, py - y, w, h, Math.min(r, w / 2, h / 2));
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function blend(dst, src, a) {
  if (a <= 0) return dst;
  const na = a + dst[3] * (1 - a);
  if (na <= 0) return [0, 0, 0, 0];
  return [
    (src[0] * a + dst[0] * dst[3] * (1 - a)) / na,
    (src[1] * a + dst[1] * dst[3] * (1 - a)) / na,
    (src[2] * a + dst[2] * dst[3] * (1 - a)) / na,
    na
  ];
}

function paint(x, y, S) {
  const small = S <= 32;
  let c = [0, 0, 0, 0];

  // 圆角底 + 一圈极细亮边（深色任务栏上不至于糊成一团）
  if (!inRoundRect(x, y, 0, 0, 1, 1, 0.225)) return c;
  c = blend(c, INK, 1);
  if (!inRoundRect(x, y, 0.012, 0.012, 0.976, 0.976, 0.213)) c = blend(c, WHITE, 0.10);

  // 白色四角取景框：圆头由「到线段距离」天然实现
  const half = small ? 0.042 : 0.028;
  for (let i = 0; i < SEGS.length; i++) {
    const s = SEGS[i];
    if (segDist(x, y, s[0], s[1], s[2], s[3]) <= half) { c = blend(c, WHITE, 1); break; }
  }

  // 琥珀色高亮条（品牌主记忆点）
  const hx = small ? 0.26 : 0.2875, hw = small ? 0.48 : 0.425;
  const hy = small ? 0.44 : 0.45, hh = small ? 0.12 : 0.0875;
  if (inRoundRect(x, y, hx, hy, hw, hh, hh / 2)) c = blend(c, AMBER, 1);

  // 下方文字线，小尺寸省略以免糊
  if (!small && inRoundRect(x, y, 0.2875, 0.60, 0.275, 0.04375, 0.021875)) c = blend(c, SLATE, 1);
  return c;
}

function render(S) {
  const buf = Buffer.alloc(S * S * 4);
  const N = 4;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = (i + (sx + 0.5) / N) / S;
          const y = (j + (sy + 0.5) / N) / S;
          const c = paint(x, y, S);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const k = N * N, o = (j * S + i) * 4;
      if (a > 0) {
        buf[o] = Math.round(r / a); buf[o + 1] = Math.round(g / a);
        buf[o + 2] = Math.round(b / a); buf[o + 3] = Math.round(255 * a / k);
      }
    }
  }
  return buf;
}

/* ---------- PNG ---------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(S, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let j = 0; j < S; j++) {
    raw[j * (S * 4 + 1)] = 0;
    rgba.copy(raw, j * (S * 4 + 1) + 1, j * S * 4, (j + 1) * S * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- ICO（32bpp DIB + AND mask，自下而上 BGRA） ---------- */
function dib(S, rgba) {
  const xor = Buffer.alloc(S * S * 4);
  for (let j = 0; j < S; j++) {
    const src = (S - 1 - j) * S * 4;
    for (let i = 0; i < S; i++) {
      const o = (j * S + i) * 4, s = src + i * 4;
      xor[o] = rgba[s + 2]; xor[o + 1] = rgba[s + 1]; xor[o + 2] = rgba[s]; xor[o + 3] = rgba[s + 3];
    }
  }
  const maskRow = Math.ceil(S / 32) * 4;
  const and = Buffer.alloc(maskRow * S);
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(S, 4); head.writeInt32LE(S * 2, 8);
  head.writeUInt16LE(1, 12); head.writeUInt16LE(32, 14);
  head.writeUInt32LE(0, 16); head.writeUInt32LE(xor.length + and.length, 20);
  return Buffer.concat([head, xor, and]);
}
function ico(images) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(images.length, 4);
  const entries = [], datas = [];
  let off = 6 + images.length * 16;
  images.forEach(function (im) {
    const e = Buffer.alloc(16);
    e[0] = im.S >= 256 ? 0 : im.S; e[1] = im.S >= 256 ? 0 : im.S;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(im.dib.length, 8); e.writeUInt32LE(off, 12);
    off += im.dib.length;
    entries.push(e); datas.push(im.dib);
  });
  return Buffer.concat([dir].concat(entries, datas));
}

const images = SIZES.map(S => ({ S: S, rgba: render(S), dib: null }));
images.forEach(im => { im.dib = dib(im.S, im.rgba); });
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(images));
fs.writeFileSync(path.join(OUT, 'icon.png'), png(256, images[images.length - 1].rgba));
console.log('已生成 build/icon.ico（' + SIZES.join('/') + '，' +
  fs.statSync(path.join(OUT, 'icon.ico')).size + ' 字节）与 build/icon.png');
