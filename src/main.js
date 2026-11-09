// Shotglass main thread: physics, input, controls, exports, recipes.
// Rendering lives in a worker; this thread only moves springs and posts scenes.
import { RATIOS, MAX_TILT, clamp, cardSize, frameDims, exportDims, cardLayout, pointInQuad, quadToUv, chromeHeight } from './layout.js';
import { PRESETS, DEFAULT_LOOK, autoBackgrounds, bgParams, bgCss, encodeLook, decodeLook, findRecipe, lookToCss } from './looks.js';

/* global __WORKER_URL__, __ENGINE_URL__, __ORIGIN__ */
const ORIGIN = typeof __ORIGIN__ !== 'undefined' ? __ORIGIN__ : location.origin;
const WORKER_URL = typeof __WORKER_URL__ !== 'undefined' ? __WORKER_URL__ : null;
const ENGINE_URL = typeof __ENGINE_URL__ !== 'undefined' ? __ENGINE_URL__ : './engine.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Trusted Types: the only script URLs this page will ever load.
let tt = (s) => s;
if (window.trustedTypes && trustedTypes.createPolicy) {
  const allowed = new Set([WORKER_URL, '/sw.js'].filter(Boolean));
  const policy = trustedTypes.createPolicy('shotglass', {
    createScriptURL: (s) => {
      if (allowed.has(s)) return s;
      throw new TypeError('Blocked script URL');
    },
  });
  tt = (s) => policy.createScriptURL(s);
}

/* ---------------------------------------------------------------- springs */

class Spring {
  constructor(v, k, c, eps) {
    this.v = v;
    this.t = v;
    this.vel = 0;
    this.k = reduced ? k * 2.2 : k;
    this.c = reduced ? 2 * Math.sqrt(this.k) : c;
    this.eps = eps;
  }
  step(h) {
    const a = -this.k * (this.v - this.t) - this.c * this.vel;
    this.vel += a * h;
    this.v += this.vel * h;
  }
  settle() {
    if (Math.abs(this.v - this.t) < this.eps && Math.abs(this.vel) < this.eps * 8) {
      this.v = this.t;
      this.vel = 0;
      return true;
    }
    return false;
  }
  jump(v) {
    this.v = this.t = v;
    this.vel = 0;
  }
}

/* ---------------------------------------------------------------- state */

const hashCode = findRecipe(location.hash);
const shared = hashCode ? decodeLook(hashCode) : null;
const look = shared ? structuredClone(shared) : structuredClone(DEFAULT_LOOK);
let autoBgs = autoBackgrounds(null);
let currentSpec = look.bg || autoBgs[0];
let src = { w: 2400, h: 1500, dark: false, sample: true, name: 'demo' };
let userImage = false;
let interacted = false;

const S = {
  tx: new Spring(look.tilt[0], 170, 19, 0.01),
  ty: new Spring(look.tilt[1], 170, 19, 0.01),
  lift: new Spring(0, 260, 17, 0.001),
  lx: new Spring(look.light[0], 120, 21, 0.0005),
  ly: new Spring(look.light[1], 120, 21, 0.0005),
  W: new Spring(1920, 210, 27, 0.05),
  H: new Spring(1080, 210, 27, 0.05),
  size: new Spring(look.size, 240, 29, 0.0005),
  radius: new Spring(look.radius, 420, 40, 0.001),
  shadow: new Spring(look.shadow, 420, 40, 0.001),
  glare: new Spring(look.glare, 420, 40, 0.001),
  grain: new Spring(look.grain ? 1 : 0, 300, 34, 0.002),
  scaleIn: new Spring(1, 190, 15, 0.0005),
};
const springs = Object.values(S);

let bgFrom = bgParams(currentSpec);
let bgTo = bgFrom;
let bgT = 1;

const card = () => cardSize(src.w, src.h, look.frame);

function frameTarget() {
  const { cw, ch } = card();
  return frameDims(look.ratio, cw, ch, S.size.t);
}

{
  const f = frameTarget();
  S.W.jump(f.W);
  S.H.jump(f.H);
}

/* ---------------------------------------------------------------- dom */

const stage = $('#stage');
let canvas = $('#view');
const lightDot = $('#light');
const marquee = $('#marquee');
const toastEl = $('#toast');

let stageW = stage.clientWidth || 800;
let stageH = stage.clientHeight || 500;
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
let frameRect = { x: 0, y: 0, w: 1, h: 1 };

function computeFrameRect() {
  const m = Math.max(12, Math.min(36, Math.min(stageW, stageH) * 0.05));
  const A = S.W.v / S.H.v;
  let w = Math.max(10, stageW - m * 2);
  let h = w / A;
  if (h > stageH - m * 2) {
    h = Math.max(10, stageH - m * 2);
    w = h * A;
  }
  frameRect = { x: (stageW - w) / 2, y: (stageH - h) / 2, w, h };
}

new ResizeObserver(() => {
  stageW = stage.clientWidth;
  stageH = stage.clientHeight;
  kick();
}).observe(stage);

/* ---------------------------------------------------------------- engine bridge */

let engine = null;
const waiting = new Map();
let exportSeq = 0;

function onEngine(m) {
  switch (m.type) {
    case 'source':
      return onSource(m);
    case 'erased':
      $('#btn-undo').disabled = !m.undo;
      $('#btn-undo2').disabled = !m.undo;
      markDirty();
      kick();
      return;
    case 'exported': {
      const w = waiting.get(m.id);
      if (w) {
        waiting.delete(m.id);
        w.resolve(m);
      }
      return;
    }
    case 'nogl':
      stage.classList.add('nogl');
      $('#nogl').hidden = false;
      return;
    case 'error':
      for (const [id, w] of waiting) {
        w.reject(new Error(m.message));
        waiting.delete(id);
      }
      if (m.where !== 'export') toast('Something went sideways there. Try that again.');
      return;
  }
}

let transferred = false;
let fellBack = false;

