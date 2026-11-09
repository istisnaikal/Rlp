// The engine owns the pixels: source image, eraser, card bitmap, palette, exports.
// It runs inside a worker (OffscreenCanvas) or, as a fallback, on the main thread.
import { GLView } from './gl.js';
import { chromeHeight, cardLayout, exportDims } from './layout.js';
import { extractPalette, luminance } from './color.js';
import { paintSample } from './sample.js';

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function toBlob(c) {
  if (c.convertToBlob) return c.convertToBlob({ type: 'image/png' });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/png'));
}

/** High-quality downscale by halving steps, then a final 'high' resample. */
function resample(src, w, h) {
  let cur = src, cw = src.width, ch = src.height;
  while (cw / 2 >= w * 1.05 && ch / 2 >= h * 1.05) {
    const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
    const t = makeCanvas(nw, nh);
    const x = t.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, nw, nh);
    cur = t;
    cw = nw;
    ch = nh;
  }
  return { cur, cw, ch };
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawChrome(ctx, w, h, frame, dark, url) {
  ctx.fillStyle = dark ? '#1d1d22' : '#f3f2f5';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
  ctx.fillRect(0, h - Math.max(1, h * 0.02), w, Math.max(1, h * 0.02));
  const r = h * (frame === 'browser' ? 0.105 : 0.14);
  const gap = r * 3.3;
  const x0 = h * (frame === 'browser' ? 0.42 : 0.56);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    ctx.beginPath();
    ctx.arc(x0 + i * gap, h / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });
  if (frame !== 'browser') return;
  const ph = h * 0.56;
  const pw = Math.min(w * 0.56, Math.max(h * 7, w - x0 * 2 - gap * 6));
  const px = (w - pw) / 2;
  rr(ctx, px, (h - ph) / 2, pw, ph, ph / 2);
  ctx.fillStyle = dark ? '#2b2b31' : '#ffffff';
  ctx.fill();
  if (!dark) {
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = Math.max(1, h * 0.012);
    ctx.stroke();
  }
  const fs = h * 0.27;
  ctx.font = `500 ${fs}px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const label = (url || '').trim() || 'your-site.com';
  let text = label;
  const maxW = pw - ph * 1.6;
  while (ctx.measureText(text).width > maxW && text.length > 3) text = text.slice(0, -2);
  if (text !== label) text = text.slice(0, -1) + '…';
  const tw = ctx.measureText(text).width;
  const lockW = fs * 0.8;
  const tx = w / 2 - (tw + lockW + fs * 0.4) / 2;
  // padlock
  const lx = tx, ly = h / 2;
  ctx.strokeStyle = dark ? '#9b9aa6' : '#7b7a86';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(1, fs * 0.12);
  ctx.beginPath();
  ctx.arc(lx + lockW / 2, ly - fs * 0.12, lockW * 0.26, Math.PI, 0);
  ctx.stroke();
  rr(ctx, lx + lockW * 0.14, ly - fs * 0.1, lockW * 0.72, fs * 0.5, fs * 0.08);
  ctx.fill();
  ctx.fillStyle = dark ? '#d6d5de' : '#3c3b46';
  ctx.fillText(text, tx + lockW + fs * 0.4, h / 2 + fs * 0.04);
}

export class Engine {
  constructor(emit) {
    this.emit = emit;
    this.view = null;
    this.src = null;
    this.srcVersion = 0;
    this.undo = [];
    this.chrome = { frame: 'browser', url: '' };
    this.dark = false;
    this.scene = null;
    this.vp = null;
    this.opts = {};
    this.cardQ = 0;
    this.exportView = null;
  }

  handle(m) {
    try {
      switch (m.type) {
        case 'init':
          return this.init(m);
        case 'image':
          return this.setImage(m.bitmap, false);
        case 'chrome':
          this.chrome = { frame: m.frame, url: m.url };
          this.cardQ = 0;
          return this.draw();
        case 'frame':
          this.scene = m.scene;
          this.vp = m.vp;
          this.opts = m.opts || {};
          return this.draw();
        case 'erase':
          return this.erase(m.rect, m.mode);
        case 'undo':
          return this.undoErase();
        case 'export':
          return this.exportImage(m);
      }
    } catch (err) {
      this.emit({ type: 'error', where: m.type, message: String((err && err.message) || err) });
    }
  }

  init(m) {
    try {
      this.view = new GLView(m.canvas);
    } catch (e) {
      this.emit({ type: 'nogl' });
      return;
    }
    const lost = (e) => {
      e.preventDefault();
    };
    const restored = () => {
      this.view.init();
      this.cardQ = 0;
      this.draw();
    };
    if (m.canvas.addEventListener) {
      m.canvas.addEventListener('webglcontextlost', lost);
      m.canvas.addEventListener('webglcontextrestored', restored);
    }
    if (m.chrome) this.chrome = m.chrome;
    const c = makeCanvas(2400, 1500);
    paintSample(c, 2);
    this.setImage(c, true);
  }

  setImage(source, sample) {
    const w = source.width, h = source.height;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    if (source.close) source.close();
    this.src = c;
    this.srcCtx = ctx;
    this.srcVersion++;
    this.undo = [];
    this.cardQ = 0;
    // read top band for bar theme, and a thumbnail for the palette
    const band = ctx.getImageData(0, 0, w, Math.max(1, Math.round(h * 0.06))).data;
    let lum = 0, cnt = 0;
    for (let i = 0; i < band.length; i += 16) {
      lum += luminance([band[i], band[i + 1], band[i + 2]]);
      cnt++;
    }
    this.dark = cnt ? lum / cnt < 0.3 : false;
    const t = makeCanvas(56, Math.max(1, Math.round((56 * h) / w)));
    const tx = t.getContext('2d', { willReadFrequently: true });
    tx.drawImage(c, 0, 0, t.width, t.height);
    const palette = extractPalette(tx.getImageData(0, 0, t.width, t.height).data);
    this.emit({ type: 'source', w, h, dark: this.dark, palette, sample: !!sample, undo: 0 });
    this.draw();
  }

  /** Build the card bitmap (bar + screenshot) at quality q into a canvas. */
  buildCard(q) {
    const w = this.src.width, h = this.src.height;
    const bar = chromeHeight(w, h, this.chrome.frame);
    const cw = Math.max(1, Math.round(w * q));
    const barQ = Math.round(bar * q);
    const ch = Math.max(1, Math.round(h * q) + barQ);
    const c = makeCanvas(cw, ch);
    const ctx = c.getContext('2d');
    if (barQ) drawChrome(ctx, cw, barQ, this.chrome.frame, this.dark, this.chrome.url);
    const { cur } = q < 0.98 ? resample(this.src, cw, Math.round(h * q)) : { cur: this.src };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, barQ, cw, ch - barQ);
    return c;
  }

  ensureCard(view, s, vp) {
    const L = cardLayout(s);
    const devW = (L.w * vp.w) / s.W; // card width on screen in device pixels
    let q = Math.min(1, (devW * 1.12) / this.src.width);
    const chrome = 1 + chromeHeight(this.src.width, this.src.height, this.chrome.frame) / this.src.height;
    q = Math.min(q, view.maxTex / this.src.width, view.maxTex / (this.src.height * chrome));
    q = Math.max(q, 0.02);
    const key = this.srcVersion + '|' + this.chrome.frame + '|' + this.chrome.url + '|' + this.dark;
    const stale = view.texKey !== key;
    const ratio = view === this.view && this.cardQ ? q / this.cardQ : 0;
    if (stale || !this.cardQ || ratio > 1.3 || ratio < 0.6 || view !== this.view) {
      view.upload(this.buildCard(q), key);
      if (view === this.view) this.cardQ = q;
    }
  }

  draw() {
    if (!this.view || !this.scene || !this.vp || !this.src) return;
    this.ensureCard(this.view, this.scene, this.vp);
    this.view.draw(this.scene, this.vp, this.opts);
  }

  erase(rect, mode) {
    if (!this.src) return;
    const W = this.src.width, H = this.src.height;
    let [x, y, w, h] = rect.map(Math.round);
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(W - x, w);
    h = Math.min(H - y, h);
    if (w < 2 || h < 2) return;
    const ctx = this.srcCtx;
    const before = ctx.getImageData(x, y, w, h);
    this.undo.push({ x, y, img: before });
    if (this.undo.length > 40) this.undo.shift();
    if (mode === 'bar') {
      ctx.fillStyle = '#0c0c0f';
      ctx.fillRect(x, y, w, h);
    } else {
      smartFill(ctx, x, y, w, h, W, H);
    }
    this.srcVersion++;
    this.emit({ type: 'erased', undo: this.undo.length });
    this.draw();
  }

  undoErase() {
    const u = this.undo.pop();
    if (!u) return;
    this.srcCtx.putImageData(u.img, u.x, u.y);
    this.srcVersion++;
    this.emit({ type: 'erased', undo: this.undo.length });
    this.draw();
  }

  async exportImage(m) {
    if (!this.src) return;
    const s = m.scene;
    const { w, h } = exportDims(s.W, s.H, m.scale);
    if (!this.exportView) this.exportView = new GLView(makeCanvas(w, h), { preserve: true });
    const v = this.exportView;
    const vp = { width: w, height: h, x: 0, y: 0, w, h };
    this.ensureCard(v, s, vp);
    v.draw(s, vp, { checker: false, seed: 0 });
    const blob = await toBlob(v.canvas);
    this.emit({ type: 'exported', id: m.id, blob, w, h });
  }
}

/**
 * Make a region vanish into its surroundings. Flat surroundings get their median color;
 * varied ones get a smooth blend of the four borders, so gradients stay gradients.
 */
function smartFill(ctx, x, y, w, h, W, H) {
  const t = Math.max(2, Math.min(6, Math.round(Math.min(w, h) * 0.12)));
  const x0 = Math.max(0, x - t), y0 = Math.max(0, y - t);
  const x1 = Math.min(W, x + w + t), y1 = Math.min(H, y + h + t);
  const RW = x1 - x0, RH = y1 - y0;
  const data = ctx.getImageData(x0, y0, RW, RH).data;
  const at = (px, py) => {
    const i = ((py - y0) * RW + (px - x0)) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const ring = [];
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if (px >= x && px < x + w && py >= y && py < y + h) continue;
      ring.push(at(px, py));
    }
  }
  const med = (arr) => {
    if (!arr.length) return null;
    const out = [0, 1, 2, 3].map((k) => {
      const v = arr.map((p) => p[k]).sort((a, b) => a - b);
      return v[v.length >> 1];
    });
    return out;
  };
  const m = med(ring) || [128, 128, 128, 255];
  let dev = 0;
  for (const p of ring) dev += Math.abs(p[0] - m[0]) + Math.abs(p[1] - m[1]) + Math.abs(p[2] - m[2]);
  dev /= ring.length || 1;
  const out = ctx.createImageData(w, h);
  const o = out.data;
  if (dev < 10) {
    for (let i = 0; i < o.length; i += 4) {
      o[i] = m[0];
      o[i + 1] = m[1];
      o[i + 2] = m[2];
      o[i + 3] = m[3];
    }
  } else {
    // per-row left/right and per-column top/bottom medians over a sliding window
    const side = (fixed, from, to, vertical, k) => {
      const v = [];
      for (let a = Math.max(from, k - 3); a <= Math.min(to, k + 3); a++) {
        for (const f of fixed) {
          const px = vertical ? f : a, py = vertical ? a : f;
          if (px >= x0 && px < x1 && py >= y0 && py < y1 && (px < x || px >= x + w || py < y || py >= y + h)) v.push(at(px, py));
        }
      }
      return med(v);
    };
    const leftX = [], rightX = [], topY = [], botY = [];
    for (let i = 1; i <= t; i++) {
      if (x - i >= 0) leftX.push(x - i);
      if (x + w - 1 + i < W) rightX.push(x + w - 1 + i);
      if (y - i >= 0) topY.push(y - i);
      if (y + h - 1 + i < H) botY.push(y + h - 1 + i);
    }
    // A side that disagrees with the surroundings (it touches another element) is ignored,
    // so a box beside a button never smears the button's color across the fill.
    const whole = (fixed, from, to, vertical) => {
      const v = [];
      for (let a = from; a <= to; a++) for (const f of fixed) v.push(at(vertical ? f : a, vertical ? a : f));
      return med(v);
    };
    const near = (p) => p && Math.abs(p[0] - m[0]) + Math.abs(p[1] - m[1]) + Math.abs(p[2] - m[2]) < 54;
    const useL = leftX.length && near(whole(leftX, y, y + h - 1, true));
    const useR = rightX.length && near(whole(rightX, y, y + h - 1, true));
    const useT = topY.length && near(whole(topY, x, x + w - 1, false));
    const useB = botY.length && near(whole(botY, x, x + w - 1, false));
    const L = [], R = [], T = [], B = [];
    for (let r = 0; r < h; r++) {
      L.push(useL ? side(leftX, y, y + h - 1, true, y + r) : null);
      R.push(useR ? side(rightX, y, y + h - 1, true, y + r) : null);
    }
    for (let c = 0; c < w; c++) {
      T.push(useT ? side(topY, x, x + w - 1, false, x + c) : null);
      B.push(useB ? side(botY, x, x + w - 1, false, x + c) : null);
    }
    for (let r = 0; r < h; r++) {
      const v = (r + 0.5) / h;
      for (let c = 0; c < w; c++) {
        const u = (c + 0.5) / w;
        const acc = [0, 0, 0, 0];
        let wt = 0;
        const add = (p, k) => {
          if (!p) return;
          for (let j = 0; j < 4; j++) acc[j] += p[j] * k;
          wt += k;
        };
        add(L[r], 1 - u);
        add(R[r], u);
        add(T[c], 1 - v);
        add(B[c], v);
        const i = (r * w + c) * 4;
        if (!wt) {
          o[i] = m[0];
          o[i + 1] = m[1];
          o[i + 2] = m[2];
          o[i + 3] = m[3];
        } else {
          o[i] = acc[0] / wt;
          o[i + 1] = acc[1] / wt;
          o[i + 2] = acc[2] / wt;
          o[i + 3] = acc[3] / wt;
        }
      }
    }
  }
  ctx.putImageData(out, x, y);
}
