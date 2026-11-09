// Interaction probe: drives the real app in Chromium against the header-faithful server.
// Fails on any console error, CSP/Trusted Types violation, or broken interaction.
//   npm run build && npm run serve &  node scripts/check.mjs [outdir]
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://localhost:4173';
const out = process.argv[2] || 'check-out';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const problems = [];
const log = (...a) => console.log('·', ...a);

async function run(name, viewport, fn, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${name}] console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`[${name}] requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(BASE + (opts.hash || '/'), { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  try {
    await fn(page, ctx);
  } catch (e) {
    problems.push(`[${name}] threw: ${e.message}`);
  }
  await ctx.close();
}

const shot = (page, f) => page.screenshot({ path: join(out, f) });

async function stageBox(page) {
  return page.locator('#stage').boundingBox();
}

await run('desktop', { width: 1440, height: 900 }, async (page) => {
  await shot(page, '01-load.png');
  const b = await stageBox(page);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  // tilt by dragging the card
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(cx + i * 14, cy - i * 4);
  await page.mouse.up();
  await page.waitForTimeout(900);
  await shot(page, '02-tilt.png');
  // move the light: press the backdrop near the top right corner
  await page.mouse.click(b.x + b.width - 30, b.y + 30);
  await page.waitForTimeout(900);
  await shot(page, '03-light.png');
  const hash1 = await page.evaluate(() => location.hash);
  log('hash after moves', hash1);
  if (!hash1.startsWith('#look=v1.')) problems.push('[desktop] look did not reach the URL');
  // cycle backdrop and ratio by keyboard
  await page.keyboard.press('b');
  await page.keyboard.press('r');
  await page.waitForTimeout(800);
  await shot(page, '04-keys.png');
  // drop a real image
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 800;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1280, 800);
    g.addColorStop(0, '#0f172a');
    g.addColorStop(1, '#1e3a8a');
    x.fillStyle = g;
    x.fillRect(0, 0, 1280, 800);
    x.fillStyle = '#38bdf8';
    x.fillRect(80, 80, 500, 300);
    x.fillStyle = '#f472b6';
    x.fillRect(640, 420, 520, 280);
    x.fillStyle = '#ffffff';
    x.font = '600 48px system-ui';
    x.fillText('secret: sk_test_123', 120, 600);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'my-app.png', { type: 'image/png' }));
    const st = document.querySelector('#stage');
    st.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    st.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return blob.size;
  });
  log('dropped png bytes', png);
  await page.waitForTimeout(1500);
  await shot(page, '05-dropped.png');
  const hasImage = await page.evaluate(() => document.querySelector('#stage').classList.contains('has-image'));
  if (!hasImage) problems.push('[desktop] drop did not load the image');
  // erase the secret text
  await page.keyboard.press('e');
  await page.waitForTimeout(900);
  await shot(page, '06-erase-mode.png');
  const box = await page.evaluate(() => {
    const r = document.querySelector('#stage').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.66);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.72, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const undo = await page.evaluate(() => !document.querySelector('#btn-undo2').disabled);
  if (!undo) problems.push('[desktop] erase did not register');
  await shot(page, '07-erased.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  // export
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#btn-save')]);
  const p = join(out, 'export.png');
  await dl.saveAs(p);
  const dims = await page.evaluate(() => document.querySelector('#dims').textContent);
  log('exported', dl.suggestedFilename(), dims);
  // copy look link
  await page.click('#btn-link');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  log('look link', clip);
  if (!/^https:\/\/shotglass\.pages\.dev\/#look=v1\./.test(clip)) problems.push('[desktop] look link wrong: ' + clip);
  await page.click('#btn-css');
  const css = await page.evaluate(() => navigator.clipboard.readText());
  await writeFile(join(out, 'look.css'), css);
  // copy image
  await page.click('#btn-copy');
  await page.waitForTimeout(1500);
  const types = await page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read();
      return items.flatMap((i) => i.types);
    } catch (e) {
      return ['err:' + e.message];
    }
  });
  log('clipboard types after copy', types.join(','));
  if (!types.includes('image/png')) problems.push('[desktop] copy image failed: ' + types.join(','));
  await shot(page, '08-final.png');
});

await run('shared-link', { width: 1280, height: 800 }, async (page) => {
  await shot(page, '09-shared.png');
}, { hash: '/#look=v1.r11.bm-170503-ff4d1a-ffb02e-c2103b-ff7b29.fw.s70.c80.d90.g80.n1.t-12_18.l80_10' });

await run('mobile', { width: 390, height: 844 }, async (page) => {
  await shot(page, '10-mobile.png');
  const b = await stageBox(page);
  await page.touchscreen.tap(b.x + 20, b.y + 20);
  await page.waitForTimeout(800);
  await shot(page, '11-mobile-light.png');
  await page.screenshot({ path: join(out, '12-mobile-full.png'), fullPage: true });
}, { touch: true });

await browser.close();
if (problems.length) {
  console.log('\nPROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('\nclean: no console errors, no violations, every interaction answered');