function startEngine() {
  const chrome = { frame: look.frame, url: $('#url').value };
  if (WORKER_URL && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype) {
    try {
      const w = new Worker(tt(WORKER_URL));
      const fallback = () => {
        if (fellBack) return;
        fellBack = true;
        w.terminate();
        startLocal(chrome);
      };
      w.onmessage = (e) => (e.data.type === 'nogl' ? fallback() : onEngine(e.data));
      w.onerror = fallback;
      const off = canvas.transferControlToOffscreen();
      transferred = true;
      w.postMessage({ type: 'init', canvas: off, chrome }, [off]);
      engine = { post: (m, t) => w.postMessage(m, t || []) };
      return;
    } catch {
      // fall through to the main-thread engine
    }
  }
  startLocal(chrome);
}

async function startLocal(chrome) {
  engine = null;
  const { Engine } = await import(ENGINE_URL);
  if (transferred) {
    // a transferred canvas can't be drawn on from here; swap in an identical one
    const fresh = document.createElement('canvas');
    for (const a of ['id', 'class', 'role', 'aria-label', 'tabindex', 'aria-describedby']) if (canvas.hasAttribute(a)) fresh.setAttribute(a, canvas.getAttribute(a));
    canvas.replaceWith(fresh);
    canvas = fresh;
    bindCanvas();
  }
  const e = new Engine((m) => onEngine(m));
  engine = { post: (m) => e.handle(m) };
  e.handle({ type: 'init', canvas, chrome });
}

function onSource(m) {
  src = { w: m.w, h: m.h, dark: m.dark, sample: m.sample, name: src.name };
  autoBgs = autoBackgrounds(m.palette);
  paintAutoSwatches();
  if (currentSpec && currentSpec.auto) {
    const next = autoBgs.find((b) => b.id === look.bgId) || autoBgs[0];
    setBackdrop(next, !m.sample);
  }
  const f = frameTarget();
  S.W.t = f.W;
  S.H.t = f.H;
  if (m.sample && !ready) {
    S.W.jump(f.W);
    S.H.jump(f.H);
  }
  $('#btn-undo').disabled = true;
  $('#btn-undo2').disabled = true;
  if (!reduced) {
    S.scaleIn.v = m.sample && !ready ? 0.9 : 0.93;
    S.lift.v = 0.8;
  }
  ready = true;
  updateDims();
  markDirty();
  kick();
  if (pendingShared) {
    const go = pendingShared;
    pendingShared = null;
    go();
  }
}
let ready = false;

/* ---------------------------------------------------------------- loop */

let raf = 0;
let last = 0;
let dragging = null; // { kind: 'tilt'|'light'|'erase'|'pinch', ... }
let inertia = null;

function kick() {
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
}

function scene(final) {
  const { cw, ch } = card();
  const g = (s) => (final ? s.t : s.v);
  return {
    W: final ? frameTarget().W : S.W.v,
    H: final ? frameTarget().H : S.H.v,
    cw,
    ch,
    size: g(S.size),
    radius: g(S.radius),
    shadow: g(S.shadow),
    glare: g(S.glare),
    grain: g(S.grain),
    tiltX: g(S.tx),
    tiltY: g(S.ty),
    lift: final ? 0 : S.lift.v,
    scaleIn: final ? 1 : S.scaleIn.v,
    lightX: g(S.lx),
    lightY: g(S.ly),
    bgA: final ? bgTo : bgFrom,
    bgB: bgTo,
    bgMix: final ? 0 : ease(bgT),
  };
}

const ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));

function tick(now) {
  raf = 0;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  if (inertia) {
    inertia.vx *= Math.exp(-dt * 5);
    inertia.vy *= Math.exp(-dt * 5);
    S.tx.t = clamp(S.tx.t + inertia.vx * dt, -MAX_TILT, MAX_TILT);
    S.ty.t = clamp(S.ty.t + inertia.vy * dt, -MAX_TILT, MAX_TILT);
    if (Math.hypot(inertia.vx, inertia.vy) < 2) {
      inertia = null;
      commitTilt();
    }
  }
  if (look.ratio === 'auto' || dragging?.kind === 'pinch') {
    const f = frameTarget();
    S.W.t = f.W;
    S.H.t = f.H;
  }
  for (let i = 0; i < steps; i++) for (const s of springs) s.step(h);
  let busy = !!dragging || !!inertia;
  for (const s of springs) if (!s.settle()) busy = true;
  if (bgT < 1) {
    bgT = Math.min(1, bgT + dt / (reduced ? 0.12 : 0.34));
    busy = true;
    if (bgT >= 1) bgFrom = bgTo;
  }
  render();
  if (busy) raf = requestAnimationFrame(tick);
  else idle();
}

function render() {
  if (!engine || !ready) return;
  computeFrameRect();
  const d = dpr();
  const vp = {
    width: Math.max(1, Math.round(stageW * d)),
    height: Math.max(1, Math.round(stageH * d)),
    x: frameRect.x * d,
    y: frameRect.y * d,
    w: frameRect.w * d,
    h: frameRect.h * d,
  };
  engine.post({ type: 'frame', scene: scene(false), vp, opts: { checker: currentSpec && currentSpec.s === 'n', seed: 0 } });
  // light marker
  const lx = frameRect.x + S.lx.v * frameRect.w;
  const ly = frameRect.y + S.ly.v * frameRect.h;
  lightDot.style.transform = `translate(${lx}px, ${ly}px)`;
}

/* ---------------------------------------------------------------- pointer */

function framePoint(e) {
  const r = stage.getBoundingClientRect();
  return [((e.clientX - r.left - frameRect.x) * S.W.v) / frameRect.w, ((e.clientY - r.top - frameRect.y) * S.H.v) / frameRect.h];
}

function overCard(p) {
  return pointInQuad(p, cardLayout(scene(false)).screen);
}

const pointers = new Map();

function bindCanvas() {
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onHover);
  canvas.addEventListener('dblclick', onDouble);
  canvas.addEventListener('keydown', onCanvasKey);
}

