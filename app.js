/*
 * app.js — UI for Quantum Explainer. All quantum math lives in sim.js (QSim),
 * which is unit-tested in Node; this file is DOM glue and drawing only.
 * Hand-written, no libraries, no network calls.
 */
(() => {
'use strict';
const Q = window.QSim;
const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

/* If sim.js failed to load (e.g. a partial deployment or a stale cache), fail
 * VISIBLY instead of dying silently with dead buttons. */
if (!Q) {
  const d = document.createElement('div');
  d.setAttribute('role', 'alert');
  d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99;background:#b91c1c;' +
    'color:#fff;padding:10px 14px;font:14px/1.4 system-ui,sans-serif;text-align:center';
  d.textContent = 'The simulator script failed to load - please hard-reload this page ' +
    '(Ctrl+Shift+R, or close and reopen the tab).';
  document.body.appendChild(d);
  return;
}

/* ================= playground state ================= */
let nQubits = 1;
let ops = [];            // [{gate, target, control?, angle?}]
let states = [Q.zeroState(1)];  // states[k] = state after k ops
const view = { yaw: -0.7, pitch: 0.42 }; // bloch camera
let lastRunOpsKey = null;

const current = () => states[states.length - 1];
const opsKey = () => JSON.stringify([nQubits, ops]);

/* ================= tabs ================= */
function switchView(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.view === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $('view-playground').hidden = name !== 'playground';
  $('view-learn').hidden = name !== 'learn';
  if (name === 'playground') drawBloch();
  if (history.replaceState) history.replaceState(null, '', name === 'learn' ? '#learn' : '#');
}
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => switchView(t.dataset.view));
});

/* ================= circuit editing ================= */
function angleRad() { return Number($('angle').value) * Math.PI / 180; }
function updateAngleLabel() {
  const deg = Number($('angle').value);
  $('angleLabel').textContent = deg + '° (' + (deg / 180).toFixed(2) + 'π)';
}
$('angle').addEventListener('input', updateAngleLabel);

function selectedTarget() {
  if (nQubits === 1) return 0;
  const r = document.querySelector('input[name="target"]:checked');
  return r ? Number(r.value) : 0;
}

document.querySelectorAll('#palette .gatebtn').forEach((b) => {
  b.addEventListener('click', () => {
    const gate = b.dataset.gate;
    const op = { gate: gate, target: selectedTarget() };
    if (gate === 'RX' || gate === 'RY' || gate === 'RZ') op.angle = angleRad();
    ops.push(op);
    recompute();
  });
});
document.querySelectorAll('#cnotWrap .gatebtn').forEach((b) => {
  b.addEventListener('click', () => {
    ops.push({ gate: 'CNOT', control: Number(b.dataset.control), target: Number(b.dataset.target) });
    recompute();
  });
});
$('undoBtn').addEventListener('click', () => { if (ops.length) { ops.pop(); recompute(); } });
$('clearBtn').addEventListener('click', () => { if (ops.length) { ops = []; recompute(); } });

document.querySelectorAll('input[name="nq"]').forEach((r) => {
  r.addEventListener('change', () => {
    const clearedGates = ops.length;
    nQubits = Number(r.value);
    ops = [];
    $('targetWrap').hidden = nQubits === 1;
    $('cnotWrap').hidden = nQubits === 1;
    recompute();
    if (clearedGates) {
      toast('Switched to ' + nQubits + ' qubit' + (nQubits === 1 ? '' : 's') +
            ' — the previous ' + clearedGates + '-gate circuit was cleared (fresh ' +
            (nQubits === 1 ? '|0⟩' : '|00⟩') + ' start).');
    }
  });
});

/* ---------- transient feedback toast ---------- */
let toastTimer = null;
function toast(msg) {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4500);
}

/* ================= recompute + render ================= */
function recompute() {
  states = [Q.zeroState(nQubits)];
  for (const op of ops) states.push(Q.applyOp(current(), op));
  renderCircuit();
  renderExplain();
  renderAmps();
  drawBloch();
  renderHistPlaceholder();
}

