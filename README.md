# Shotglass

**[shotglass.pages.dev](https://shotglass.pages.dev/)**: screenshots that look shot, not snipped.

Paste a screenshot and it lands on a lit stage, on a backdrop cut from its own colors. Grab it and it tilts in real 3D, with weight and momentum until friction brings it to rest. Press anywhere on the backdrop and the light moves there, so the cast shadow swings and a glare slides across the glass. Draw a box over an API key or an email and it disappears into the surrounding pixels. Then the result leaves however it needs to: a PNG on the clipboard (⌘C), a file at 1–3× (⌘S), the phone share sheet, a drag-out thumbnail, a look link that carries the whole style in the URL, or CSS for a real `<img>`.

Free. No sign-up, no watermark, no uploads, no tracking. Built by [Eyüp DevArt](https://eyupdevart.com/).

## How it is built

| Piece | What it does |
| --- | --- |
| `src/main.js` | Main thread: springs (tilt, lift, light, frame), pointer and pinch physics, controls, exports, recipe links, starred looks, WebMCP tools for agents. |
| `src/worker.js` → `src/engine.js` | Off the main thread via `OffscreenCanvas`: owns the pixels, builds the card bitmap, runs the eraser, extracts the palette, encodes PNGs. Falls back to the main thread when a browser can't do WebGL in a worker. |
| `src/gl.js` | WebGL renderer. One full-frame pass draws the backdrop (CSS-identical mesh gradients), grain and an analytic soft shadow cast from the light; one card pass draws the perspective-correct screenshot with a rounded mask, Blinn-Phong glare and a rim light. |
| `src/layout.js` | Shared geometry: what you grab is exactly what gets drawn. |
| `src/looks.js` | Backdrops, recipe encoding (`#look=v1.r169.bm-…`), CSS export. One spec drives the shader, the swatch, the link and the CSS. |
| `scripts/build.mjs` | esbuild bundles, content hashes, inline CSS signed into a strict CSP with Trusted Types, JSON-LD entity graph, headers, sitemap, offline service worker with share target. |

Nothing external is loaded. The CSP is `default-src 'none'` plus what the page needs, and Trusted Types only admit the worker and the service worker.

## Run it

```sh
npm install
npm run build      # → dist/
npm run serve      # http://localhost:4173, applies dist/_headers exactly like Pages
node scripts/check.mjs out/                     # interaction probe (Playwright)
LIGHTHOUSE=… CHROME_PATH=… node scripts/gate.mjs  # Lighthouse 13, five categories, mobile + desktop
node scripts/assets.mjs icons | og              # regenerate icons, or the social card rendered by Shotglass itself
```

## Deploy

Cloudflare Pages project `shotglass`, connected to this repository. Every push to the production branch runs `npm run build` and publishes `dist/`.

## Moving to a real domain: one move

1. Attach the domain to the `shotglass` Pages project, change `origin` in `site.config.mjs`, and push. The canonical link, Open Graph and Twitter tags, JSON-LD `@id`s, sitemap, robots, llms.txt and look links all follow that one line. (The social card prints the address, so run `node scripts/assets.mjs og` too; its file name is content-hashed, so platforms fetch the new one.)
2. Copy `migrate/_middleware.js` to `functions/_middleware.js` with the new host filled in, and push. `shotglass.pages.dev` then 301s to the domain with path and query intact, and browsers carry the `#look=` fragment across the redirect, so every look link already shared keeps working.
