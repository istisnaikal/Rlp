// The gate: Lighthouse 13, all five categories, mobile and desktop, several runs each.
// Passes only on 100 everywhere, CLS 0 and no failing scored audit.
//   LIGHTHOUSE=/path/to/lighthouse CHROME_PATH=/path/to/chrome node scripts/gate.mjs [url] [runs]
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const url = process.argv[2] || 'http://localhost:4173/';
const runs = Number(process.argv[3] || 3);
const lh = process.env.LIGHTHOUSE || 'lighthouse';
const cats = 'performance,accessibility,best-practices,seo,agentic-browsing';
const dir = mkdtempSync(join(tmpdir(), 'gate-'));
const proxy = process.env.HTTPS_PROXY && !/localhost|127\.0\.0\.1/.test(url) ? ` --proxy-server=${process.env.HTTPS_PROXY}` : '';
let ok = true;

for (const preset of ['mobile', 'desktop']) {
  for (let i = 1; i <= runs; i++) {
    const out = join(dir, `${preset}-${i}.json`);
    const args = [url, `--only-categories=${cats}`, '--quiet', `--chrome-flags=--headless=new --no-sandbox${proxy}`, '--output=json', `--output-path=${out}`];
    if (preset === 'desktop') args.push('--preset=desktop');
    try {
      execFileSync(lh, args, { stdio: 'ignore', timeout: 240000 });
    } catch {
      /* lighthouse exits non-zero on some warnings; the report decides */
    }
    const r = JSON.parse(readFileSync(out, 'utf8'));
    const a = r.audits;
    const scores = Object.values(r.categories).map((c) => `${c.id} ${Math.round(c.score * 100)}`);
    const cls = a['cumulative-layout-shift'].numericValue;
    const fails = [];
    for (const [id, c] of Object.entries(r.categories)) {
      if (c.score < 1) ok = false;
      for (const ref of c.auditRefs) {
        const au = a[ref.id];
        if (!au || au.score === null || au.score >= 1 || !ref.weight) continue;
        if (['informative', 'notApplicable', 'manual'].includes(au.scoreDisplayMode)) continue;
        fails.push(`${id}/${ref.id} ${au.score} ${au.displayValue || ''}`);
      }
    }
    if (cls !== 0) ok = false;
    console.log(
      `${preset} #${i}  ${scores.join(' · ')}  FCP ${a['first-contentful-paint'].displayValue} LCP ${a['largest-contentful-paint'].displayValue} TBT ${a['total-blocking-time'].displayValue} CLS ${cls}`
    );
    for (const f of fails) console.log('   ✗ ' + f);
    if (fails.length) ok = false;
  }
}
console.log(ok ? '\nGATE: PASS' : '\nGATE: FAIL');
process.exit(ok ? 0 : 1);