function opLabel(op) {
  if (op.gate === 'CNOT') return 'CNOT (control q' + op.control + ', target q' + op.target + ')';
  if (op.angle !== undefined) return op.gate + '(' + Q.degOf(op.angle) + '°) on q' + op.target;
  return op.gate + ' on q' + op.target;
}

/* ---------- circuit diagram (generated SVG) ---------- */
function renderCircuit() {
  const box = $('circuitBox');
  box.textContent = '';
  const colW = 48, x0 = 104;
  const w = Math.max(240, x0 + ops.length * colW + 16);
  const h = nQubits * 54 + 26;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ops.length ? 'Circuit: ' + ops.map(opLabel).join(', ') : 'Empty circuit');
  const wireY = (q) => 40 + q * 54;
  const text = (x, y, str, cls, anchor) => {
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('class', cls);
    t.setAttribute('text-anchor', anchor || 'middle');
    t.textContent = str;
    svg.appendChild(t);
    return t;
  };
  const line = (x1, y1, x2, y2, cls) => {
    const l = document.createElementNS(SVGNS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('class', cls);
    svg.appendChild(l);
  };
  for (let q = 0; q < nQubits; q++) {
    text(8, wireY(q) + 4, 'q' + q + ' |0⟩', 'cketlbl', 'start');
    line(70, wireY(q), w - 8, wireY(q), 'cwire');
  }
  ops.forEach((op, k) => {
    const cx = x0 + k * colW;
    text(cx, 14, String(k + 1), 'cstep');
    if (op.gate === 'CNOT') {
      const yc = wireY(op.control), yt = wireY(op.target);
      line(cx, yc, cx, yt, 'cnotline');
      const dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', yc); dot.setAttribute('r', 5);
      dot.setAttribute('class', 'cnotdot');
      svg.appendChild(dot);
      const ring = document.createElementNS(SVGNS, 'circle');
      ring.setAttribute('cx', cx); ring.setAttribute('cy', yt); ring.setAttribute('r', 10);
      ring.setAttribute('class', 'cnotring');
      svg.appendChild(ring);
      line(cx, yt - 10, cx, yt + 10, 'cnotline');
      line(cx - 10, yt, cx + 10, yt, 'cnotline');
    } else {
      const y = wireY(op.target);
      const r = document.createElementNS(SVGNS, 'rect');
      r.setAttribute('x', cx - 17); r.setAttribute('y', y - 17);
      r.setAttribute('width', 34); r.setAttribute('height', 34);
      r.setAttribute('rx', 7);
      r.setAttribute('class', 'cbox');
      svg.appendChild(r);
      const t = text(cx, y + 5, op.gate, 'cboxtext');
      if (op.gate.length > 1) t.setAttribute('style', 'font-size:11px');
      if (op.angle !== undefined) text(cx, y + 31, Q.degOf(op.angle) + '°', 'cangle');
    }
  });
  box.appendChild(svg);
}

/* ---------- per-step explanations ---------- */
function probSummary(state) {
  const n = Q.nQubitsOf(state);
  const p = Q.probabilities(state);
  const parts = [];
  for (let i = 0; i < p.length; i++)
    parts.push('|' + Q.bitstring(i, n) + '⟩ ' + (p[i] * 100).toFixed(1) + '%');
  return 'P: ' + parts.join(' · ');
}
function renderExplain() {
  const list = $('explainList');
  list.textContent = '';
  if (!ops.length) {
    const li = document.createElement('li');
    li.textContent = nQubits === 1
      ? 'Start: the qubit is |0⟩ (amplitude 1). Click a gate to begin.'
      : 'Start: the register is |00⟩ (amplitude 1). Click gates to begin.';
    list.appendChild(li);
    return;
  }
  ops.forEach((op, k) => {
    const li = document.createElement('li');
    const head = document.createElement('span');
    head.className = 'stepgate';
    head.textContent = opLabel(op) + ' — ';
    const body = document.createElement('span');
    body.textContent = Q.describeStep(op, states[k], states[k + 1]);
    const prob = document.createElement('span');
    prob.className = 'probline mono';
    prob.textContent = probSummary(states[k + 1]);
    li.appendChild(head); li.appendChild(body); li.appendChild(prob);
    list.appendChild(li);
  });
}

