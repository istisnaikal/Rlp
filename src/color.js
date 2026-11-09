// Color math: sRGB <-> OKLab/OKLCH with gamut mapping, plus palette extraction.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.replace(/./g, '$&$&');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

const toLin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toGam = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklab(rgb) {
  const r = toLin(rgb[0]), g = toLin(rgb[1]), b = toLin(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function rgbToOklch(rgb) {
  const [L, a, b] = rgbToOklab(rgb);
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

const inGamut = (v) => v[0] >= -1e-4 && v[0] <= 1.0001 && v[1] >= -1e-4 && v[1] <= 1.0001 && v[2] >= -1e-4 && v[2] <= 1.0001;

/** OKLCH → hex. Out-of-gamut colors keep lightness and hue and lose just enough chroma. */
export function oklch(L, C, h) {
  const hr = (h * Math.PI) / 180;
  const at = (c) => oklabToLinear(L, c * Math.cos(hr), c * Math.sin(hr));
  let lin = at(C);
  if (!inGamut(lin)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(at(mid))) lo = mid;
      else hi = mid;
    }
    lin = at(lo);
  }
  return rgbToHex(lin.map((v) => toGam(clamp(v, 0, 1))));
}

export function luminance(rgb) {
  return 0.2126 * toLin(rgb[0]) + 0.7152 * toLin(rgb[1]) + 0.0722 * toLin(rgb[2]);
}

const hueDist = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Read a small RGBA buffer and return what the shot is made of:
 * up to three vibrant hues, the dominant tone, and whether it reads light.
 */
export function extractPalette(data) {
  const bins = new Float64Array(36);
  const binL = new Float64Array(36);
  const binC = new Float64Array(36);
  let sumL = 0, n = 0, chromaSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [L, C, h] = rgbToOklch([data[i], data[i + 1], data[i + 2]]);
    sumL += L;
    n++;
    chromaSum += C;
    if (C < 0.045 || L < 0.18 || L > 0.97) continue;
    const b = Math.floor(h / 10) % 36;
    const w = C ** 1.6 * (1 - Math.abs(L - 0.62));
    bins[b] += w;
    binL[b] += L * w;
    binC[b] += C * w;
  }
  const meanL = n ? sumL / n : 0.5;
  // smooth bins around the circle so a hue split across two bins still wins
  const sm = Array.from({ length: 36 }, (_, i) => bins[(i + 35) % 36] * 0.5 + bins[i] + bins[(i + 1) % 36] * 0.5);
  const picks = [];
  const order = sm.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const total = sm.reduce((a, b) => a + b, 0) || 1;
  for (const [v, i] of order) {
    if (picks.length >= 3 || v / total < 0.03) break;
    const h = i * 10 + 5;
    if (picks.some((p) => hueDist(p.h, h) < 38)) continue;
    const w = bins[i] || 1e-9;
    picks.push({ h, L: bins[i] ? binL[i] / w : 0.6, C: bins[i] ? binC[i] / w : 0.12, weight: v / total });
  }
  return { hues: picks, meanL, light: meanL > 0.62, colorful: n ? chromaSum / n > 0.02 : false };
}
