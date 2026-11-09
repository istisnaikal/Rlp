// Build-time content: one source for the visible FAQ/shortcuts and their structured data.

export const FAQ = [
  {
    q: 'Is Shotglass free?',
    a: 'Yes, completely. There is no sign-up, no watermark, no pro tier and no limit on how many images you make. Open the page and start.',
  },
  {
    q: 'Are my screenshots uploaded anywhere?',
    a: 'No. Decoding, rendering, erasing and exporting all happen inside your browser tab, on your own device. Shotglass has no server that receives images, no analytics and no cookies. You can turn off your network after the page loads and it keeps working.',
  },
  {
    q: 'Can I hide API keys, emails or names before I post?',
    a: 'Yes. Press E (or Erase in the panel) and drag a box over what you want gone. Blend mode fills it from the pixels around it, as if it was never there. Bar mode lays down a solid redaction bar. The original pixels are replaced in the image before export, unlike blur or pixelation, which can sometimes be reversed.',
  },
  {
    q: 'What sizes can I export?',
    a: 'Auto fits the canvas to your screenshot. There are presets for 16:9 (X, YouTube, slides), 1200 × 630 link cards (Open Graph, LinkedIn), 1:1, 4:5, 9:16 stories and 4:3. Each exports as a PNG at 1×, 2× or 3×, and the clear backdrop keeps transparency.',
  },
  {
    q: 'How do I share a look with someone?',
    a: 'Press Copy look link (or L). The link carries the whole look: backdrop, size, frame, tilt, light, shadow, glare and grain. It never includes your screenshot. Whoever opens it pastes their own image and gets the same style. The address bar always holds the current look too.',
  },
  {
    q: 'Can I use the same effect on my website?',
    a: 'Yes. Copy CSS gives you the backdrop, perspective tilt, corner radius and light-matched shadows as plain CSS for a real image element. No library and no build step.',
  },
  {
    q: 'Does it work on my phone?',
    a: 'Yes. Tap to choose a screenshot or paste one, drag with one finger to tilt, press the backdrop to move the light, pinch to resize, then share the PNG straight from the share sheet.',
  },
  {
    q: 'Does Shotglass work offline?',
    a: 'After your first visit, yes. The app caches itself, and since nothing ever needed a server, it works the same with no connection.',
  },
  {
    q: 'Who made Shotglass?',
    a: 'Shotglass is built by Eyüp DevArt, a web developer and digital artist, as a free tool for anyone who shares their work online.',
  },
];

export const KEYS = [
  [['MOD', 'V'], 'Paste a screenshot, or paste a look link to wear it'],
  [['MOD', 'C'], 'Copy the finished image'],
  [['MOD', 'S'], 'Save the PNG'],
  [['B'], 'Next backdrop (Shift+B goes back)'],
  [['R'], 'Next canvas size'],
  [['F'], 'Next frame: none, window, browser'],
  [['E'], 'Erase mode for keys, emails and names'],
  [['MOD', 'Z'], 'Undo the last erase'],
  [['G'], 'Film grain on or off'],
  [['0'], 'Flatten the tilt'],
  [['L'], 'Copy the look link'],
  [['+', '−'], 'Bigger or smaller on the canvas'],
  [['←', '→', '↑', '↓'], 'Tilt (with the preview focused). Add Shift to move the light'],
  [['?'], 'Show these shortcuts'],
];
