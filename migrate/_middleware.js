// Domain migration, step 2 of 2. Copy this file to functions/_middleware.js on the day
// the real domain is attached in Cloudflare Pages (step 1 is editing site.config.mjs).
// It 301s the production pages.dev host to the canonical domain, path, query and all;
// browsers carry the #look=… fragment across redirects, so every shared look link survives.
// Preview deployments (<hash>.shotglass.pages.dev) are left alone.
const FROM = 'shotglass.pages.dev';
const TO = 'shotglass.example'; // ← the real domain, without https://

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname === FROM) {
    url.hostname = TO;
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
