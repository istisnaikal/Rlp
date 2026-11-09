// WebGL renderer: one full-frame pass (backdrop, grain, cast shadow), one card pass
// (perspective-correct texture, rounded mask, light, glare). Works with WebGL2 or WebGL1.
import { cardLayout, shadowLayout, insetQuad } from './layout.js';

const BG_FN = (X) => `
uniform vec4 u${X}meta;
uniform vec3 u${X}stops[3];
uniform vec4 u${X}geo[4];
uniform vec3 u${X}col[4];
vec4 bg${X}(vec2 p){
  vec2 uv = p / uFrame;
  float ang = u${X}meta.z;
  vec2 dir = vec2(sin(ang), -cos(ang));
  float len = abs(uFrame.x * sin(ang)) + abs(uFrame.y * cos(ang));
  float t = clamp(dot(p - uFrame * 0.5, dir) / len + 0.5, 0.0, 1.0);
  vec3 c = u${X}stops[0];
  if (u${X}meta.y > 2.5) c = t < 0.5 ? mix(u${X}stops[0], u${X}stops[1], t * 2.0) : mix(u${X}stops[1], u${X}stops[2], t * 2.0 - 1.0);
  else if (u${X}meta.y > 1.5) c = mix(u${X}stops[0], u${X}stops[1], t);
  for (int i = 0; i < 4; i++) {
    if (float(i) >= u${X}meta.w) break;
    vec4 g = u${X}geo[i];
    float r = length((uv - g.xy) / g.zw);
    float a = 1.0 - clamp(r, 0.0, 1.0);
    c = mix(c, u${X}col[i], a * a);
  }
  return vec4(c, u${X}meta.x);
}`;

