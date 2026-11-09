// The single source of truth for identity. Moving to a real domain is one edit:
// change `origin` below, rebuild, then add the host redirect described in README.md.
export const SITE = {
  origin: 'https://shotglass.pages.dev',
  name: 'Shotglass',
  title: 'Shotglass: make any screenshot post-ready, free and in your browser',
  description:
    'Paste a screenshot, tilt it in real 3D, move the light, erase secrets, and export a post-ready PNG for X, LinkedIn, docs or decks. Free, no sign-up, no watermark, nothing uploaded.',
  shortDescription: 'Make any screenshot post-ready. Real 3D tilt, a light you can move, a secret eraser. Free, private, in your browser.',
  themeColor: '#0a0a0c',
  locale: 'en_US',
  lang: 'en',
  maker: {
    name: 'Eyüp',
    brand: 'Eyüp DevArt',
    org: 'DevArt',
    url: 'https://eyupdevart.com/',
    personId: 'https://eyupdevart.com/#person',
    orgId: 'https://eyupdevart.com/#devart',
  },
  siblings: [{ name: 'WHIRLWIND • T', url: 'https://whirlwind-t.dev/', id: 'https://whirlwind-t.dev/#software' }],
};