/* ---------- amplitudes + entanglement check ---------- */
function renderAmps() {
  const box = $('ampRows');
  box.textContent = '';
  const st = current();
  const n = Q.nQubitsOf(st);
  const probs = Q.probabilities(st);
  st.forEach((a, i) => {
    const row = document.createElement('div');
    row.className = 'amprow';
    const basis = document.createElement('span');
    basis.className = 'basis mono';
    basis.textContent = '|' + Q.bitstring(i, n) + '⟩';
    const amp = document.createElement('span');
    amp.className = 'amp mono';
    amp.textContent = Q.fmtComplex(a);
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = (probs[i] * 100).toFixed(2) + '%';
    bar.appendChild(fill);
    const pct = document.createElement('span');
    pct.className = 'pct mono';
    pct.textContent = (probs[i] * 100).toFixed(1) + '%';
    row.appendChild(basis); row.appendChild(amp); row.appendChild(bar); row.appendChild(pct);
    box.appendChild(row);
  });
  const ent = $('entCheck');
  if (n === 2) {
    const det = Q.productDet(st);
    const conc = Q.concurrence(st);
    ent.hidden = false;
    ent.textContent = 'Product check a₀₀·a₁₁ − a₀₁·a₁₀ = '
      + Q.fmtComplex(det) + ' → '
      + (Q.isEntangled(st) ? 'entangled (concurrence ' + Q.fmt(conc, 2) + ')' : 'not entangled (factors as a product)');
  } else {
    ent.hidden = true;
    ent.textContent = '';
  }
}

