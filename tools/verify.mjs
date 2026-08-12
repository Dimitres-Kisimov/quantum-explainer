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
 *   5. Design system: both theme token blocks parse, the visual-pass tokens
 *      exist, every text token pair meets WCAG AA (4.5:1) in BOTH themes
 *      (computed here from the hex values in styles.css, not eyeballed),
 *      the phase-hue wheel + interference motif are wired, all motion sits
 *      behind prefers-reduced-motion, and the sw cache version matches.
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
const APP_FILES = ['index.html', 'styles.css', 'app.js', 'sim.js', 'selftest.js', 'sw.js',
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
for (const id of ['scrubRow', 'stepPrev', 'stepNext', 'stepLatest', 'scrubLabel', 'stepRemove']) {
  ok(new RegExp('id="' + id + '"').test(html), 'step-scrubber control present: #' + id);
}
ok(/complex plane/.test(html), 'index.html explains the phase dials (complex plane)');
const appjs = read('app.js');
ok(/Q\.partialOp\(/.test(appjs), 'Bloch sweep animates via Q.partialOp (fractional gates)');
ok(/prefers-reduced-motion/.test(appjs), 'Bloch sweep respects prefers-reduced-motion');
ok(/removeOpAt\(/.test(appjs), 'single-step delete (removeOpAt) is wired up');
ok(/Deutsch/.test(html) && /phase kickback/i.test(html),
   'index.html teaches Deutsch\'s algorithm and phase kickback');
ok(/Q\.deutschCircuit\(/.test(appjs), 'app.js wires a Deutsch preset from Q.deutschCircuit');
ok(/Grover/.test(html) && /amplitude amplification/i.test(html),
   'index.html teaches Grover\'s search and amplitude amplification');
ok(/inverting every amplitude about their mean|inversion about the mean/i.test(html),
   'index.html explains diffusion as inversion about the mean');
ok(/quadratic/i.test(html) && /not a warehouse of records/.test(html),
   'index.html states Grover\'s honest scope (quadratic, oracle is a function)');
ok(/Q\.groverCircuit\(/.test(appjs), 'app.js wires the Grover presets from Q.groverCircuit');
const simjs = read('sim.js');
ok(/groverOracle/.test(simjs) && /groverDiffusion/.test(simjs) && /groverRun/.test(simjs),
   'sim.js composes the Grover oracle, diffusion and runner');
ok(!/GATES\.CZ|'CZ'/.test(simjs),
   'Grover adds no new gate primitive: CZ is composed, not defined');
ok(/[Ss]uperdense coding/.test(html) && /Bell measurement/i.test(html),
   'index.html teaches superdense coding and the Bell-measurement decode');
ok(/Holevo/.test(html) && /pre-shared|already share/i.test(html),
   'index.html states superdense coding\'s honest scope (Holevo bound, pre-shared entanglement)');
ok(/no-signalling/i.test(html) && /identical/.test(html),
   'index.html makes the no-signalling point (encoded counts identical to the plain Bell pair)');
ok(/Q\.superdenseCircuit\(/.test(appjs), 'app.js wires the superdense presets from Q.superdenseCircuit');
ok(/superdenseEncodeOps/.test(simjs) && /superdenseCircuit/.test(simjs) && /superdenseRun/.test(simjs),
   'sim.js composes the superdense encode, circuit and runner');

/* ---------- self-test harness (?selftest=1) ---------- */
const selftest = read('selftest.js');
ok(/src="selftest\.js"/.test(html), 'index.html loads selftest.js');
ok(/selftest=1|get\('selftest'\)/.test(appjs) && /QSelfTest/.test(appjs),
   'app.js wires the ?selftest=1 in-browser harness via QSelfTest');
ok(/globalThis\.QSelfTest/.test(selftest) && /function run\(/.test(selftest),
   'selftest.js exposes QSelfTest.run for the browser and Node');
ok(/require\('\.\/sim\.js'\)/.test(selftest) && /process\.exit/.test(selftest),
   'selftest.js is runnable as a Node gate (node selftest.js, exits non-zero on failure)');
ok(/isUnitary/.test(selftest) && /concurrence|productDet/.test(selftest),
   'selftest.js checks gate unitarity and Bell non-factorability against the real routines');
ok(/deutschRun|deutschCircuit/.test(selftest),
   'selftest.js exercises the Deutsch algorithm (browser + Node stay in sync)');
ok(/groverRun|groverCircuit/.test(selftest),
   'selftest.js exercises Grover\'s search (browser + Node stay in sync)');
ok(/superdenseRun|superdenseCircuit/.test(selftest),
   'selftest.js exercises superdense coding (browser + Node stay in sync)');
for (const ref of ['1801.00862', '1905.09749', 'Nielsen', 'Preskill', 'learning\\.quantum\\.ibm\\.com', 'Deutsch', 'Wiesner']) {
  ok(new RegExp(ref).test(html), 'reference present in page: ' + ref.replace('\\\\', '\\'));
}

/* ---------- 5. design system: theme tokens + AA contrast ---------- */
const css = read('styles.css');
const lightBlockM = css.match(/:root\s*\{([\s\S]*?)\}/);
const darkBlockM = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/);
ok(!!lightBlockM, 'styles.css defines the light (paper notebook) token block');
ok(!!darkBlockM, 'styles.css defines the dark (night lab) token block');
const tokensOf = (block) => {
  const t = {};
  for (const m of (block || '').matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) t[m[1]] = m[2].trim();
  return t;
};
const lightT = tokensOf(lightBlockM && lightBlockM[1]);
const darkT = tokensOf(darkBlockM && darkBlockM[1]);
for (const tok of ['accent-fill', 'on-accent', 'phase-l', 'phase-c', 'wire', 'baseline', 'fringe', 'serif']) {
  ok(tok in lightT, 'design token --' + tok + ' is defined');
}
const redefined = Object.keys(darkT).filter((k) => k in lightT).length;
ok(redefined >= 18, 'dark theme redefines the full color token set (' + redefined + ' tokens)');

/* WCAG AA, computed from the tokens themselves — the design's contract that
 * both themes are built with equal care. All checked pairs are used as
 * TEXT somewhere in the app, so the bar is 4.5:1, not the 3:1 graphics bar. */
const relLum = (hex) => {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const AA_PAIRS = [
  ['fg', 'panel'], ['muted', 'panel'], ['accent', 'panel'], ['accent2', 'panel'],
  ['fg', 'bg'], ['muted', 'bg'], ['on-accent', 'accent-fill'],
];
for (const [mode, T] of [['light', lightT], ['dark', Object.assign({}, lightT, darkT)]]) {
  for (const [a, b] of AA_PAIRS) {
    const isHex = (h) => /^#[0-9a-f]{6}$/i.test(h || '');
    const c = isHex(T[a]) && isHex(T[b]) ? contrast(T[a], T[b]) : 0;
    ok(c >= 4.5, mode + ' AA: --' + a + ' on --' + b + ' = ' + c.toFixed(2) + ':1 (>= 4.5)');
  }
}

/* the signature artifacts stay wired the way the design intends */
ok(/oklch\(var\(--phase-l\) var\(--phase-c\)/.test(appjs),
   'amplitude bars + dial arrows tint phase via the equal-loudness oklch wheel');
ok(/repeating-radial-gradient/.test(css) && /var\(--fringe\)/.test(css),
   'two-source interference motif present, contrast controlled by --fringe');
ok(/border-left: 2px solid var\(--baseline\)/.test(css),
   'bars grow from the shared 2px ink baseline');
ok(/@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.bar \.fill[^}]*transition/.test(css),
   'bar/toast/control motion lives inside the reduced-motion guard');
ok((css.match(/transition:/g) || []).length ===
   ((css.match(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}/) || [''])[0].match(/transition:/g) || []).length,
   'no transition is declared outside the reduced-motion guard');
ok(/max-width: 65ch/.test(css), 'lesson prose measures 65ch');
ok(/var\(--serif\)/.test(css), 'reading serif applied through the --serif token');
ok(/quantum-explainer-v9/.test(sw), 'sw.js cache is at v9 (visual pass shipped)');
const themeMetas = [...html.matchAll(/name="theme-color" content="(#[0-9a-f]{6})" media="\(prefers-color-scheme: (light|dark)\)"/g)];
ok(themeMetas.length === 2, 'index.html declares light + dark theme-color metas');
for (const m of themeMetas) {
  const want = (m[2] === 'light' ? lightT.bg : darkT.bg) || '';
  ok(m[1].toLowerCase() === want.toLowerCase(),
     'theme-color (' + m[2] + ') matches the --bg token ' + want);
}

/* ---------- summary ---------- */
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
