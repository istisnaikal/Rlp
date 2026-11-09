// Shotglass build: bundle, hash, inline, sign the CSP, emit the entity graph and headers.
import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, rm, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../site.config.mjs';
import { FAQ, KEYS } from '../src/content.mjs';
import { PRESETS } from '../src/looks.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const O = SITE.origin.replace(/\/$/, '');
const HOST = new URL(O).host;
const today = new Date().toISOString().slice(0, 10);
const hash = (buf, n = 10) => createHash('sha256').update(buf).digest('hex').slice(0, n);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'assets'), { recursive: true });

const target = ['es2020', 'chrome90', 'safari15', 'firefox100'];

// 1. worker (classic script, runs the renderer off the main thread)
const w = await build({ entryPoints: [join(root, 'src/worker.js')], bundle: true, format: 'iife', minify: true, target, write: false, legalComments: 'none' });
const workerCode = w.outputFiles[0].contents;
const workerName = `assets/worker-${hash(workerCode)}.js`;
await writeFile(join(dist, workerName), workerCode);

// 2. main-thread engine (only fetched by browsers without OffscreenCanvas WebGL)
const e = await build({ entryPoints: [join(root, 'src/engine.js')], bundle: true, format: 'esm', minify: true, target, write: false, legalComments: 'none' });
const engineCode = e.outputFiles[0].contents;
const engineName = `assets/engine-${hash(engineCode)}.js`;
await writeFile(join(dist, engineName), engineCode);
const chunkFiles = [engineName];

// 4. CSS: minify, add the preset swatch colors, inline, and hash for the CSP
const rawCss = await readFile(join(root, 'src/styles.css'), 'utf8');
const cssTarget = ['chrome90', 'safari15', 'firefox100'];
const css = (await transform(rawCss, { loader: 'css', minify: true, target: cssTarget })).code.trim();
const cssHash = createHash('sha256').update(css).digest('base64');
// below-the-fold and JS-only styles ship as a hashed file so the document fits one round trip
const restCss = (await transform(await readFile(join(root, 'src/rest.css'), 'utf8'), { loader: 'css', minify: true, target: cssTarget })).code;
const restName = `assets/rest-${hash(restCss)}.css`;
await writeFile(join(dist, restName), restCss);

// 3. main module: one file, no static imports, nothing between first paint and a live stage
const m = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  target,
  write: false,
  legalComments: 'none',
  define: { __WORKER_URL__: JSON.stringify('/' + workerName), __ENGINE_URL__: JSON.stringify('/' + engineName), __REST_CSS__: JSON.stringify('/' + restName), __ORIGIN__: JSON.stringify(O) },
});
const appCode = m.outputFiles[0].contents;
const appFile = `assets/app-${hash(appCode)}.js`;
await writeFile(join(dist, appFile), appCode);

// 5. static files
const pub = join(root, 'public');
await cp(pub, dist, { recursive: true });
const ogSrc = await readFile(join(pub, 'og.jpg'));
const ogName = `og-${hash(ogSrc)}.jpg`;
await writeFile(join(dist, ogName), ogSrc);
const OG_ALT = 'A screenshot of a launch dashboard tilted in 3D on a glowing ember backdrop, lit from the top left, next to the word Shotglass and the line: screenshots that look shot, not snipped.';

// 5. content blocks
const kbd = (k) => {
  if (k === 'MOD') return '<kbd>⌘/Ctrl</kbd>';
  return `<kbd>${esc(k)}</kbd>`;
};
const KEYS_DL = `<dl class="keys">${KEYS.map(([ks, d]) => `<dt>${ks.map(kbd).join(' ')}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`;
const FAQ_HTML = FAQ.map((f, i) => `<details${i < 2 ? ' open' : ''}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
const PRESET_SWATCHES = PRESETS.map(
  (p) => `<input type="radio" name="bg" id="bg-${p.id}" value="${p.id}"><label for="bg-${p.id}" title="${esc(p.name)}"><span class="sw${p.s === 'n' ? ' sw-clear' : ''}"></span><span class="sr">${esc(p.name)}${p.s === 'n' ? ', transparent' : ''}</span></label>`
).join('');