/* ================= Bloch sphere (canvas, drag to rotate) ================= */
function projFactory(w) {
  const cy0 = Math.cos(view.yaw), sy0 = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const cx = w / 2, cyc = w / 2, R = w / 2 - 26;
  return {
    R: R, cx: cx, cy: cyc,
    p: (x, y, z) => {
      const x1 = x * cy0 - y * sy0;
      const y1 = x * sy0 + y * cy0;
      const z2 = z * cp + y1 * sp;
      const depth = y1 * cp - z * sp;
      return { x: cx + R * x1, y: cyc - R * z2, front: depth <= 0 };
    },
  };
}
function strokeCircle3D(ctx, pr, fn, colFront, colBack) {
  // fn(t) -> [x,y,z]; draw front/back segments separately
  const N = 72;
  for (const front of [false, true]) {
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= N; i++) {
      const q = fn((i / N) * 2 * Math.PI);
      const s = pr.p(q[0], q[1], q[2]);
      if (s.front === front) {
        if (pen) ctx.lineTo(s.x, s.y); else { ctx.moveTo(s.x, s.y); pen = true; }
      } else pen = false;
    }
    ctx.strokeStyle = front ? colFront : colBack;
    ctx.stroke();
  }
}
function drawArrow(ctx, pr, v, color, label) {
  const tip = pr.p(v.x, v.y, v.z);
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  if (len < 0.03) { // maximally mixed: arrow collapses to the centre
    ctx.beginPath(); ctx.arc(pr.cx, pr.cy, 4.5, 0, 2 * Math.PI); ctx.fill();
  } else {
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pr.cx, pr.cy); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    const ang = Math.atan2(tip.y - pr.cy, tip.x - pr.cx);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - 10 * Math.cos(ang - 0.45), tip.y - 10 * Math.sin(ang - 0.45));
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - 10 * Math.cos(ang + 0.45), tip.y - 10 * Math.sin(ang + 0.45));
    ctx.stroke();
  }
  if (label) {
    ctx.font = '600 12px system-ui, sans-serif';
    const lx = len < 0.03 ? pr.cx + 8 : tip.x + 8;
    const ly = len < 0.03 ? pr.cy - 8 + (label === 'q1' ? 16 : 0) : tip.y - 6;
    ctx.fillText(label, lx, ly);
  }
}
function drawBloch() {
  const cvs = $('bloch');
  if (!cvs || $('view-playground').hidden) return;
  const rect = cvs.getBoundingClientRect();
  const w = Math.max(80, Math.round(rect.width));
  const dpr = window.devicePixelRatio || 1;
  if (cvs.width !== Math.round(w * dpr)) { cvs.width = Math.round(w * dpr); cvs.height = Math.round(w * dpr); }
  const ctx = cvs.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, w);
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  const mut = col('--muted'), fg = col('--fg'), acc = col('--accent'), acc2 = col('--accent2');
  const pr = projFactory(w);

  // sphere outline
  ctx.lineWidth = 1.4; ctx.strokeStyle = mut; ctx.globalAlpha = 0.65;
  ctx.beginPath(); ctx.arc(pr.cx, pr.cy, pr.R, 0, 2 * Math.PI); ctx.stroke();
  // great circles: equator + two meridians (front brighter than back)
  ctx.lineWidth = 1; ctx.globalAlpha = 1;
  const front = 'rgba(128,134,158,0.55)', back = 'rgba(128,134,158,0.18)';
  strokeCircle3D(ctx, pr, (t) => [Math.cos(t), Math.sin(t), 0], front, back);
  strokeCircle3D(ctx, pr, (t) => [Math.cos(t), 0, Math.sin(t)], front, back);
  strokeCircle3D(ctx, pr, (t) => [0, Math.cos(t), Math.sin(t)], front, back);
  // axes + labels
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = mut;
  const axes = [[1.02, 0, 0, 'x'], [0, 1.02, 0, 'y'], [0, 0, 1.02, '']];
  for (const a of axes) {
    const p1 = pr.p(a[0], a[1], a[2]);
    ctx.strokeStyle = mut; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pr.cx, pr.cy); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    ctx.globalAlpha = 1;
    if (a[3]) { const pl = pr.p(a[0] * 1.22, a[1] * 1.22, a[2] * 1.22); ctx.fillText(a[3], pl.x - 3, pl.y + 4); }
  }
  const top = pr.p(0, 0, 1.24), bot = pr.p(0, 0, -1.24);
  ctx.fillStyle = fg;
  ctx.fillText('|0⟩', top.x - 8, top.y);
  ctx.fillText('|1⟩', bot.x - 8, bot.y + 8);

  // state arrows — branch on the ACTUAL state length, never on the nQubits
  // flag, so a mid-update call (e.g. from switchView) can never read past
  // the end of a 1-qubit state.
  const st = current();
  if (st.length === 2) {
    const b = Q.blochVector(st);
    drawArrow(ctx, pr, b, acc, null);
    $('blochReadout').textContent =
      'θ = ' + (b.theta * 180 / Math.PI).toFixed(1) + '°,  φ = ' + (b.phi * 180 / Math.PI).toFixed(1) + '°';
    $('blochNote').textContent = '';
  } else {
    const r0 = Q.reducedBloch(st, 0), r1 = Q.reducedBloch(st, 1);
    drawArrow(ctx, pr, r0, acc, 'q0');
    drawArrow(ctx, pr, r1, acc2, 'q1');
    $('blochReadout').textContent =
      'q0 |r| = ' + Q.fmt(r0.len, 2) + '   ·   q1 |r| = ' + Q.fmt(r1.len, 2);
    $('blochNote').textContent =
      'Each arrow is one qubit’s reduced state (q0 indigo, q1 teal). Length 1 = pure; shorter = entangled with the other qubit — a maximally entangled pair collapses both arrows to the centre.';
  }
}
// drag to rotate
(() => {
  const cvs = $('bloch');
  let drag = null;
  cvs.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch };
    cvs.setPointerCapture(e.pointerId);
  });
  cvs.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.yaw = drag.yaw + (e.clientX - drag.x) * 0.012;
    view.pitch = Math.max(-1.35, Math.min(1.35, drag.pitch + (e.clientY - drag.y) * 0.012));
    drawBloch();
  });
  const end = () => { drag = null; };
  cvs.addEventListener('pointerup', end);
  cvs.addEventListener('pointercancel', end);
})();
window.addEventListener('resize', drawBloch);
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawBloch);
}