function onHover(e) {
  if (dragging || e.pointerType === 'touch') return;
  const p = framePoint(e);
  stage.dataset.hover = eraseMode ? (overCard(p) ? 'erase' : 'none') : overCard(p) ? 'card' : 'bg';
}

function onDown(e) {
  if (e.button > 0) return;
  firstTouch();
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  canvas.setPointerCapture(e.pointerId);
  if (pointers.size === 2 && !eraseMode) {
    const [a, b] = [...pointers.values()];
    dragging = { kind: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, s0: S.size.t };
    S.lift.t = 0;
    hideLight();
    return;
  }
  if (pointers.size > 1) return;
  const p = framePoint(e);
  inertia = null;
  if (eraseMode) {
    if (!overCard(p)) return;
    const r = stage.getBoundingClientRect();
    dragging = { kind: 'erase', x0: e.clientX - r.left, y0: e.clientY - r.top, p0: p };
    drawMarquee(dragging.x0, dragging.y0, dragging.x0, dragging.y0);
    return;
  }
  if (overCard(p)) {
    const L = cardLayout(scene(false));
    const gain = clamp(68 / ((L.w * frameRect.w) / S.W.v), 0.05, 0.5);
    dragging = { kind: 'tilt', x: e.clientX, y: e.clientY, tx: S.tx.t, ty: S.ty.t, gain, hist: [[performance.now(), S.tx.t, S.ty.t]] };
    S.lift.t = 1;
    stage.classList.add('grabbing');
    hintDone('tilt');
  } else {
    dragging = { kind: 'light' };
    setLight(p);
    stage.classList.add('lighting');
    hintDone('light');
  }
  kick();
}

function rubber(v) {
  const a = Math.abs(v);
  if (a <= MAX_TILT) return v;
  return Math.sign(v) * (MAX_TILT + (a - MAX_TILT) * 0.22);
}

function setLight(p) {
  S.lx.t = clamp(p[0] / S.W.v, -0.15, 1.15);
  S.ly.t = clamp(p[1] / S.H.v, -0.15, 1.15);
}

window.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (!dragging) return;
  if (dragging.kind === 'pinch') {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    S.size.t = clamp(dragging.s0 * (d / dragging.d0), 0.3, 0.96);
    syncSlider('size');
  } else if (dragging.kind === 'tilt') {
    const tx = rubber(dragging.tx - (e.clientY - dragging.y) * dragging.gain);
    const ty = rubber(dragging.ty + (e.clientX - dragging.x) * dragging.gain);
    S.tx.t = tx;
    S.ty.t = ty;
    const now = performance.now();
    dragging.hist.push([now, tx, ty]);
    while (dragging.hist.length > 2 && now - dragging.hist[0][0] > 90) dragging.hist.shift();
  } else if (dragging.kind === 'light') {
    setLight(framePoint(e));
  } else if (dragging.kind === 'erase') {
    const r = stage.getBoundingClientRect();
    drawMarquee(dragging.x0, dragging.y0, e.clientX - r.left, e.clientY - r.top);
    dragging.p1 = framePoint(e);
  }
  kick();
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (!dragging) return;
  const d = dragging;
  if (d.kind === 'pinch') {
    if (pointers.size === 0) {
      dragging = null;
      updateDims();
      commitLook();
    }
    return;
  }
  dragging = null;
  stage.classList.remove('grabbing', 'lighting');
  if (d.kind === 'tilt') {
    S.lift.t = 0;
    S.tx.t = clamp(S.tx.t, -MAX_TILT, MAX_TILT);
    S.ty.t = clamp(S.ty.t, -MAX_TILT, MAX_TILT);
    const h = d.hist;
    const a = h[0], b = h[h.length - 1];
    const span = (b[0] - a[0]) / 1000;
    if (!reduced && span > 0.008 && performance.now() - b[0] < 60) {
      const vx = clamp((b[1] - a[1]) / span, -900, 900);
      const vy = clamp((b[2] - a[2]) / span, -900, 900);
      if (Math.hypot(vx, vy) > 25) inertia = { vx, vy };
    }
    if (!inertia) commitTilt();
  } else if (d.kind === 'light') {
    look.light = [S.lx.t, S.ly.t];
    commitLook();
    setTimeout(hideLight, 500);
  } else if (d.kind === 'erase') {
    marquee.hidden = true;
    if (d.p1) eraseBetween(d.p0, d.p1);
  }
  kick();
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);

function hideLight() {
  if (!dragging || dragging.kind !== 'light') stage.classList.remove('lighting');
}

function commitTilt() {
  look.tilt = [S.tx.t, S.ty.t];
  commitLook();
}

function onDouble(e) {
  const p = framePoint(e);
  if (eraseMode) return;
  if (overCard(p)) flatten();
  else {
    S.lx.t = DEFAULT_LOOK.light[0];
    S.ly.t = DEFAULT_LOOK.light[1];
    look.light = [...DEFAULT_LOOK.light];
    commitLook();
    kick();
  }
}

function flatten() {
  inertia = null;
  S.tx.t = 0;
  S.ty.t = 0;
  commitTilt();
  kick();
}

stage.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    S.size.t = clamp(S.size.t * Math.exp(-e.deltaY * 0.01), 0.3, 0.96);
    syncSlider('size');
    commitLookSoon();
    kick();
  },
  { passive: false }
);

