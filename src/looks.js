// Backdrops, recipes and CSS. One backdrop spec drives the WebGL shader, the swatch,
// the recipe link and the exported CSS, so all four always agree.
import { hexToRgb, oklch } from './color.js';
import { RATIOS, FRAMES, MAX_TILT, clamp } from './layout.js';

// spec: { s: 'm' mesh | 'g' glow | 'l' linear | 's' solid | 'n' none, c: ['#hex', ...] }
export const PRESETS = [
  { id: 'ember', name: 'Ember', s: 'm', c: ['#170503', '#ff4d1a', '#ffb02e', '#c2103b', '#ff7b29'] },
  { id: 'aurora', name: 'Aurora', s: 'm', c: ['#070a1f', '#5146f0', '#12b5a3', '#a24cf5'] },
  { id: 'lagoon', name: 'Lagoon', s: 'm', c: ['#031e2b', '#0ea2b8', '#2fd39a', '#2361e8'] },
  { id: 'peach', name: 'Peach', s: 'm', c: ['#ffe4d4', '#ff9f82', '#ffd27a', '#ff8fbb'] },
  { id: 'lilac', name: 'Lilac', s: 'm', c: ['#eee6ff', '#b8a1ff', '#ffb9e5', '#a6d7ff'] },
  { id: 'citrus', name: 'Citrus', s: 'm', c: ['#fff5c9', '#ffd23f', '#ff8c42', '#b5ee6a'] },
  { id: 'noir', name: 'Noir', s: 'g', c: ['#0a0a0d', '#34343f'] },
  { id: 'paper', name: 'Paper', s: 's', c: ['#f2efe9'] },
  { id: 'clear', name: 'Clear', s: 'n', c: [] },
];

const MESH = [
  [0.06, 0.08, 0.78, 0.9],
  [0.96, 0.16, 0.72, 0.84],
  [0.86, 0.98, 0.8, 0.86],
  [0.1, 0.96, 0.66, 0.78],
];

const FALLBACK_HUES = [{ h: 28 }, { h: 300 }, { h: 205 }];

/** Four backdrops cut from the screenshot's own colors. */
export function autoBackgrounds(pal) {
  const hs = (pal && pal.hues && pal.hues.length ? pal.hues : FALLBACK_HUES).map((p) => p.h);
  while (hs.length < 3) hs.push((hs[hs.length - 1] + (hs.length === 1 ? 140 : 95)) % 360);
  const [a, b, c] = hs;
  return [
    { id: 'auto-aura', name: 'Aura', auto: true, s: 'm', c: [oklch(0.17, 0.045, a), oklch(0.6, 0.19, a), oklch(0.66, 0.17, b), oklch(0.5, 0.17, c)] },
    { id: 'auto-mist', name: 'Mist', auto: true, s: 'm', c: [oklch(0.955, 0.025, a), oklch(0.86, 0.09, a), oklch(0.88, 0.08, b), oklch(0.84, 0.09, c)] },
    { id: 'auto-glow', name: 'Glow', auto: true, s: 'g', c: [oklch(0.13, 0.025, a), oklch(0.55, 0.2, a)] },
    { id: 'auto-duo', name: 'Duo', auto: true, s: 'l', c: [oklch(0.7, 0.16, a), oklch(0.5, 0.2, b)] },
  ];
}

/** Uniform-ready description of a backdrop for the shader. */
export function bgParams(spec) {
  const out = { alpha: 1, angle: 135, stops: [], blobs: [] };
  if (!spec || spec.s === 'n') {
    out.alpha = 0;
    out.stops = [[0, 0, 0]];
    return out;
  }
  const rgb = spec.c.map(hexToRgb).map((v) => v.map((x) => x / 255));
  if (spec.s === 's') out.stops = [rgb[0]];
  else if (spec.s === 'l') out.stops = rgb.slice(0, 3);
  else if (spec.s === 'g') {
    out.stops = [rgb[0]];
    out.blobs = [{ x: 0.5, y: 0.56, rx: 0.66, ry: 0.78, rgb: rgb[1] }];
    if (rgb[2]) out.blobs.push({ x: 0.5, y: 0.0, rx: 0.9, ry: 0.5, rgb: rgb[2] });
  } else {
    out.stops = [rgb[0]];
    out.blobs = rgb.slice(1, 5).map((col, i) => ({ x: MESH[i][0], y: MESH[i][1], rx: MESH[i][2], ry: MESH[i][3], rgb: col }));
  }
  return out;
}

