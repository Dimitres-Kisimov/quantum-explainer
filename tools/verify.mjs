/*
 * tools/verify.mjs — structural + offline-guard checks for Quantum Explainer.
 * Run from the repo root:  node tools/verify.mjs
 *
 * Checks:
 *   1. manifest.webmanifest is valid JSON with the required PWA fields and
 *      every declared icon exists with the declared pixel size.
 *   2. Every path in sw.js PRECACHE exists on disk.
 *   3. Offline/copyright guard: no external assets anywhere in the app files
 *      (no src=/href= to http(s), no @import, no url(http...), no @font-face,
 *      no CDN hostnames, no fetch/XHR/WebSocket/beacon to remote URLs).
 *   4. Every local src=/href= reference in index.html resolves to a file.
 * Exit code 0 only if everything passes.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('ok  - ' + msg); }
  else { fail++; console.error('FAIL - ' + msg); }
};
const read = (p) => readFileSync(join(root, p), 'utf8');

/* ---------- 1. manifest ---------- */
let manifest = null;
try { manifest = JSON.parse(read('manifest.webmanifest')); } catch (e) { manifest = null; }
ok(manifest !== null, 'manifest.webmanifest parses as JSON');
if (manifest) {
  ok(manifest.name === 'Quantum Explainer', 'manifest name is "Quantum Explainer"');
  ok(typeof manifest.start_url === 'string' && typeof manifest.scope === 'string',
     'manifest has start_url and scope');
  ok(manifest.display === 'standalone', 'manifest display is standalone');
  ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3,
     'manifest declares ' + (manifest.icons || []).length + ' icons (>= 3)');
  const pngSize = (p) => {
    const b = readFileSync(join(root, p));
    return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20); // IHDR width x height
  };
  for (const icon of manifest.icons || []) {
    const exists = existsSync(join(root, icon.src));
    ok(exists, 'icon exists: ' + icon.src);
    if (exists && icon.src.endsWith('.png')) {
      const dim = pngSize(icon.src);
      ok(dim === icon.sizes, 'icon ' + icon.src + ' is ' + dim + ' (declared ' + icon.sizes + ')');
    }
  }
  const maskable = (manifest.icons || []).some((i) => i.purpose === 'maskable');
  ok(maskable, 'manifest includes a maskable icon');
}

/* ---------- 2. service worker precache ---------- */
const sw = read('sw.js');
const precacheBlock = sw.match(/PRECACHE\s*=\s*\[([\s\S]*?)\]/);
ok(!!precacheBlock, 'sw.js declares a PRECACHE list');
if (precacheBlock) {
  const entries = [...precacheBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  ok(entries.length >= 6, 'PRECACHE has ' + entries.length + ' entries (>= 6)');
  for (const e of entries) {
    const p = e === './' ? 'index.html' : e.replace(/^\.\//, '');
    ok(existsSync(join(root, p)), 'precached file exists: ' + e);
  }
  for (const must of ['./index.html', './styles.css', './app.js', './sim.js', './manifest.webmanifest']) {
    ok(entries.includes(must), 'PRECACHE covers the shell file ' + must);
  }
}
ok(/VERSION\s*=/.test(sw), 'sw.js has a VERSION for cache busting');

/* ---------- 3. offline / no-external-asset guard ---------- */
const APP_FILES = ['index.html', 'styles.css', 'app.js', 'sim.js', 'sw.js',
                   'manifest.webmanifest', 'icons/icon.svg'];
const GUARDS = [
  [/(src|href)\s*=\s*["']https?:/i, 'src=/href= to an external http(s) URL'],
  [/@import/i, 'CSS @import'],
  [/url\(\s*["']?https?:/i, 'CSS url(http...)'],
  [/@font-face/i, '@font-face (system fonts only)'],
  [/googleapis|gstatic|cdn\.|unpkg|jsdelivr|cloudflare|typekit|fontawesome|bootstrapcdn/i, 'CDN hostname'],
  [/fetch\(\s*["']https?:/i, 'fetch() to a remote URL'],
  [/XMLHttpRequest|WebSocket|sendBeacon|EventSource/i, 'network API (XHR/WS/beacon/SSE)'],
  [/<iframe/i, 'iframe embed'],
];
for (const f of APP_FILES) {
  const src = read(f);
  const hits = GUARDS.filter(([re]) => re.test(src)).map(([, label]) => label);
  ok(hits.length === 0, 'offline guard clean: ' + f + (hits.length ? '  << ' + hits.join('; ') : ''));
}

/* ---------- 4. index.html local references resolve ---------- */
const html = read('index.html');
const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1])
  .filter((u) => !u.startsWith('#') && !u.startsWith('data:') && !u.startsWith('mailto:'));
ok(refs.length >= 5, 'index.html references ' + refs.length + ' local files');
for (const r of refs) ok(existsSync(join(root, r)), 'referenced file exists: ' + r);
ok(/<meta charset="utf-8">/.test(html), 'index.html declares utf-8');
ok(/<meta name="viewport"/.test(html), 'index.html has a viewport meta');
ok(/rel="manifest"/.test(html), 'index.html links the manifest');
ok(/apple-touch-icon/.test(html), 'index.html links an apple-touch-icon');
ok(/Add to Home Screen/.test(html), 'index.html contains the iOS install hint');
ok(/What quantum computers are NOT/i.test(html), 'index.html contains the "What quantum computers are NOT" section');
for (const ref of ['1801.00862', '1905.09749', 'Nielsen', 'Preskill', 'learning\\.quantum\\.ibm\\.com']) {
  ok(new RegExp(ref).test(html), 'reference present in page: ' + ref.replace('\\\\', '\\'));
}

/* ---------- summary ---------- */
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