function onCanvasKey(e) {
  const k = e.key;
  if (!k.startsWith('Arrow')) return;
  e.preventDefault();
  firstTouch();
  const step = e.altKey ? 0.5 : 3;
  if (e.shiftKey) {
    const dx = k === 'ArrowLeft' ? -0.04 : k === 'ArrowRight' ? 0.04 : 0;
    const dy = k === 'ArrowUp' ? -0.04 : k === 'ArrowDown' ? 0.04 : 0;
    S.lx.t = clamp(S.lx.t + dx, -0.15, 1.15);
    S.ly.t = clamp(S.ly.t + dy, -0.15, 1.15);
    look.light = [S.lx.t, S.ly.t];
  } else {
    if (k === 'ArrowLeft') S.ty.t = clamp(S.ty.t - step, -MAX_TILT, MAX_TILT);
    if (k === 'ArrowRight') S.ty.t = clamp(S.ty.t + step, -MAX_TILT, MAX_TILT);
    if (k === 'ArrowUp') S.tx.t = clamp(S.tx.t + step, -MAX_TILT, MAX_TILT);
    if (k === 'ArrowDown') S.tx.t = clamp(S.tx.t - step, -MAX_TILT, MAX_TILT);
    look.tilt = [S.tx.t, S.ty.t];
  }
  commitLookSoon();
  kick();
}

/* ---------------------------------------------------------------- erase */

let eraseMode = false;
let eraseStyle = 'blend';
let savedTilt = null;

function setErase(on) {
  if (on === eraseMode) return;
  eraseMode = on;
  stage.classList.toggle('erasing', on);
  $('#erasebar').hidden = !on;
  $('#btn-erase').setAttribute('aria-pressed', String(on));
  if (on) {
    inertia = null;
    savedTilt = [S.tx.t, S.ty.t];
    S.tx.t = 0;
    S.ty.t = 0;
    toast('Drag a box over anything you want gone.');
  } else if (savedTilt) {
    S.tx.t = savedTilt[0];
    S.ty.t = savedTilt[1];
    savedTilt = null;
    marquee.hidden = true;
  }
  kick();
}

function drawMarquee(x0, y0, x1, y1) {
  marquee.hidden = false;
  marquee.style.transform = `translate(${Math.min(x0, x1)}px, ${Math.min(y0, y1)}px)`;
  marquee.style.width = Math.abs(x1 - x0) + 'px';
  marquee.style.height = Math.abs(y1 - y0) + 'px';
}

function eraseBetween(p0, p1) {
  const L = cardLayout(scene(false));
  const { cw, ch } = card();
  const bar = chromeHeight(src.w, src.h, look.frame);
  const toImg = (p) => {
    const [u, v] = quadToUv(p, L.screen);
    return [clamp(u, 0, 1) * cw, clamp(v, 0, 1) * ch - bar];
  };
  const a = toImg(p0), b = toImg(p1);
  const x = Math.min(a[0], b[0]), y = Math.max(0, Math.min(a[1], b[1]));
  const w = Math.abs(b[0] - a[0]), h = Math.min(Math.max(a[1], b[1]), src.h) - y;
  if (w < 3 || h < 3) return;
  engine.post({ type: 'erase', rect: [x, y, w, h], mode: eraseStyle });
}

function undoErase() {
  engine.post({ type: 'undo' });
}

/* ---------------------------------------------------------------- backdrops */

function swatchButtons() {
  return $$('input[name="bg"]').filter((r) => !r.closest('[hidden]'));
}

function paintAutoSwatches() {
  autoBgs.forEach((b) => {
    const el = $(`#bg-${b.id}`);
    if (el) el.nextElementSibling.querySelector('.sw').style.background = bgCss(b);
  });
}

function specById(id) {
  if (id === 'shared' && look.bg) return look.bg;
  return autoBgs.find((b) => b.id === id) || PRESETS.find((b) => b.id === id) || null;
}

function setBackdrop(spec, animate = true) {
  currentSpec = spec;
  look.bgId = spec.id || 'custom';
  look.bg = spec.auto ? null : spec;
  const p = bgParams(spec);
  if (animate && !reduced) {
    bgFrom = bgT < 1 ? mixParams() : bgTo;
    bgTo = p;
    bgT = 0;
  } else {
    bgFrom = bgTo = p;
    bgT = 1;
  }
  const radio = $(`#bg-${spec.id}`);
  if (radio) radio.checked = true;
  else swatchButtons().forEach((r) => (r.checked = false));
  stage.classList.toggle('clear', spec.s === 'n');
  kick();
}

// When a crossfade is interrupted, start the next one from the frame on screen.
function mixParams() {
  return bgT < 0.5 ? bgFrom : bgTo;
}

function cycleBackdrop(dir) {
  const list = swatchButtons();
  let i = list.findIndex((r) => r.checked);
  i = (i + dir + list.length) % list.length;
  list[i].checked = true;
  list[i].dispatchEvent(new Event('change', { bubbles: true }));
}

/* ---------------------------------------------------------------- controls */

const sliders = {
  size: { el: $('#size'), spring: S.size, scale: 100 },
  radius: { el: $('#radius'), spring: S.radius, scale: 100 },
  shadow: { el: $('#shadow'), spring: S.shadow, scale: 100 },
  glare: { el: $('#glare'), spring: S.glare, scale: 100 },
};

function syncSlider(name) {
  const s = sliders[name];
  s.el.value = String(Math.round(s.spring.t * s.scale));
  outFor(s.el);
}

function outFor(el) {
  const o = $(`output[for="${el.id}"]`);
  if (o) o.textContent = el.value;
  const min = Number(el.min), max = Number(el.max);
  el.style.setProperty('--fill', (((Number(el.value) - min) / (max - min)) * 100).toFixed(1) + '%');
}

function syncControls() {
  const r = $(`input[name="ratio"][value="${look.ratio}"]`);
  if (r) r.checked = true;
  const f = $(`input[name="frame"][value="${look.frame}"]`);
  if (f) f.checked = true;
  $('#url').disabled = look.frame !== 'browser';
  $('#grain').checked = !!look.grain;
  for (const k of Object.keys(sliders)) syncSlider(k);
  const radio = $(`#bg-${currentSpec.id}`);
  if (radio) radio.checked = true;
  updateDims();
}