const pct = (v) => +(v * 100).toFixed(1) + '%';
const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${+a.toFixed(4)})`;
};
const blob = (x, y, rx, ry, hex) =>
  `radial-gradient(${pct(rx)} ${pct(ry)} at ${pct(x)} ${pct(y)}, ${rgba(hex, 1)}, ${rgba(hex, 0.5625)} 25%, ${rgba(hex, 0.25)} 50%, ${rgba(hex, 0.0625)} 75%, ${rgba(hex, 0)})`;

/** The same backdrop as a CSS background value (what the swatches wear, what Copy CSS gives). */
export function bgCss(spec) {
  if (!spec || spec.s === 'n') return 'transparent';
  const c = spec.c;
  if (spec.s === 's') return c[0];
  if (spec.s === 'l') return `linear-gradient(135deg, ${c.slice(0, 3).join(', ')})`;
  if (spec.s === 'g') {
    const layers = [];
    if (c[2]) layers.push(blob(0.5, 0, 0.9, 0.5, c[2]));
    layers.push(blob(0.5, 0.56, 0.66, 0.78, c[1]));
    return layers.join(', ') + ', ' + c[0];
  }
  const layers = c
    .slice(1, 5)
    .map((hex, i) => blob(MESH[i][0], MESH[i][1], MESH[i][2], MESH[i][3], hex))
    .reverse();
  return layers.join(', ') + ', ' + c[0];
}

export const DEFAULT_LOOK = {
  ratio: '169',
  bg: null, // null → first backdrop cut from the shot
  bgId: 'auto-aura',
  frame: 'browser',
  size: 0.74,
  radius: 0.45,
  shadow: 0.62,
  glare: 0.5,
  grain: false,
  tilt: [9, -15],
  light: [0.22, 0.14],
};

const FRAME_CODE = { none: 'n', mac: 'w', browser: 'b' };
const CODE_FRAME = { n: 'none', w: 'mac', b: 'browser' };

/** A look as a short, URL-safe recipe: v1.r169.bm-170503-ff4d1a.fb.s74.c45.d62.g50.n0.t9_-15.l22_14 */
export function encodeLook(look, spec) {
  const t = [
    'v1',
    'r' + look.ratio,
    'b' + (spec ? spec.s + (spec.c.length ? '-' + spec.c.map((h) => h.replace('#', '')).join('-') : '') : 'n'),
    'f' + FRAME_CODE[look.frame],
    's' + Math.round(look.size * 100),
    'c' + Math.round(look.radius * 100),
    'd' + Math.round(look.shadow * 100),
    'g' + Math.round(look.glare * 100),
    'n' + (look.grain ? 1 : 0),
    't' + Math.round(look.tilt[0]) + '_' + Math.round(look.tilt[1]),
    'l' + Math.round(look.light[0] * 100) + '_' + Math.round(look.light[1] * 100),
  ];
  return t.join('.');
}

const num = (v, lo, hi, d) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : d;
};

/** Parse a recipe. Unknown or broken parts fall back to defaults; nothing throws. */
export function decodeLook(code) {
  if (!code || typeof code !== 'string') return null;
  const look = { ...DEFAULT_LOOK, tilt: [...DEFAULT_LOOK.tilt], light: [...DEFAULT_LOOK.light] };
  let spec = null;
  let ok = false;
  for (const tok of code.split('.')) {
    const k = tok[0];
    const v = tok.slice(1);
    if (k === 'v') ok = true;
    else if (k === 'r' && RATIOS[v]) look.ratio = v;
    else if (k === 'b') {
      const [s, ...cols] = v.split('-');
      const good = cols.filter((c) => /^[0-9a-f]{6}$/i.test(c)).slice(0, 5).map((c) => '#' + c.toLowerCase());
      if (s === 'n') spec = { s: 'n', c: [] };
      else if ('mgls'.includes(s) && s.length === 1 && good.length >= (s === 's' ? 1 : 2)) spec = { s, c: good };
    } else if (k === 'f' && CODE_FRAME[v]) look.frame = CODE_FRAME[v];
    else if (k === 's') look.size = num(v, 30, 96, 74) / 100;
    else if (k === 'c') look.radius = num(v, 0, 100, 45) / 100;
    else if (k === 'd') look.shadow = num(v, 0, 100, 62) / 100;
    else if (k === 'g') look.glare = num(v, 0, 100, 50) / 100;
    else if (k === 'n') look.grain = v === '1';
    else if (k === 't') {
      const [x, y] = v.split('_');
      look.tilt = [num(x, -MAX_TILT, MAX_TILT, 0), num(y, -MAX_TILT, MAX_TILT, 0)];
    } else if (k === 'l') {
      const [x, y] = v.split('_');
      look.light = [num(x, -20, 120, 22) / 100, num(y, -20, 120, 14) / 100];
    }
  }
  if (!ok) return null;
  if (spec) {
    look.bg = { id: 'shared', name: 'Shared look', ...spec };
    look.bgId = 'shared';
  }
  return look;
}

/** Find a recipe inside any text (a full link, a hash, or the bare code). */
export function findRecipe(text) {
  const m = /(?:#|[?&])look=([A-Za-z0-9._-]+)/.exec(text || '') || /^(v1\.[A-Za-z0-9._-]+)$/.exec((text || '').trim());
  return m ? m[1] : null;
}

/** The look as CSS for a real <img> on a real page. */
export function lookToCss(look, spec, info) {
  const r = RATIOS[look.ratio];
  const [tx, ty] = look.tilt.map((v) => Math.round(v * 10) / 10);
  const radiusPx = Math.round(1000 * 0.075 * look.radius * Math.min(1, info.aspect < 1 ? 1 : 1 / info.aspect) * 10) / 10;
  const s = look.shadow;
  const lx = look.light[0] - 0.5;
  const ly = look.light[1] - 0.5;
  const len = Math.hypot(lx, ly) || 1;
  const dist = (8 + 34 * s) * Math.min(1, len * 1.6 + 0.35);
  const ox = Math.round((-lx / len) * dist * 0.9);
  const oy = Math.round((-ly / len) * dist * 0.9 + 6 + 10 * s);
  const blur = Math.round(24 + 70 * s);
  const keyA = (0.18 + 0.4 * s).toFixed(2);
  const ambA = (0.12 + 0.2 * s).toFixed(2);
  const pad = Math.round(((1 - look.size) / 2) * 1000) / 10;
  const lines = [
    `/* Shotglass look. Wear it again: ${info.link} */`,
    '.shotglass {',
    '  display: grid;',
    '  place-items: center;',
    r.w ? `  aspect-ratio: ${r.w} / ${r.h};` : null,
    `  padding: ${pad}%;`,
    `  background: ${bgCss(spec)};`,
    '  perspective: 2400px;',
    '}',
    '.shotglass > img {',
    '  display: block;',
    '  max-width: 100%;',
    '  max-height: 100%;',
    '  height: auto;',
    `  border-radius: ${radiusPx}px;`,
    `  transform: rotateX(${tx}deg) rotateY(${ty}deg);`,
    `  box-shadow: ${ox}px ${oy}px ${blur}px -${Math.round(blur * 0.2)}px rgb(0 0 0 / ${keyA}), ${Math.round(ox * 0.2)}px ${Math.round(oy * 0.25 + 2)}px ${Math.round(6 + 6 * s)}px rgb(0 0 0 / ${ambA});`,
    '}',
  ];
  return lines.filter(Boolean).join('\n') + '\n';
}

export { FRAMES };
