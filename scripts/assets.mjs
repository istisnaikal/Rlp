// Generates committed binary assets with the bundled Chromium:
//   node scripts/assets.mjs icons   → favicon.ico, apple-touch-icon.png, icon-192/512, maskable
//   node scripts/assets.mjs og      → og.jpg, made by Shotglass itself (needs `npm run build` + `npm run serve`)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PRESETS, bgCss } from '../src/looks.js';
import { SITE } from '../site.config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const mode = process.argv[2] || 'icons';

const browser = await chromium.launch();

async function renderSvg(svg, size, pad = 0, bg = null) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const inner = size - pad * 2;
  await page.setContent(
    `<html><body style="margin:0;background:${bg || 'transparent'}"><div style="width:${size}px;height:${size}px;display:grid;place-items:center">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`
  );
  const buf = await page.screenshot({ omitBackground: !bg, type: 'png' });
  await page.close();
  return buf;
}

function ico(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, o);
    header.writeUInt8(size >= 256 ? 0 : size, o + 1);
    header.writeUInt8(0, o + 2);
    header.writeUInt8(0, o + 3);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(buf.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.buf)]);
}

if (mode === 'icons') {
  const svg = await readFile(join(pub, 'icon.svg'), 'utf8');
  const sizes = [16, 32, 48];
  const pngs = [];
  for (const s of sizes) pngs.push({ size: s, buf: await renderSvg(svg, s) });
  await writeFile(join(pub, 'favicon.ico'), ico(pngs));
  await writeFile(join(pub, 'apple-touch-icon.png'), await renderSvg(svg.replace('rx="15"', 'rx="0"'), 180, 0, '#16141a'));
  await writeFile(join(pub, 'icon-192.png'), await renderSvg(svg, 192));
  await writeFile(join(pub, 'icon-512.png'), await renderSvg(svg, 512));
  await writeFile(join(pub, 'icon-maskable-512.png'), await renderSvg(svg.replace('rx="15"', 'rx="0"'), 512, 72, '#16141a'));
  console.log('icons written');
}

if (mode === 'og') {
  // 1. let Shotglass render its own hero: demo shot, clear backdrop, 4:3, exported at 2×
  const dl = await mkdtemp(join(tmpdir(), 'sg-og-'));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4173/#look=v1.r43.bn.fb.s88.c55.d80.g70.n0.t8_-20.l14_6', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save')]);
  const shotPath = join(dl, 'shot.png');
  await download.saveAs(shotPath);
  const shot = (await readFile(shotPath)).toString('base64');
  await ctx.close();

  // 2. compose the card around it
  const ember = PRESETS.find((p) => p.id === 'ember');
  const icon = await readFile(join(pub, 'icon.svg'), 'utf8');
  const page2 = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page2.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;background:${bgCss(ember)};font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#fff7ec}
    .grain{position:absolute;inset:0;opacity:.18;mix-blend-mode:overlay;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
    .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(14,4,2,.82) 0%,rgba(14,4,2,.55) 38%,rgba(14,4,2,0) 62%)}
    .copy{position:absolute;left:72px;top:0;bottom:0;width:470px;display:flex;flex-direction:column;justify-content:center;gap:22px}
    .brand{display:flex;align-items:center;gap:16px;font-size:30px;font-weight:750;letter-spacing:-.02em}
    .brand svg{width:56px;height:56px;filter:drop-shadow(0 6px 18px rgba(0,0,0,.4))}
    h1{margin:0;font-size:60px;line-height:.98;letter-spacing:-.045em;font-weight:800}
    h1 em{font-style:normal;color:#ffc469}
    p{margin:0;font-size:21px;line-height:1.4;color:rgba(255,240,225,.82);font-weight:500}
    .pill{display:inline-flex;align-self:flex-start;padding:9px 16px;border-radius:999px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.18);font-size:17px;font-weight:650;letter-spacing:.01em}
    img{position:absolute;right:-70px;top:50%;width:780px;transform:translateY(-50%)}
  </style></head><body><div class="grain"></div><div class="shade"></div>
  <img src="data:image/png;base64,${shot}" alt="">
  <div class="copy"><div class="brand">${icon}<span>Shotglass</span></div><h1>Screenshots that look <em>shot</em>, not snipped.</h1><p>Real 3D tilt, a light you can move, a secret eraser. Free and private, right in your browser.</p><span class="pill">${new URL(SITE.origin).host}</span></div>
  </body></html>`);
  await page2.waitForTimeout(400);
  const jpg = await page2.screenshot({ type: 'jpeg', quality: 88 });
  await writeFile(join(pub, 'og.jpg'), jpg);
  console.log('og.jpg written', jpg.length);
}

await browser.close();