for (const [name, s] of Object.entries(sliders)) {
  s.el.addEventListener('input', () => {
    firstTouch();
    s.spring.t = Number(s.el.value) / s.scale;
    look[name] = s.spring.t;
    outFor(s.el);
    if (name === 'size') updateDims();
    commitLookSoon();
    kick();
  });
}

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement)) return;
  if (t.name === 'ratio') {
    firstTouch();
    look.ratio = t.value;
    const f = frameTarget();
    S.W.t = f.W;
    S.H.t = f.H;
    updateDims();
    commitLook();
    kick();
  } else if (t.name === 'bg') {
    firstTouch();
    const spec = specById(t.value);
    if (spec) {
      setBackdrop(spec);
      commitLook();
    }
  } else if (t.name === 'frame') {
    firstTouch();
    setFrame(t.value);
  } else if (t.id === 'grain') {
    look.grain = t.checked;
    S.grain.t = t.checked ? 1 : 0;
    commitLook();
    kick();
  } else if (t.name === 'scale') {
    updateDims();
    markDirty();
  } else if (t.name === 'erase-style') {
    eraseStyle = t.value;
  }
});

function setFrame(frame) {
  look.frame = frame;
  $('#url').disabled = frame !== 'browser';
  engine && engine.post({ type: 'chrome', frame, url: $('#url').value });
  const f = frameTarget();
  S.W.t = f.W;
  S.H.t = f.H;
  updateDims();
  commitLook();
  kick();
}

let urlTimer = 0;
$('#url').addEventListener('input', () => {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    engine && engine.post({ type: 'chrome', frame: look.frame, url: $('#url').value });
    markDirty();
    kick();
  }, 90);
});

$('#btn-flat').addEventListener('click', flatten);
$('#btn-erase').addEventListener('click', () => setErase(!eraseMode));
$('#btn-erase-done').addEventListener('click', () => setErase(false));
$('#btn-undo').addEventListener('click', undoErase);
$('#btn-undo2').addEventListener('click', undoErase);

/* ---------------------------------------------------------------- export */

const scaleNow = () => Number(($('input[name="scale"]:checked') || { value: 2 }).value);

function updateDims() {
  const f = frameTarget();
  const d = exportDims(f.W, f.H, scaleNow());
  $('#dims').textContent = `${d.w} × ${d.h}`;
}

let dirty = true;
let lastExport = null;
let prewarmTimer = 0;

function markDirty() {
  dirty = true;
  clearTimeout(prewarmTimer);
}

function idle() {
  clearTimeout(prewarmTimer);
  if (!interacted) return;
  prewarmTimer = setTimeout(() => {
    if (dirty && !dragging && document.visibilityState === 'visible') freshExport().catch(() => {});
  }, 1100);
}

function fileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const base = (src.name || 'shot').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'shot';
  return `${base}-shotglass-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
}

function exportNow() {
  if (!engine || !ready) return Promise.reject(new Error('not ready'));
  const id = ++exportSeq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    engine.post({ type: 'export', id, scene: scene(true), scale: scaleNow() });
  });
}

let inflight = null;
async function freshExport() {
  if (!dirty && lastExport) return lastExport;
  if (inflight) return inflight;
  dirty = false;
  inflight = exportNow()
    .then((m) => {
      if (lastExport) URL.revokeObjectURL(lastExport.url);
      lastExport = { blob: m.blob, url: URL.createObjectURL(m.blob), name: fileName(), w: m.w, h: m.h };
      const th = $('#thumb');
      th.src = lastExport.url;
      th.closest('.thumb').classList.add('on');
      return lastExport;
    })
    .catch((e) => {
      dirty = true;
      throw e;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function copyImage() {
  firstTouch();
  if (!navigator.clipboard || !window.ClipboardItem) {
    toast('This browser can’t copy images. Saving instead.');
    return saveImage();
  }
  const blobP = freshExport().then((r) => r.blob);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]);
    toast('Copied. Paste it anywhere.');
  } catch {
    try {
      const b = await blobP;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
      toast('Copied. Paste it anywhere.');
    } catch {
      toast('The clipboard said no. Use Save instead.');
    }
  }
}

async function saveImage() {
  firstTouch();
  try {
    const r = await freshExport();
    const a = document.createElement('a');
    a.href = r.url;
    a.download = r.name;
    document.body.append(a);
    a.click();
    a.remove();
    toast(`Saved ${r.w} × ${r.h} PNG.`);
  } catch {
    toast('That export failed. Try a smaller scale.');
  }
}

async function shareImage() {
  firstTouch();
  try {
    const r = await freshExport();
    const file = new File([r.blob], r.name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Made with Shotglass' });
    } else return saveImage();
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    saveImage();
  }
}

function lookLink() {
  return `${ORIGIN}/#look=${encodeLook(look, currentSpec)}`;
}

async function writeText(text, ok) {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    toast('Copy is blocked here. The link is in the address bar.');
  }
}

$('#btn-copy').addEventListener('click', copyImage);
$('#btn-save').addEventListener('click', saveImage);
$('#btn-share').addEventListener('click', shareImage);
$('#btn-link').addEventListener('click', () => writeText(lookLink(), 'Look link copied. Whoever opens it gets your exact look.'));
$('#btn-css').addEventListener('click', () => {
  const { cw, ch } = card();
  writeText(lookToCss(look, currentSpec, { aspect: cw / ch, link: lookLink() }), 'CSS copied. Same tilt, light and shadow on a real <img>.');
});

const thumb = $('#thumb');
thumb.addEventListener('dragstart', (e) => {
  if (!lastExport || dirty) {
    e.preventDefault();
    freshExport().catch(() => {});
    toast('Polishing the file. Drag again in a moment.');
    return;
  }
  dragOut = true;
  e.dataTransfer.effectAllowed = 'copy';
  try {
    e.dataTransfer.setData('DownloadURL', `image/png:${lastExport.name}:${lastExport.url}`);
  } catch {
    /* not every browser speaks DownloadURL */
  }
});
thumb.addEventListener('dragend', () => (dragOut = false));
let dragOut = false;

/* ---------------------------------------------------------------- input files */

