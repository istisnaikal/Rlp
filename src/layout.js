// Shared scene geometry. The renderer (worker) and the pointer code (main thread)
// both call these, so what you grab is exactly what gets drawn.

export const RATIOS = {
  auto: { label: 'Auto', hint: 'Fits your shot', w: 0, h: 0 },
  '169': { label: '16:9', hint: 'X, YouTube, slides', w: 1920, h: 1080 },
  og: { label: 'OG', hint: 'Link cards, LinkedIn', w: 1200, h: 630 },
  '11': { label: '1:1', hint: 'Square posts', w: 1080, h: 1080 },
  '45': { label: '4:5', hint: 'Instagram and LinkedIn feed', w: 1080, h: 1350 },
  '916': { label: '9:16', hint: 'Stories and Reels', w: 1080, h: 1920 },
  '43': { label: '4:3', hint: 'Dribbble, docs, decks', w: 1600, h: 1200 },
};

export const FRAMES = ['none', 'mac', 'browser'];
export const MAX_TILT = 42;
export const MAX_SIDE = 8192;
export const MAX_AREA = 16777216; // iOS canvas ceiling

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Height of the window/browser bar for an image of w×h, in image pixels. */
export function chromeHeight(w, h, frame) {
  if (frame === 'none') return 0;
  const ref = Math.max(w, h * 0.9);
  return Math.round(ref * (frame === 'browser' ? 0.046 : 0.034));
}

/** Native card size: the screenshot plus its bar. */
export function cardSize(imgW, imgH, frame) {
  return { cw: imgW, ch: imgH + chromeHeight(imgW, imgH, frame) };
}

/** Base output dimensions (1×) for a ratio. Auto pads the card evenly at its native size. */
export function frameDims(ratio, cw, ch, size) {
  const r = RATIOS[ratio] || RATIOS['169'];
  if (r.w) return { W: r.w, H: r.h };
  const m = Math.max(cw, ch);
  const pad = (m / size - m) / 2;
  return { W: cw + pad * 2, H: ch + pad * 2 };
}

/** Final pixel size of an export, capped to what every browser can encode. */
export function exportDims(W, H, scale) {
  let w = W * scale;
  let h = H * scale;
  const k = Math.min(1, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  return { w, h, capped: k < 1 };
}

/** Rotation matrix (column-major mat3): rotateY(ty) first, then rotateX(tx). Degrees. */
export function rotation(tx, ty) {
  const a = (ty * Math.PI) / 180;
  const b = (tx * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  // rows: x' = x*ca + z*sa ; y' = x*sa*sb + y*cb - z*ca*sb ; z' = -x*sa*cb + y*sb + z*ca*cb
  return [ca, sa * sb, -sa * cb, 0, cb, sb, sa, -ca * sb, ca * cb];
}

export function rotate(m, x, y, z) {
  return [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];
}

/**
 * Everything the renderer and the hit-tester need about the card, in frame pixels.
 * scene: { W, H, cw, ch, size, tiltX, tiltY, lift, scaleIn, radius, shadow, lightX, lightY }
 */
export function cardLayout(s) {
  const k = Math.min((s.W * s.size) / s.cw, (s.H * s.size) / s.ch) * (s.scaleIn || 1);
  const w = s.cw * k;
  const h = s.ch * k;
  const big = Math.max(w, h);
  const cx = s.W / 2;
  const cy = s.H / 2;
  const D = big * 2.4;
  const m = rotation(s.tiltX, s.tiltY);
  const lift = s.lift || 0;
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => {
    const p = rotate(m, x, y, 0);
    p[2] += lift * big * 0.05;
    return p;
  });
  const project = (p) => {
    const f = D / (D - p[2]);
    return [cx + p[0] * f, cy + p[1] * f];
  };
  const screen = corners.map(project);
  const radius = Math.min(w, h) * 0.075 * (s.radius ?? 0.5);
  return { k, w, h, big, cx, cy, D, m, corners, screen, radius, lift };
}

/** Shadow quads (key + ambient) cast from a light hovering in front of the backdrop. */
export function shadowLayout(s, L) {
  const W = s.W, H = s.H;
  const strength = clamp(s.shadow ?? 0.6, 0, 1);
  const elev = L.big * (0.018 + 0.085 * strength) * (1 + L.lift * 0.9);
  const lx = (s.lightX ?? 0.25) * W - L.cx;
  const ly = (s.lightY ?? 0.2) * H - L.cy;
  const lz = Math.max(W, H) * 1.3;
  const camF = L.D / (L.D + elev);
  // tilt depth is damped: a card leaning toward you should read as floating, not as a smear
  const cast = (amount) =>
    L.corners.map((p) => {
      const z = p[2] * 0.3 + elev * amount;
      const t = z / Math.max(1, lz - p[2]);
      const sx = p[0] + t * (p[0] - lx);
      const sy = p[1] + t * (p[1] - ly);
      return [L.cx + sx * camF, L.cy + sy * camF + elev * amount * 0.12];
    });
  const key = cast(1);
  const amb = cast(0.22);
  return {
    key,
    amb,
    keySigma: elev * 0.6 + L.big * 0.008,
    ambSigma: elev * 0.14 + L.big * 0.003,
    keyAlpha: Math.min(1, strength * 1.15) * (0.44 - L.lift * 0.08),
    ambAlpha: Math.min(1, strength * 1.4) * 0.3,
    elev,
  };
}

/** Pull each corner of a convex quad inward by r along its two edges (for rounded shadows). */
export function insetQuad(q, r) {
  return q.map((p, i) => {
    const a = q[(i + 3) % 4];
    const b = q[(i + 1) % 4];
    const ua = norm([a[0] - p[0], a[1] - p[1]]);
    const ub = norm([b[0] - p[0], b[1] - p[1]]);
    return [p[0] + (ua[0] + ub[0]) * r, p[1] + (ua[1] + ub[1]) * r];
  });
}

function norm(v) {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

export function pointInQuad(p, q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (c !== 0) {
      const s = c > 0 ? 1 : -1;
      if (sign && s !== sign) return false;
      sign = s;
    }
  }
  return true;
}

/** Inverse of the projective map unit-square → quad. Returns [u, v] for a screen point. */
export function quadToUv(p, q) {
  const [x0, y0] = q[0], [x1, y1] = q[1], [x2, y2] = q[2], [x3, y3] = q[3];
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  // invert [[a,b,c],[d,e,f],[g,h,1]]
  const A = e - f * h, B = c * h - b, C = b * f - c * e;
  const D = f * g - d, E = a - c * g, F = c * d - a * f;
  const G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  const w = G * p[0] + H * p[1] + I;
  return [(A * p[0] + B * p[1] + C) / w, (D * p[0] + E * p[1] + F) / w];
}