const SCENE_VS = `
attribute vec2 aPos;
uniform vec2 uFrame;
varying vec2 vP;
void main(){
  vP = aPos * uFrame;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

const SCENE_FS = `
precision highp float;
varying vec2 vP;
uniform vec2 uFrame;
uniform float uMix;
uniform vec2 uKey[4];
uniform vec2 uAmb[4];
uniform vec4 uShadow;
uniform vec2 uRad;
uniform float uGrain;
uniform float uChecker;
uniform float uSeed;
uniform float uPx;
${BG_FN('A')}
${BG_FN('B')}
void edge(vec2 p, vec2 a, vec2 b, inout float d, inout float s){
  vec2 e = a - b;
  vec2 w = p - b;
  vec2 q = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
  d = min(d, dot(q, q));
  bool c1 = p.y >= b.y;
  bool c2 = p.y < a.y;
  bool c3 = e.x * w.y > e.y * w.x;
  if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
}
float sdQuad(vec2 p, vec2 v0, vec2 v1, vec2 v2, vec2 v3){
  float d = dot(p - v0, p - v0);
  float s = 1.0;
  edge(p, v3, v0, d, s);
  edge(p, v0, v1, d, s);
  edge(p, v1, v2, d, s);
  edge(p, v2, v3, d, s);
  return s * sqrt(d);
}
float soft(float sd, float sigma){
  return 1.0 / (1.0 + exp(clamp(1.702 * sd / max(sigma, 0.001), -40.0, 40.0)));
}
float hash(vec2 p){
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
void main(){
  vec4 c = mix(bgA(vP), bgB(vP), uMix);
  if (uChecker > 0.5) {
    vec2 q = floor(vP / (uFrame.y / 36.0));
    float k = mod(q.x + q.y, 2.0);
    vec3 chk = mix(vec3(0.16), vec3(0.2), k);
    c = vec4(mix(chk, c.rgb, c.a), 1.0);
  }
  float n = hash(floor(vP / uPx) + uSeed) - 0.5;
  c.rgb += n * (uGrain * 0.06 + 1.5 / 255.0) * step(0.001, c.a);
  vec4 o = vec4(c.rgb * c.a, c.a);
  float sk = soft(sdQuad(vP, uKey[0], uKey[1], uKey[2], uKey[3]) - uRad.x, uShadow.x) * uShadow.y;
  float sa = soft(sdQuad(vP, uAmb[0], uAmb[1], uAmb[2], uAmb[3]) - uRad.y, uShadow.z) * uShadow.w;
  float s = 1.0 - (1.0 - sk) * (1.0 - sa);
  o = vec4(o.rgb * (1.0 - s), o.a + s * (1.0 - o.a));
  gl_FragColor = o;
}`;

const CARD_VS = `
attribute vec2 aPos;
uniform vec2 uFrame;
uniform vec2 uCard;
uniform vec2 uCenter;
uniform vec2 uExpand;
uniform mat3 uRot;
uniform float uD;
uniform float uLiftZ;
varying vec2 vUv;
varying vec3 vPos;
void main(){
  vec2 uv = 0.5 + (aPos - 0.5) * (1.0 + uExpand * 2.0);
  vec3 p = uRot * vec3((uv - 0.5) * uCard, 0.0);
  p.z += uLiftZ;
  vUv = uv;
  vPos = p;
  float w = (uD - p.z) / uD;
  vec2 s = uCenter * w + p.xy;
  gl_Position = vec4(2.0 * s.x / uFrame.x - w, w - 2.0 * s.y / uFrame.y, 0.0, w);
}`;

const CARD_FS = `
precision highp float;
varying vec2 vUv;
varying vec3 vPos;
uniform sampler2D uTex;
uniform vec2 uCard;
uniform float uRadius;
uniform float uAA;
uniform vec3 uN;
uniform vec3 uLight;
uniform vec3 uCam;
uniform float uGlare;
uniform float uSheen;
float sdBox(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main(){
  vec2 p = (vUv - 0.5) * uCard;
  float sd = sdBox(p, uCard * 0.5, uRadius);
  float mask = clamp(0.5 - sd / uAA, 0.0, 1.0);
  if (mask <= 0.0) discard;
  vec4 c = texture2D(uTex, clamp(vUv, 0.0, 1.0));
  vec3 L = normalize(uLight - vPos);
  vec3 V = normalize(uCam - vPos);
  vec3 H = normalize(L + V);
  float nh = max(dot(uN, H), 0.0);
  float diff = clamp(dot(uN, L), 0.0, 1.0);
  vec3 rgb = c.rgb * (0.9 + 0.1 * diff);
  float spec = pow(nh, 2200.0) * 0.32 + pow(nh, 260.0) * 0.06;
  vec2 q = vUv - 0.5;
  float band = exp(-pow((q.x * 0.82 + q.y * 0.57 - uSheen) * 3.6, 2.0));
  rgb += (spec + band * 0.085) * uGlare * c.a;
  float rim = 1.0 - smoothstep(0.0, uAA * 1.6, abs(sd + uAA * 0.9));
  rgb = mix(rgb, vec3(c.a), rim * 0.16);
  gl_FragColor = vec4(rgb, c.a) * mask;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) || 'link');
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export class GLView {
  constructor(canvas, { preserve = false } = {}) {
    this.canvas = canvas;
    const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: preserve, powerPreference: 'high-performance' };
    let gl = canvas.getContext('webgl2', opts);
    this.gl2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('webgl');
    this.gl = gl;
    this.init();
  }

  init() {
    const gl = this.gl;
    this.scene = program(gl, SCENE_VS, SCENE_FS);
    this.card = program(gl, CARD_VS, CARD_FS);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.texW = 0;
    this.texH = 0;
    this.texKey = '';
  }

  upload(source, key) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (this.gl2) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    this.texW = source.width;
    this.texH = source.height;
    this.texKey = key;
  }

  /**
   * Draw the scene. vp: { width, height (drawing buffer), x, y, w, h (frame rect, top-left origin) }.
   * opts: { checker, seed }
   */
  draw(s, vp, opts = {}) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const c = this.canvas;
    if (c.width !== vp.width || c.height !== vp.height) {
      c.width = vp.width;
      c.height = vp.height;
    }
    gl.viewport(0, 0, vp.width, vp.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const yb = vp.height - vp.y - vp.h;
    gl.viewport(Math.round(vp.x), Math.round(yb), Math.round(vp.w), Math.round(vp.h));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.round(vp.x), Math.round(yb), Math.round(vp.w), Math.round(vp.h));

    const L = cardLayout(s);
    const sh = shadowLayout(s, L);
    const px = s.W / vp.w; // frame units per device pixel

    // backdrop + shadow
    gl.disable(gl.BLEND);
    const P = this.scene;
    gl.useProgram(P.p);
    const u = P.u;
    gl.uniform2f(u.uFrame, s.W, s.H);
    setBg(gl, u, 'A', s.bgA);
    setBg(gl, u, 'B', s.bgB || s.bgA);
    gl.uniform1f(u.uMix, s.bgMix ?? 0);
    const rad = L.radius;
    const key = insetQuad(sh.key, Math.min(rad, L.w * 0.3));
    const amb = insetQuad(sh.amb, Math.min(rad, L.w * 0.3));
    gl.uniform2fv(u.uKey, key.flat());
    gl.uniform2fv(u.uAmb, amb.flat());
    gl.uniform4f(u.uShadow, sh.keySigma, sh.keyAlpha, sh.ambSigma, sh.ambAlpha);
    gl.uniform2f(u.uRad, Math.min(rad, L.w * 0.3), Math.min(rad, L.w * 0.3));
    gl.uniform1f(u.uGrain, s.grain || 0);
    gl.uniform1f(u.uChecker, opts.checker ? 1 : 0);
    gl.uniform1f(u.uSeed, opts.seed || 0);
    gl.uniform1f(u.uPx, Math.max(px, 1e-3));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!this.texW) return;
    // card
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const C = this.card;
    gl.useProgram(C.p);
    const v = C.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(v.uTex, 0);
    gl.uniform2f(v.uFrame, s.W, s.H);
    gl.uniform2f(v.uCard, L.w, L.h);
    gl.uniform2f(v.uCenter, L.cx, L.cy);
    gl.uniform2f(v.uExpand, (3 * px) / L.w, (3 * px) / L.h);
    gl.uniformMatrix3fv(v.uRot, false, L.m);
    gl.uniform1f(v.uD, L.D);
    gl.uniform1f(v.uLiftZ, L.lift * L.big * 0.05);
    gl.uniform1f(v.uRadius, rad);
    gl.uniform1f(v.uAA, Math.max(px, 1e-3));
    gl.uniform3f(v.uN, L.m[6], L.m[7], L.m[8]);
    const lz = Math.max(s.W, s.H) * 1.05;
    gl.uniform3f(v.uLight, (s.lightX ?? 0.25) * s.W - L.cx, (s.lightY ?? 0.2) * s.H - L.cy, lz);
    gl.uniform3f(v.uCam, 0, 0, L.D);
    gl.uniform1f(v.uGlare, s.glare ?? 0.5);
    gl.uniform1f(v.uSheen, -0.55 + (s.tiltY || 0) * -0.012 + (s.tiltX || 0) * 0.008 + ((s.lightX ?? 0.25) - 0.5) * 0.35);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

function setBg(gl, u, X, b) {
  const stops = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  b.stops.slice(0, 3).forEach((c, i) => stops.splice(i * 3, 3, c[0], c[1], c[2]));
  const geo = new Array(16).fill(1);
  const col = new Array(12).fill(0);
  b.blobs.slice(0, 4).forEach((o, i) => {
    geo.splice(i * 4, 4, o.x, o.y, o.rx, o.ry);
    col.splice(i * 3, 3, o.rgb[0], o.rgb[1], o.rgb[2]);
  });
  gl.uniform4f(u[`u${X}meta`], b.alpha, b.stops.length, (b.angle * Math.PI) / 180, Math.min(4, b.blobs.length));
  gl.uniform3fv(u[`u${X}stops`], stops);
  gl.uniform4fv(u[`u${X}geo`], geo);
  gl.uniform3fv(u[`u${X}col`], col);
}