async function decode(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function loadFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|avif|bmp|svg|heic)$/i.test(file.name || '')) {
    toast('That isn’t an image. Try a PNG, JPG or WebP.');
    return;
  }
  firstTouch();
  if (!engine || !ready) {
    pendingShared = () => loadFile(file);
    return;
  }
  let bmp;
  try {
    bmp = await decode(file);
  } catch {
    toast('Couldn’t read that image.');
    return;
  }
  const max = 8192, area = 40e6;
  const k = Math.min(1, max / bmp.width, max / bmp.height, Math.sqrt(area / (bmp.width * bmp.height)));
  if (k < 1) {
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    bmp = await createImageBitmap(c);
  }
  src.name = file.name || 'pasted';
  userImage = true;
  stage.classList.add('has-image');
  if (eraseMode) setErase(false);
  engine.post({ type: 'image', bitmap: bmp }, [bmp]);
}

document.addEventListener('paste', (e) => {
  const t = e.target;
  const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
  const img = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  if (img) {
    e.preventDefault();
    loadFile(img.getAsFile());
    return;
  }
  if (t instanceof HTMLInputElement && t.type === 'text') return;
  const text = e.clipboardData && e.clipboardData.getData('text');
  const code = findRecipe(text);
  if (code) {
    const l = decodeLook(code);
    if (l) {
      e.preventDefault();
      applyLook(l);
      toast('Wearing the pasted look.');
    }
  }
});

$('#btn-pick').addEventListener('click', () => $('#file').click());
$('#btn-pick-touch').addEventListener('click', () => $('#file').click());
$('#btn-replace').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  loadFile(f);
  e.target.value = '';
});
$('#btn-paste').addEventListener('click', async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (type) {
        const blob = await it.getType(type);
        return loadFile(new File([blob], 'pasted.' + type.split('/')[1], { type }));
      }
    }
    toast('No image on the clipboard yet.');
  } catch {
    toast('Paste is blocked here. Choose an image instead.');
  }
});

let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
window.addEventListener('dragenter', (e) => {
  if (dragOut || !hasFiles(e)) return;
  dragDepth++;
  stage.classList.add('dropping');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) stage.classList.remove('dropping');
});
window.addEventListener('dragover', (e) => {
  if (dragOut || !hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('drop', (e) => {
  dragDepth = 0;
  stage.classList.remove('dropping');
  if (dragOut || !hasFiles(e)) return;
  e.preventDefault();
  const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/')) || e.dataTransfer.files[0];
  loadFile(f);
});

/* ---------------------------------------------------------------- looks */

let hashTimer = 0;
function commitLook() {
  look.size = S.size.t;
  look.radius = S.radius.t;
  look.shadow = S.shadow.t;
  look.glare = S.glare.t;
  look.tilt = [S.tx.t, S.ty.t];
  look.light = [S.lx.t, S.ly.t];
  markDirty();
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    history.replaceState(null, '', '#look=' + encodeLook(look, currentSpec));
    describe();
  }, 220);
}
let lookTimer = 0;
function commitLookSoon() {
  clearTimeout(lookTimer);
  lookTimer = setTimeout(commitLook, 160);
}

function applyLook(l) {
  inertia = null;
  look.ratio = l.ratio;
  look.frame = l.frame;
  look.size = l.size;
  look.radius = l.radius;
  look.shadow = l.shadow;
  look.glare = l.glare;
  look.grain = l.grain;
  look.tilt = [...l.tilt];
  look.light = [...l.light];
  S.size.t = l.size;
  S.radius.t = l.radius;
  S.shadow.t = l.shadow;
  S.glare.t = l.glare;
  S.grain.t = l.grain ? 1 : 0;
  S.tx.t = l.tilt[0];
  S.ty.t = l.tilt[1];
  S.lx.t = l.light[0];
  S.ly.t = l.light[1];
  if (l.bg) setBackdrop(l.bg);
  else setBackdrop(autoBgs.find((b) => b.id === l.bgId) || autoBgs[0]);
  engine && engine.post({ type: 'chrome', frame: l.frame, url: $('#url').value });
  const f = frameTarget();
  S.W.t = f.W;
  S.H.t = f.H;
  syncControls();
  commitLook();
  kick();
}

// Starred looks: the only thing Shotglass remembers, and only when asked.
const STORE = 'shotglass:looks';
function readSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.code === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}
function writeSaved(list) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function renderSaved() {
  const box = $('#saved');
  const list = readSaved();
  box.replaceChildren();
  if (!list.length) {
    const p = document.createElement('span');
    p.className = 'saved-empty';
    p.textContent = 'Star a look to keep it on this device.';
    box.append(p);
    return;
  }
  for (const item of list) {
    const l = decodeLook(item.code);
    if (!l) continue;
    const wrap = document.createElement('span');
    wrap.className = 'saved-chip';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'saved-apply';
    b.title = 'Wear this look';
    b.setAttribute('aria-label', `Wear saved look ${item.name}`);
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = l.bg ? bgCss(l.bg) : bgCss(autoBgs.find((x) => x.id === l.bgId) || autoBgs[0]);
    b.append(sw);
    b.addEventListener('click', () => {
      applyLook(l);
      toast(`Wearing “${item.name}”.`);
    });
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'saved-del';
    x.textContent = '×';
    x.setAttribute('aria-label', `Forget saved look ${item.name}`);
    x.addEventListener('click', () => {
      writeSaved(readSaved().filter((s) => s.id !== item.id));
      renderSaved();
    });
    wrap.append(b, x);
    box.append(wrap);
  }
}

$('#btn-star').addEventListener('click', () => {
  firstTouch();
  const list = readSaved();
  const code = encodeLook(look, currentSpec);
  if (list.some((s) => s.code === code)) {
    toast('That look is already starred.');
    return;
  }
  const name = `${currentSpec.name || 'Look'} ${RATIOS[look.ratio].label}`;
  list.unshift({ id: Date.now().toString(36), code, name });
  if (writeSaved(list.slice(0, 24))) {
    renderSaved();
    toast('Starred. It stays on this device until you forget it.');
  } else toast('This browser won’t let Shotglass remember anything. That’s fine too.');
});