// 6. entity graph
const M = SITE.maker;
const card = { '@id': `${O}/#card` };
const app = { '@id': `${O}/#app` };
const graph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${O}/#website`,
      url: `${O}/`,
      name: 'Shotglass',
      alternateName: ['Shotglass screenshot beautifier', HOST],
      description: SITE.shortDescription,
      inLanguage: 'en',
      publisher: { '@id': M.orgId },
      creator: { '@id': M.personId },
    },
    {
      '@type': 'WebPage',
      '@id': `${O}/#webpage`,
      url: `${O}/`,
      name: SITE.title,
      description: SITE.description,
      inLanguage: 'en',
      isPartOf: { '@id': `${O}/#website` },
      about: app,
      mainEntity: app,
      primaryImageOfPage: card,
      image: card,
      author: { '@id': M.personId },
      datePublished: '2026-11-09',
      dateModified: today,
      relatedLink: SITE.siblings.map((s) => s.url),
    },
    {
      '@type': ['WebApplication', 'SoftwareApplication'],
      '@id': `${O}/#app`,
      name: 'Shotglass',
      alternateName: 'Shotglass screenshot beautifier',
      url: `${O}/`,
      description: SITE.description,
      applicationCategory: 'DesignApplication',
      applicationSubCategory: 'Screenshot beautifier',
      operatingSystem: 'Any operating system with a modern web browser',
      browserRequirements: 'Requires JavaScript and WebGL',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      featureList: [
        'Paste, drop or choose a screenshot; nothing is uploaded',
        'Real 3D tilt with momentum and friction',
        'Movable light that drives cast shadows and glass glare',
        'Backdrops generated from the screenshot’s own colors',
        'Window and browser frames',
        'Erase API keys, emails and names by filling from surrounding pixels',
        'Export PNG at 1×, 2× or 3×, copy to clipboard, share sheet, drag out',
        'Presets for 16:9, 1200×630 Open Graph, 1:1, 4:5, 9:16 and 4:3',
        'Shareable look links and CSS export',
        'Works offline, no account, no tracking',
      ],
      screenshot: card,
      image: card,
      softwareVersion: '1.0',
      datePublished: '2026-11-09',
      inLanguage: 'en',
      creator: { '@id': M.personId },
      author: { '@id': M.personId },
      publisher: { '@id': M.orgId },
    },
    {
      '@type': 'ImageObject',
      '@id': `${O}/#card`,
      url: `${O}/${ogName}`,
      contentUrl: `${O}/${ogName}`,
      width: 1200,
      height: 630,
      caption: OG_ALT,
      creator: { '@id': M.personId },
    },
    {
      '@type': 'FAQPage',
      '@id': `${O}/#faq`,
      isPartOf: { '@id': `${O}/#webpage` },
      mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
    {
      '@type': 'Person',
      '@id': M.personId,
      name: M.name,
      alternateName: [M.brand, M.org],
      url: M.url,
      jobTitle: 'Web developer and digital artist',
      worksFor: { '@id': M.orgId },
    },
    {
      '@type': 'Organization',
      '@id': M.orgId,
      name: M.org,
      alternateName: M.brand,
      url: M.url,
      founder: { '@id': M.personId },
    },
  ],
};
const JSONLD = JSON.stringify(graph).replace(/</g, '\\u003c');

// 7. HTML
let html = await readFile(join(root, 'src/index.html'), 'utf8');
const vars = {
  TITLE: esc(SITE.title),
  DESC: esc(SITE.description),
  SHORT: esc(SITE.shortDescription),
  ORIGIN: O,
  ORIGIN_HOST: HOST,
  OG: ogName,
  OG_ALT: esc(OG_ALT),
  APP: appFile,
  CSS: css,
  REST: restName,
  JSONLD,
  KEYS_DL,
  FAQ_HTML,
  PRESET_SWATCHES,
  YEAR: String(new Date().getFullYear()),
};
html = html.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
  if (!(k in vars)) throw new Error('Unknown placeholder ' + k);
  return vars[k];
});
// collapse indentation; the inline <style> and JSON are already single-line
html = html.replace(/\n\s*/g, '\n').replace(/>\n</g, '><').replace(/\n/g, ' ');
await writeFile(join(dist, 'index.html'), html);

