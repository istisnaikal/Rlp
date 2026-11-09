// The demo shot: a launch-week dashboard painted on the fly, so the stage is alive
// before you hand it anything. It carries a fake API key and email to invite the eraser.

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function card(ctx, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(20,16,40,0.06)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  rr(ctx, x, y, w, h, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 14);
  ctx.strokeStyle = '#ebeaf2';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function text(ctx, s, x, y, size, weight, color, font = SANS, align = 'left') {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
}

function spark(ctx, x, y, w, h, pts, color) {
  ctx.beginPath();
  pts.forEach((v, i) => {
    const px = x + (i / (pts.length - 1)) * w;
    const py = y + h - v * h;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function smoothPath(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
}

/** Paint the demo dashboard into a 2D context at the given pixel scale (logical size 1200×750). */
export function paintSample(canvas, scale = 2) {
  const W = 1200, H = 750;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';

  // app background
  ctx.fillStyle = '#f6f5fa';
  ctx.fillRect(0, 0, W, H);

  // sidebar
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 216, H);
  ctx.fillStyle = '#ecebf3';
  ctx.fillRect(215, 0, 1, H);
  const lg = ctx.createLinearGradient(24, 24, 54, 54);
  lg.addColorStop(0, '#ffb020');
  lg.addColorStop(1, '#ff5a5f');
  rr(ctx, 24, 26, 30, 30, 9);
  ctx.fillStyle = lg;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(34, 49);
  ctx.lineTo(39, 33);
  ctx.lineTo(44, 49);
  ctx.closePath();
  ctx.fill();
  text(ctx, 'Launchpad', 66, 47, 17, 700, '#16151d');

  const nav = ['Overview', 'Visitors', 'Signups', 'Revenue', 'Feedback', 'Settings'];
  nav.forEach((label, i) => {
    const y = 96 + i * 42;
    if (i === 0) {
      rr(ctx, 14, y - 4, 188, 36, 10);
      ctx.fillStyle = '#f0ecff';
      ctx.fill();
    }
    rr(ctx, 28, y + 6, 16, 16, 5);
    ctx.strokeStyle = i === 0 ? '#6d4aff' : '#a9a7b8';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    text(ctx, label, 56, y + 19, 14, i === 0 ? 650 : 500, i === 0 ? '#5a37f2' : '#55546a');
  });

  rr(ctx, 14, H - 70, 188, 52, 12);
  ctx.fillStyle = '#f6f5fa';
  ctx.fill();
  const av = ctx.createLinearGradient(26, H - 58, 54, H - 30);
  av.addColorStop(0, '#6d4aff');
  av.addColorStop(1, '#ff7a59');
  ctx.beginPath();
  ctx.arc(42, H - 44, 14, 0, Math.PI * 2);
  ctx.fillStyle = av;
  ctx.fill();
  text(ctx, 'Launch team', 66, H - 48, 13, 650, '#16151d');
  text(ctx, '4 makers online', 66, H - 31, 12, 500, '#7b7a8e');

  // header
  text(ctx, 'Launch week', 248, 58, 26, 750, '#16151d');
  text(ctx, 'Day 3 of 7 · updated just now', 248, 80, 13, 500, '#76758a');
  rr(ctx, 1040, 36, 132, 36, 10);
  ctx.fillStyle = '#16151d';
  ctx.fill();
  text(ctx, 'Share update', 1106, 59, 13, 650, '#ffffff', SANS, 'center');
  rr(ctx, 890.5, 36.5, 138, 35, 10);
  ctx.strokeStyle = '#e3e2ec';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  text(ctx, 'Nov 3 – Nov 9', 959, 59, 13, 550, '#3b3a4c', SANS, 'center');

  // KPIs
  const kpis = [
    ['Visitors', '48,209', '+312%', '#6d4aff', [0.1, 0.18, 0.15, 0.32, 0.4, 0.62, 0.95]],
    ['Signups', '3,914', '+188%', '#ff9f1a', [0.12, 0.1, 0.24, 0.3, 0.5, 0.58, 0.88]],
    ['Revenue', '$12.4k', '+96%', '#ff5a5f', [0.2, 0.22, 0.2, 0.36, 0.42, 0.66, 0.8]],
  ];
  const kw = (1200 - 248 - 28 - 32) / 3;
  kpis.forEach(([label, value, delta, color, pts], i) => {
    const x = 248 + i * (kw + 16);
    card(ctx, x, 100, kw, 112);
    text(ctx, label, x + 20, 130, 13, 600, '#6f6e84');
    text(ctx, value, x + 20, 170, 30, 750, '#16151d');
    rr(ctx, x + 20, 182, 64, 20, 10);
    ctx.fillStyle = '#e8f8ef';
    ctx.fill();
    text(ctx, '▲ ' + delta.slice(1), x + 52, 196, 11.5, 700, '#11924a', SANS, 'center');
    text(ctx, 'vs last week', x + 92, 196, 12, 500, '#8e8da0');
    spark(ctx, x + kw - 112, 128, 92, 50, pts, color);
  });

  // traffic chart
  const cx = 248, cy = 228, cw = 596, ch = 300;
  card(ctx, cx, cy, cw, ch);
  text(ctx, 'Traffic', cx + 20, cy + 32, 15, 700, '#16151d');
  ctx.fillStyle = '#6d4aff';
  ctx.beginPath();
  ctx.arc(cx + 420, cy + 27, 4, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, 'This week', cx + 430, cy + 31, 12, 550, '#55546a');
  ctx.strokeStyle = '#ffb020';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx + 500, cy + 27);
  ctx.lineTo(cx + 514, cy + 27);
  ctx.stroke();
  ctx.setLineDash([]);
  text(ctx, 'Last week', cx + 520, cy + 31, 12, 550, '#55546a');

  const gx = cx + 44, gy = cy + 58, gw = cw - 68, gh = 196;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = gy + (gh / 4) * i;
    ctx.strokeStyle = '#f0eff5';
    ctx.beginPath();
    ctx.moveTo(gx, y + 0.5);
    ctx.lineTo(gx + gw, y + 0.5);
    ctx.stroke();
    text(ctx, ['20k', '15k', '10k', '5k', '0'][i], gx - 12, y + 4, 11, 500, '#a3a2b4', SANS, 'right');
  }
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  days.forEach((d, i) => text(ctx, d, gx + (gw / 6) * i, gy + gh + 22, 11, 500, '#a3a2b4', SANS, 'center'));
  const cur = [0.12, 0.22, 0.41, 0.92, 0.7, 0.78, 0.86].map((v, i) => [gx + (gw / 6) * i, gy + gh - v * gh]);
  const last = [0.08, 0.1, 0.14, 0.16, 0.2, 0.18, 0.24].map((v, i) => [gx + (gw / 6) * i, gy + gh - v * gh]);
  const fill = ctx.createLinearGradient(0, gy, 0, gy + gh);
  fill.addColorStop(0, 'rgba(109,74,255,0.28)');
  fill.addColorStop(1, 'rgba(109,74,255,0)');
  ctx.beginPath();
  smoothPath(ctx, cur);
  ctx.lineTo(gx + gw, gy + gh);
  ctx.lineTo(gx, gy + gh);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  smoothPath(ctx, cur);
  ctx.strokeStyle = '#6d4aff';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  smoothPath(ctx, last);
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = '#ffb020';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);
  const [px, py] = cur[3];
  ctx.beginPath();
  ctx.arc(px, py, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#6d4aff';
  ctx.stroke();
  rr(ctx, px - 72, py - 52, 144, 36, 9);
  ctx.fillStyle = '#16151d';
  ctx.fill();
  text(ctx, 'Thu · 18,402 visits', px, py - 29, 12, 650, '#ffffff', SANS, 'center');

  // sources
  const sx = cx + cw + 16, sw = 1200 - 28 - sx;
  card(ctx, sx, cy, sw, ch);
  text(ctx, 'Top sources', sx + 20, cy + 32, 15, 700, '#16151d');
  const src = [
    ['Group chats', 41, '#6d4aff'],
    ['Newsletters', 23, '#ff9f1a'],
    ['Search', 17, '#ff5a5f'],
    ['Direct', 12, '#20b486'],
    ['Forums', 7, '#3d8bff'],
  ];
  src.forEach(([label, v, color], i) => {
    const y = cy + 70 + i * 44;
    text(ctx, label, sx + 20, y, 13, 550, '#3b3a4c');
    text(ctx, v + '%', sx + sw - 20, y, 13, 700, '#16151d', SANS, 'right');
    rr(ctx, sx + 20, y + 10, sw - 40, 8, 4);
    ctx.fillStyle = '#f1f0f6';
    ctx.fill();
    rr(ctx, sx + 20, y + 10, (sw - 40) * (v / 45), 8, 4);
    ctx.fillStyle = color;
    ctx.fill();
  });

  // API keys (erase me)
  const ky = cy + ch + 16, kh = 750 - 24 - ky;
  card(ctx, cx, ky, cw, kh);
  text(ctx, 'API keys', cx + 20, ky + 32, 15, 700, '#16151d');
  rr(ctx, cx + 116, ky + 17, 56, 20, 10);
  ctx.fillStyle = '#fff1e0';
  ctx.fill();
  text(ctx, 'Secret', cx + 144, ky + 31, 11, 700, '#c76a00', SANS, 'center');
  text(ctx, 'Production', cx + 20, ky + 72, 13, 550, '#6f6e84');
  rr(ctx, cx + 120, ky + 52, 366, 30, 8);
  ctx.fillStyle = '#f6f5fa';
  ctx.fill();
  text(ctx, 'sg_live_7Hq2xT9cKd41mVr8Lp0ZaW3n', cx + 134, ky + 72, 13, 500, '#2c2b3a', MONO);
  rr(ctx, cx + 498, ky + 52, 78, 30, 8);
  ctx.strokeStyle = '#e3e2ec';
  ctx.stroke();
  text(ctx, 'Copy', cx + 537, ky + 72, 13, 600, '#3b3a4c', SANS, 'center');
  text(ctx, 'Owner', cx + 20, ky + 112, 13, 550, '#6f6e84');
  text(ctx, 'founder@your-app.dev', cx + 134, ky + 112, 13, 550, '#2c2b3a');
  text(ctx, 'Rotated 2 days ago', cx + 576, ky + 112, 12, 500, '#9a99ab', SANS, 'right');

  // feedback
  card(ctx, sx, ky, sw, kh);
  text(ctx, 'Latest feedback', sx + 20, ky + 32, 15, 700, '#16151d');
  for (let i = 0; i < 5; i++) {
    const x = sx + 24 + i * 20, y = ky + 58;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 3.4 : 8;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffb020';
    ctx.fill();
  }
  text(ctx, '“How did I ship without this?”', sx + 20, ky + 98, 14, 600, '#16151d');
  text(ctx, 'from a maker, 4 minutes ago', sx + 20, ky + 120, 12, 500, '#8e8da0');
  return canvas;
}