$('#btn-forget').addEventListener('click', () => {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* nothing stored */
  }
  renderSaved();
  toast('Forgotten. Shotglass now remembers nothing.');
});

/* ---------------------------------------------------------------- keyboard */

const typing = (t) => t instanceof HTMLElement && (t.isContentEditable || (t instanceof HTMLInputElement && !['radio', 'checkbox', 'range', 'button'].includes(t.type)) || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement);

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (eraseMode) setErase(false);
    return;
  }
  if (typing(e.target)) return;
  if (mod && k === 'c' && !e.shiftKey) {
    const sel = window.getSelection();
    if (sel && String(sel).length) return;
    e.preventDefault();
    copyImage();
  } else if (mod && k === 's') {
    e.preventDefault();
    saveImage();
  } else if (mod && k === 'z') {
    e.preventDefault();
    undoErase();
  } else if (mod || e.altKey) {
    return;
  } else if (k === 'b') cycleBackdrop(e.shiftKey ? -1 : 1);
  else if (k === 'f') cycleRadio('frame');
  else if (k === 'r') cycleRadio('ratio');
  else if (k === 'e') setErase(!eraseMode);
  else if (k === 'g') {
    const g = $('#grain');
    g.checked = !g.checked;
    g.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (k === '0') flatten();
  else if (k === 'l') writeText(lookLink(), 'Look link copied.');
  else if (k === '=' || k === '+' || k === '-') {
    S.size.t = clamp(S.size.t + (k === '-' ? -0.03 : 0.03), 0.3, 0.96);
    syncSlider('size');
    updateDims();
    commitLookSoon();
    kick();
  } else if (k === '?') openKeys();
});

function cycleRadio(name) {
  firstTouch();
  const list = $$(`input[name="${name}"]`);
  let i = list.findIndex((r) => r.checked);
  i = (i + 1) % list.length;
  list[i].checked = true;
  list[i].dispatchEvent(new Event('change', { bubbles: true }));
}

const keysDlg = $('#keys');
function openKeys() {
  if (keysDlg.open) return;
  keysDlg.showModal();
}
$('#btn-keys').addEventListener('click', openKeys);
$('#btn-keys-close').addEventListener('click', () => keysDlg.close());
keysDlg.addEventListener('click', (e) => {
  if (e.target === keysDlg) keysDlg.close();
});

/* ---------------------------------------------------------------- feedback */

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600);
}

function hintDone(which) {
  const el = $(`#hint-${which}`);
  if (el) el.classList.add('done');
}

function firstTouch() {
  if (interacted) return;
  interacted = true;
  stage.classList.add('touched');
}

function describe() {
  const t = (v, a, b) => (Math.abs(v) < 1 ? '' : `${Math.round(Math.abs(v))}° ${v > 0 ? a : b}`);
  const tilt = [t(look.tilt[1], 'right', 'left'), t(look.tilt[0], 'back', 'forward')].filter(Boolean).join(' and ');
  const frame = { none: 'no frame', mac: 'a window frame', browser: 'a browser frame' }[look.frame];
  canvas.setAttribute(
    'aria-label',
    `Preview: ${userImage ? 'your screenshot' : 'a demo dashboard'} on the ${currentSpec.name || 'custom'} backdrop, ${RATIOS[look.ratio].label}, with ${frame}${tilt ? `, tilted ${tilt}` : ', flat'}.`
  );
}

/* ---------------------------------------------------------------- share target */

// Installed as an app, Shotglass appears in the phone's share sheet. The service worker
// parks the shared image in a local cache; we pick it up here and forget it at once.
async function receiveShared() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return;
  history.replaceState(null, '', '/' + location.hash);
  try {
    const cache = await caches.open('sg-share');
    const res = await cache.match('/__shared');
    if (!res) return;
    await cache.delete('/__shared');
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('x-name') || 'shared');
    const go = () => loadFile(new File([blob], name, { type: blob.type || 'image/png' }));
    if (ready) go();
    else pendingShared = go;
  } catch {
    /* nothing was shared */
  }
}
let pendingShared = null;

/* ---------------------------------------------------------------- agents (WebMCP) */

