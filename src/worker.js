// Worker shell: the whole renderer lives off the main thread, so the page never stutters.
import { Engine } from './engine.js';

const engine = new Engine((msg) => {
  const transfer = [];
  self.postMessage(msg, transfer);
});

let pending = null;
let scheduled = false;
const raf = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(f, 0);

self.onmessage = (e) => {
  const m = e.data;
  // coalesce frames: only the newest scene is worth drawing
  if (m.type === 'frame') {
    pending = m;
    if (!scheduled) {
      scheduled = true;
      raf(() => {
        scheduled = false;
        const p = pending;
        pending = null;
        if (p) engine.handle(p);
      });
    }
    return;
  }
  if (pending && (m.type === 'export' || m.type === 'erase' || m.type === 'undo')) {
    const p = pending;
    pending = null;
    engine.handle(p);
  }
  engine.handle(m);
};