// 8. 404
const notFound = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not here | Shotglass</title><meta name="robots" content="noindex"><link rel="icon" href="/icon.svg" type="image/svg+xml"><style>${css}</style><link rel="stylesheet" href="/${restName}"></head><body><main class="band" id="main"><p class="eyebrow">404</p><h2>Nothing on this shelf.</h2><p class="lede">The page you asked for isn’t here. Shotglass lives on one page.</p><a class="btn primary" href="/">Open Shotglass</a></main></body></html>`;
await writeFile(join(dist, '404.html'), notFound);
const notFoundHash = createHash('sha256').update(css).digest('base64');

// 9. manifest
const manifest = {
  id: '/',
  name: 'Shotglass',
  short_name: 'Shotglass',
  description: SITE.shortDescription,
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#09090b',
  theme_color: '#0a0a0c',
  categories: ['design', 'photo', 'productivity', 'utilities'],
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
  share_target: { action: '/share', method: 'POST', enctype: 'multipart/form-data', params: { files: [{ name: 'image', accept: ['image/*'] }] } },
};
await writeFile(join(dist, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

// 10. service worker: offline shell + share target
const core = ['/', '/' + appFile, '/' + restName, ...chunkFiles.map((f) => '/' + f), '/' + workerName, '/icon.svg', '/favicon.ico', '/manifest.webmanifest'];
const version = hash(core.join('|') + css + html.length);
const sw = `const V='sg-${version}';const CORE=${JSON.stringify(core)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V&&x!=='sg-share').map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;const u=new URL(r.url);if(u.origin!==location.origin)return;
if(r.method==='POST'&&u.pathname==='/share'){e.respondWith((async()=>{try{const f=(await r.formData()).get('image');if(f&&f.size){const c=await caches.open('sg-share');await c.put('/__shared',new Response(f,{headers:{'content-type':f.type||'image/png','x-name':encodeURIComponent(f.name||'shared')}}))}}catch(_){}return Response.redirect('/?shared=1',303)})());return}
if(r.method!=='GET')return;
if(r.mode==='navigate'){if(u.pathname!=='/'&&u.pathname!=='/index.html')return;e.respondWith(fetch(r).then(res=>{if(res.ok){const c=res.clone();caches.open(V).then(x=>x.put('/',c))}return res}).catch(()=>caches.match('/')));return}
if(CORE.includes(u.pathname)){e.respondWith(caches.match(u.pathname).then(m=>m||fetch(r)))}});
`;
await writeFile(join(dist, 'sw.js'), sw);

// 11. headers (security + caching)
const csp = [
  "default-src 'none'",
  "script-src 'self'",
  `style-src 'self' 'sha256-${cssHash}'`,
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "require-trusted-types-for 'script'",
  'trusted-types shotglass',
  'upgrade-insecure-requests',
].join('; ');
const perms = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=(), clipboard-read=(self), clipboard-write=(self)';
const headers = `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: ${perms}
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  Origin-Agent-Cluster: ?1

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/og-*
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: cross-origin

/og.jpg
  Cross-Origin-Resource-Policy: cross-origin

/sw.js
  Cache-Control: no-cache

/manifest.webmanifest
  Content-Type: application/manifest+json; charset=utf-8

/llms.txt
  Content-Type: text/plain; charset=utf-8
`;
await writeFile(join(dist, '_headers'), headers);
void notFoundHash;

// 12. robots, sitemap, llms.txt, security.txt
await writeFile(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${O}/sitemap.xml\n`);
await writeFile(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n  <url>\n    <loc>${O}/</loc>\n    <lastmod>${today}</lastmod>\n    <image:image><image:loc>${O}/${ogName}</image:loc></image:image>\n  </url>\n</urlset>\n`
);
const llms = (await readFile(join(pub, 'llms.txt'), 'utf8')).replaceAll('{{ORIGIN}}', O);
await writeFile(join(dist, 'llms.txt'), llms);
await mkdir(join(dist, '.well-known'), { recursive: true });
await writeFile(
  join(dist, '.well-known/security.txt'),
  `Contact: ${M.url}\nExpires: 2027-11-09T00:00:00.000Z\nPreferred-Languages: en, tr\nCanonical: ${O}/.well-known/security.txt\n`
);

// report
let total = 0;
const walk = async (d) => {
  for (const f of await readdir(d)) {
    const p = join(d, f);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p);
    else total += s.size;
  }
};
await walk(dist);
const sz = async (f) => ((await stat(join(dist, f))).size / 1024).toFixed(1) + ' KB';
console.log(`built ${O}`);
console.log(`  html ${await sz('index.html')}  app ${await sz(appFile)}  worker ${await sz(workerName)}  chunks ${chunkFiles.length}`);
console.log(`  total ${(total / 1024).toFixed(1)} KB`);
