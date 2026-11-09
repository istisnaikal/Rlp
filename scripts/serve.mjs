// Local static server that applies dist/_headers exactly like Cloudflare Pages would,
// so CSP, Trusted Types and COEP are exercised before anything ships.
import { createServer } from 'node:http';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function rules() {
  const txt = await readFile(join(root, '_headers'), 'utf8').catch(() => '');
  const out = [];
  let cur = null;
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      cur = { pattern: line.trim(), headers: [] };
      out.push(cur);
    } else if (cur) {
      const i = line.indexOf(':');
      cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return out;
}

const match = (pattern, path) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(path);

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = decodeURIComponent(url.pathname);
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  let status = 200;
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    await stat(file);
  } catch {
    file = join(root, '404.html');
    status = 404;
  }
  const body = await readFile(file);
  const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream' };
  for (const r of await rules()) if (match(r.pattern, path)) for (const [k, v] of r.headers) headers[k] = v;
  // plain-http localhost can't honor an https upgrade; everything else stays identical
  if (headers['Content-Security-Policy']) headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
  if (path === '/' || path.endsWith('.html')) headers['Cache-Control'] = 'no-cache';
  // compress text the way Cloudflare's edge does
  let out = body;
  const enc = String(req.headers['accept-encoding'] || '');
  if (/^(text|application\/(json|xml|manifest))|svg/.test(headers['Content-Type'])) {
    if (enc.includes('br')) {
      out = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
      headers['Content-Encoding'] = 'br';
    } else if (enc.includes('gzip')) {
      out = gzipSync(body);
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Vary'] = 'Accept-Encoding';
  }
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : out);
}).listen(port, () => console.log(`serving dist on http://localhost:${port}`));