// When the browser exposes navigator.modelContext, AI agents can drive Shotglass
// through the same paths a person's hands use: the look, the eraser, the export.
function registerAgentTools() {
  const mc = navigator.modelContext || document.modelContext;
  if (!mc) return;
  const text = (t) => ({ content: [{ type: 'text', text: t }] });
  const pct = (d) => ({ type: 'number', minimum: 0, maximum: 100, description: d });
  const backdrops = [...autoBgs.map((b) => b.id), ...PRESETS.map((b) => b.id)];
  const num = (v, lo, hi) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? undefined : clamp(Number(v), lo, hi));
  const tools = [
    {
      name: 'shotglass_apply_look',
      description:
        'Style the screenshot on the Shotglass stage. Every field is optional and omitted fields keep their current value. Returns a link that carries the look.',
      inputSchema: {
        type: 'object',
        properties: {
          ratio: { type: 'string', enum: Object.keys(RATIOS), description: 'Canvas: auto fits the shot, 169 is 16:9, og is 1200×630, 11 is 1:1, 45 is 4:5, 916 is 9:16, 43 is 4:3.' },
          backdrop: { type: 'string', enum: backdrops, description: 'auto-* backdrops are cut from the screenshot’s own colors; clear is transparent.' },
          frame: { type: 'string', enum: ['none', 'mac', 'browser'], description: 'No frame, a window frame, or a browser frame with an address bar.' },
          address: { type: 'string', description: 'Text shown in the browser frame’s address bar.' },
          size: { type: 'number', minimum: 30, maximum: 96, description: 'Percent of the canvas the screenshot fills.' },
          corners: pct('Corner rounding.'),
          shadow: pct('Shadow depth and darkness.'),
          glare: pct('Strength of the glass glare.'),
          grain: { type: 'boolean', description: 'Film grain on the backdrop.' },
          tiltX: { type: 'number', minimum: -MAX_TILT, maximum: MAX_TILT, description: 'Degrees. Positive leans the top edge away.' },
          tiltY: { type: 'number', minimum: -MAX_TILT, maximum: MAX_TILT, description: 'Degrees. Positive turns the screenshot to face right.' },
          lightX: pct('Light position across the canvas, 0 is the left edge.'),
          lightY: pct('Light position down the canvas, 0 is the top edge.'),
        },
        additionalProperties: false,
      },
      async execute(a = {}) {
        const l = { ...look, tilt: [...look.tilt], light: [...look.light] };
        if (a.ratio && RATIOS[a.ratio]) l.ratio = a.ratio;
        if (a.frame && ['none', 'mac', 'browser'].includes(a.frame)) l.frame = a.frame;
        if (typeof a.address === 'string') $('#url').value = a.address.slice(0, 80);
        const v = (k, lo, hi) => num(a[k], lo, hi);
        if (v('size', 30, 96) !== undefined) l.size = v('size', 30, 96) / 100;
        if (v('corners', 0, 100) !== undefined) l.radius = v('corners', 0, 100) / 100;
        if (v('shadow', 0, 100) !== undefined) l.shadow = v('shadow', 0, 100) / 100;
        if (v('glare', 0, 100) !== undefined) l.glare = v('glare', 0, 100) / 100;
        if (typeof a.grain === 'boolean') l.grain = a.grain;
        if (v('tiltX', -MAX_TILT, MAX_TILT) !== undefined) l.tilt[0] = v('tiltX', -MAX_TILT, MAX_TILT);
        if (v('tiltY', -MAX_TILT, MAX_TILT) !== undefined) l.tilt[1] = v('tiltY', -MAX_TILT, MAX_TILT);
        if (v('lightX', 0, 100) !== undefined) l.light[0] = v('lightX', 0, 100) / 100;
        if (v('lightY', 0, 100) !== undefined) l.light[1] = v('lightY', 0, 100) / 100;
        const spec = a.backdrop ? specById(a.backdrop) : currentSpec;
        l.bg = spec && !spec.auto ? spec : null;
        l.bgId = spec ? spec.id : look.bgId;
        applyLook(l);
        return text(`Applied. Look link: ${lookLink()}`);
      },
    },
    {
      name: 'shotglass_get_look',
      description: 'Describe the current look, the screenshot size in pixels (for erasing), the export size, and the shareable look link.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        return text(
          JSON.stringify({
            link: lookLink(),
            image: { source: userImage ? 'user screenshot' : 'demo dashboard', width: src.w, height: src.h },
            export: $('#dims').textContent,
            look: { ratio: look.ratio, backdrop: currentSpec.id, frame: look.frame, size: Math.round(look.size * 100), corners: Math.round(look.radius * 100), shadow: Math.round(look.shadow * 100), glare: Math.round(look.glare * 100), grain: look.grain, tiltX: look.tilt[0], tiltY: look.tilt[1], lightX: Math.round(look.light[0] * 100), lightY: Math.round(look.light[1] * 100) },
          })
        );
      },
    },
    {
      name: 'shotglass_erase_region',
      description:
        'Permanently hide a rectangle of the current screenshot, such as an API key, email or name. Coordinates are screenshot pixels from its top-left corner. blend fills from the surrounding pixels; bar draws a solid redaction bar.',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', minimum: 0 },
          y: { type: 'number', minimum: 0 },
          width: { type: 'number', minimum: 2 },
          height: { type: 'number', minimum: 2 },
          mode: { type: 'string', enum: ['blend', 'bar'] },
        },
        required: ['x', 'y', 'width', 'height'],
        additionalProperties: false,
      },
      async execute(a) {
        const r = [num(a.x, 0, src.w), num(a.y, 0, src.h), num(a.width, 2, src.w), num(a.height, 2, src.h)];
        if (r.some((x) => x === undefined)) return text('Give x, y, width and height in screenshot pixels.');
        engine.post({ type: 'erase', rect: r, mode: a.mode === 'bar' ? 'bar' : 'blend' });
        return text(`Erased ${Math.round(r[2])}×${Math.round(r[3])} px at ${Math.round(r[0])},${Math.round(r[1])}.`);
      },
    },
    {
      name: 'shotglass_export_image',
      description: 'Save the finished PNG to the user’s device at 1×, 2× or 3×.',
      inputSchema: { type: 'object', properties: { scale: { type: 'number', enum: [1, 2, 3] } }, additionalProperties: false },
      async execute(a = {}) {
        if ([1, 2, 3].includes(Number(a.scale))) {
          $(`#sc${Number(a.scale)}`).checked = true;
          updateDims();
          markDirty();
        }
        await saveImage();
        return text(`Saved a ${$('#dims').textContent} PNG.`);
      },
    },
  ];
  try {
    if (typeof mc.registerTool === 'function') for (const t of tools) mc.registerTool(t);
    else if (typeof mc.provideContext === 'function') mc.provideContext({ tools });
  } catch {
    /* agent surface is optional */
  }
}

/* ---------------------------------------------------------------- boot */

function boot() {
  for (const b of $$('[data-mod]')) b.title = b.dataset.mod.replace('MOD', isMac ? '⌘' : 'Ctrl+');
  setBackdrop(currentSpec, false);
  syncControls();
  renderSaved();
  bindCanvas();
  describe();
  startEngine();
  registerAgentTools();
  receiveShared();
  if (shared) {
    stage.classList.add('shared');
    setTimeout(() => toast('A look was shared with you. Paste your screenshot to wear it.'), 600);
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const reg = () => navigator.serviceWorker.register(tt('/sw.js')).catch(() => {});
    if (document.readyState === 'complete') setTimeout(reg, 2500);
    else addEventListener('load', () => setTimeout(reg, 2500));
  }
}

boot();