/* ================= measurement histogram ================= */
function renderHistPlaceholder() {
  const box = $('hist');
  box.textContent = '';
  const p = document.createElement('p');
  p.className = 'placeholder';
  p.textContent = lastRunOpsKey === null
    ? 'Run to sample the current state 1000 times.'
    : 'Circuit changed — run again to sample the new state.';
  box.appendChild(p);
}
function runShots() {
  const seedRaw = parseInt($('seed').value, 10);
  const seed = Number.isFinite(seedRaw) && seedRaw >= 0 ? seedRaw : 42;
  $('seed').value = seed;
  const res = Q.measureShots(current(), 1000, seed);
  lastRunOpsKey = opsKey();
  const box = $('hist');
  box.textContent = '';
  const n = Q.nQubitsOf(current());
  Object.keys(res.counts).sort().forEach((key) => {
    const count = res.counts[key];
    const row = document.createElement('div');
    row.className = 'histrow';
    const basis = document.createElement('span');
    basis.className = 'basis mono';
    basis.textContent = '|' + key + '⟩';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = (count / res.shots * 100).toFixed(2) + '%';
    bar.appendChild(fill);
    const cnt = document.createElement('span');
    cnt.className = 'cnt mono';
    cnt.textContent = count + ' (' + (count / res.shots * 100).toFixed(1) + '%)';
    row.appendChild(basis); row.appendChild(bar); row.appendChild(cnt);
    box.appendChild(row);
  });
  const note = document.createElement('p');
  note.className = 'placeholder';
  note.textContent = res.shots + ' shots, seed ' + res.seed + ' — same seed, same counts.';
  box.appendChild(note);
}
$('runBtn').addEventListener('click', runShots);

/* ================= presets (lesson "try it" buttons) ================= */
const PRESETS = {
  plus:    { n: 1, ops: [{ gate: 'H', target: 0 }], run: false },
  measure: { n: 1, ops: [{ gate: 'H', target: 0 }], run: true },
  hh:      { n: 1, ops: [{ gate: 'H', target: 0 }, { gate: 'H', target: 0 }], run: false },
  hzh:     { n: 1, ops: [{ gate: 'H', target: 0 }, { gate: 'Z', target: 0 }, { gate: 'H', target: 0 }], run: false },
  bell:    { n: 2, ops: [{ gate: 'H', target: 0 }, { gate: 'CNOT', control: 0, target: 1 }], run: true },
};
function loadPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  nQubits = p.n;
  document.querySelector('input[name="nq"][value="' + p.n + '"]').checked = true;
  $('targetWrap').hidden = nQubits === 1;
  $('cnotWrap').hidden = nQubits === 1;
  ops = p.ops.map((o) => Object.assign({}, o));
  // recompute BEFORE switchView: switchView draws the Bloch sphere, so the
  // states[] array must already match the new qubit count (the old order
  // crashed the bell preset from 1-qubit mode: drawBloch read state[2] of a
  // 2-element state).
  recompute();
  switchView('playground');
  if (p.run) runShots();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.trybtn').forEach((b) => {
  b.addEventListener('click', () => loadPreset(b.dataset.preset));
});

/* ================= PWA: install prompt + service worker ================= */
const installBtn = $('installBtn');
const setStatus = (t) => { $('swStatus').textContent = t; };
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => { deferredPrompt = null; installBtn.hidden = true; });
});
window.addEventListener('appinstalled', () => { installBtn.hidden = true; setStatus('Installed'); });
if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
  installBtn.hidden = true;
}
if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => setStatus('Offline ready'))
      .catch(() => {});
  });
}

/* ================= init ================= */
updateAngleLabel();
recompute();
if (location.hash === '#learn') switchView('learn');
})();
