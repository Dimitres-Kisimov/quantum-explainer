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
let measured = null;     // {index, state}: set by "Measure once" (collapse), cleared on any edit
let viewStep = null;     // step scrubber: null = follow the latest gate; 0..ops.length = view states[k]

let blochAnim = null;    // in-flight Bloch sweep {base, op, from, to, t0} — display only

const current = () => states[states.length - 1];
const shownStep = () => (viewStep === null ? ops.length : viewStep);
// What the state panels show: the circuit state at the scrubbed step (the
// latest by default), unless a single-shot measurement collapsed it — then
// the post-measurement basis state.
const displayState = () => (measured ? measured.state : states[shownStep()]);
const opsKey = () => JSON.stringify([nQubits, ops, measured ? measured.index : -1, shownStep()]);

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
    animateBloch(states[ops.length - 1], op, 0, 1);
  });
});
document.querySelectorAll('#cnotWrap .gatebtn').forEach((b) => {
  b.addEventListener('click', () => {
    const op = { gate: 'CNOT', control: Number(b.dataset.control), target: Number(b.dataset.target) };
    ops.push(op);
    recompute();
    animateBloch(states[ops.length - 1], op, 0, 1);
  });
});
$('undoBtn').addEventListener('click', () => {
  if (!ops.length) return;
  const removed = ops.pop();
  recompute();
  // sweep the removed gate backwards; its pre-state is the new final state
  animateBloch(states[ops.length], removed, 1, 0);
});
$('clearBtn').addEventListener('click', () => { if (ops.length) { ops = []; recompute(); } });

// Remove one gate mid-circuit (the × under its column, or the scrub-row
// button). Later gates are unaffected — they reapply to the recomputed state
// and the diagram renumbers.
function removeOpAt(k) {
  if (k < 0 || k >= ops.length) return;
  const label = opLabel(ops[k]);
  ops.splice(k, 1);
  recompute();
  toast('Removed step ' + (k + 1) + ' (' + label + ')' +
        (ops.length
          ? ' — ' + ops.length + ' gate' + (ops.length === 1 ? '' : 's') + ' left, later steps renumbered.'
          : ' — the circuit is now empty.'));
}
$('stepRemove').addEventListener('click', () => {
  if (viewStep !== null && viewStep > 0) removeOpAt(viewStep - 1);
});

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

/* ---------- Bloch sweep: animate a gate as the rotation it is ----------
 * partialOp (sim.js) gives the state t of the way through a gate, so the
 * arrow sweeps along the gate's actual rotation axis instead of teleporting
 * — RX/RY/RZ visibly rotate about x/y/z, H about the (x+z) diagonal, and a
 * CNOT sweeps the target flip in the control-1 branches. Display only: the
 * circuit state, tables, and seeded runs always use the exact final state,
 * and the last frame snaps to it. Skipped under prefers-reduced-motion. */
const ANIM_MS = 260;
function animateBloch(base, op, from, to) {
  blochAnim = null; // supersede any sweep still in flight
  // Land on the true state FIRST: the sweep only repaints frames over it, so
  // the panel is never stale even if animation frames don't run at all.
  drawBloch();
  const reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!op || reduced || (op.gate !== 'CNOT' && !Q.axisAngleOf(op))) return;
  const my = blochAnim = { base: base, op: op, from: from, to: to, t0: null };
  // safety net: if animation frames stall (hidden tab, throttled renderer),
  // land the sweep on the true state on the wall clock instead
  setTimeout(() => {
    if (blochAnim === my) { blochAnim = null; drawBloch(); }
  }, ANIM_MS + 80);
  requestAnimationFrame(function frame(now) {
    if (blochAnim !== my) return; // superseded or cancelled
    if (my.t0 === null) my.t0 = now;
    const f = Math.min(1, (now - my.t0) / ANIM_MS);
    const e = f * f * (3 - 2 * f); // smoothstep
    drawBloch(Q.partialOp(my.base, my.op, my.from + (my.to - my.from) * e));
    if (f < 1) requestAnimationFrame(frame);
    else { blochAnim = null; drawBloch(); } // land exactly on the true state
  });
}

/* ================= recompute + render ================= */
function recompute() {
  measured = null; // any edit discards a single-shot collapse
  viewStep = null; // ...and snaps the step scrubber back to the newest gate
  blochAnim = null; // ...and cancels any sweep still in flight
  states = [Q.zeroState(nQubits)];
  for (const op of ops) states.push(Q.applyOp(current(), op));
  renderCircuit();
  renderExplain();
  renderAmps();
  drawBloch();
  renderScrub();
  renderCollapse();
  renderHistPlaceholder();
}

/* ---------- step scrubber: replay the state after any gate ----------
 * recompute() already stores every intermediate state in states[]; viewStep
 * picks which one the State panel, Bloch sphere, and Measure panel look at
 * (null = follow the newest gate). Editing the circuit snaps back to latest.
 * Scrubbing discards a single-shot collapse — the collapsed state belonged
 * to the step that was showing when it was measured. */
function scrubTo(k) {
  const k0 = shownStep();
  viewStep = (k === null || k >= ops.length) ? null : Math.max(0, k);
  measured = null;
  const k1 = shownStep();
  renderCircuit();
  renderExplain();
  renderAmps();
  renderScrub();
  renderCollapse();
  renderHistPlaceholder();
  // stepping to an adjacent gate sweeps that gate (backwards for Prev);
  // longer jumps snap
  if (Math.abs(k1 - k0) === 1) {
    const lo = Math.min(k0, k1);
    animateBloch(states[lo], ops[lo], k1 > k0 ? 0 : 1, k1 > k0 ? 1 : 0);
  } else {
    blochAnim = null;
    drawBloch();
  }
}
function renderScrub() {
  const empty = ops.length === 0;
  $('scrubRow').hidden = empty;
  $('scrubHint').hidden = empty;
  if (empty) return;
  const k = shownStep();
  $('stepPrev').disabled = k === 0;
  $('stepNext').disabled = viewStep === null;
  $('stepLatest').disabled = viewStep === null;
  $('stepRemove').hidden = viewStep === null || viewStep === 0;
  if (viewStep !== null && viewStep > 0) {
    $('stepRemove').textContent = 'Remove step ' + viewStep;
    $('stepRemove').title = 'Delete ' + opLabel(ops[viewStep - 1]) + ' from the circuit';
  }
  $('scrubLabel').textContent = viewStep === null
    ? 'Showing: after step ' + ops.length + ' of ' + ops.length + ' (latest)'
    : (k === 0
        ? 'Showing: the start — ' + (nQubits === 1 ? '|0⟩' : '|00⟩') + ', nothing applied yet'
        : 'Showing: after step ' + k + ' of ' + ops.length + ' — ' + opLabel(ops[k - 1]));
}
$('stepPrev').addEventListener('click', () => scrubTo(shownStep() - 1));
$('stepNext').addEventListener('click', () => scrubTo(shownStep() + 1));
$('stepLatest').addEventListener('click', () => scrubTo(null));

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
  const h = nQubits * 54 + 26 + (ops.length ? 18 : 0); // bottom strip hosts the per-step × controls
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ops.length ? 'Circuit: ' + ops.map(opLabel).join(', ') : 'Empty circuit');
  const wireY = (q) => 40 + q * 54;
  let parent = svg; // helpers append here; per-op <g> groups swap it in
  const text = (x, y, str, cls, anchor) => {
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('class', cls);
    t.setAttribute('text-anchor', anchor || 'middle');
    t.textContent = str;
    parent.appendChild(t);
    return t;
  };
  const line = (x1, y1, x2, y2, cls) => {
    const l = document.createElementNS(SVGNS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('class', cls);
    parent.appendChild(l);
  };
  // scrubbed: a translucent band behind the column being viewed
  if (viewStep !== null && viewStep > 0) {
    const band = document.createElementNS(SVGNS, 'rect');
    band.setAttribute('x', x0 + (viewStep - 1) * colW - 20); band.setAttribute('y', 2);
    band.setAttribute('width', 40); band.setAttribute('height', h - 4);
    band.setAttribute('rx', 8);
    band.setAttribute('class', 'cstepband');
    svg.appendChild(band);
  }
  for (let q = 0; q < nQubits; q++) {
    text(8, wireY(q) + 4, 'q' + q + ' |0⟩', 'cketlbl', 'start');
    line(70, wireY(q), w - 8, wireY(q), 'cwire');
  }
  ops.forEach((op, k) => {
    const cx = x0 + k * colW;
    const g = document.createElementNS(SVGNS, 'g');
    // gates after the scrubbed step haven't "happened yet" in the viewed state
    g.setAttribute('class', 'copgroup' + (viewStep !== null && k >= viewStep ? ' future' : ''));
    svg.appendChild(g);
    parent = g;
    text(cx, 14, String(k + 1), 'cstep');
    if (op.gate === 'CNOT') {
      const yc = wireY(op.control), yt = wireY(op.target);
      line(cx, yc, cx, yt, 'cnotline');
      const dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', yc); dot.setAttribute('r', 5);
      dot.setAttribute('class', 'cnotdot');
      g.appendChild(dot);
      const ring = document.createElementNS(SVGNS, 'circle');
      ring.setAttribute('cx', cx); ring.setAttribute('cy', yt); ring.setAttribute('r', 10);
      ring.setAttribute('class', 'cnotring');
      g.appendChild(ring);
      line(cx, yt - 10, cx, yt + 10, 'cnotline');
      line(cx - 10, yt, cx + 10, yt, 'cnotline');
    } else {
      const y = wireY(op.target);
      const r = document.createElementNS(SVGNS, 'rect');
      r.setAttribute('x', cx - 17); r.setAttribute('y', y - 17);
      r.setAttribute('width', 34); r.setAttribute('height', 34);
      r.setAttribute('rx', 7);
      r.setAttribute('class', 'cbox');
      g.appendChild(r);
      const t = text(cx, y + 5, op.gate, 'cboxtext');
      if (op.gate.length > 1) t.setAttribute('style', 'font-size:11px');
      if (op.angle !== undefined) text(cx, y + 31, Q.degOf(op.angle) + '°', 'cangle');
    }
    // whole column is a click target: view the state right after this gate
    const hit = document.createElementNS(SVGNS, 'rect');
    hit.setAttribute('x', cx - colW / 2); hit.setAttribute('y', 0);
    hit.setAttribute('width', colW); hit.setAttribute('height', h);
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('class', 'cstephit');
    hit.setAttribute('data-step', k + 1);
    const tt = document.createElementNS(SVGNS, 'title');
    tt.textContent = 'View the state after step ' + (k + 1) + ' (' + opLabel(op) + ')';
    hit.appendChild(tt);
    hit.addEventListener('click', () => scrubTo(k + 1));
    g.appendChild(hit);
    // × in the bottom strip: delete just this step (drawn after the column
    // hit target, so it wins the click)
    const del = document.createElementNS(SVGNS, 'g');
    del.setAttribute('class', 'cdel');
    del.setAttribute('data-del', k + 1);
    const dtt = document.createElementNS(SVGNS, 'title');
    dtt.textContent = 'Remove step ' + (k + 1) + ' (' + opLabel(op) + ')';
    del.appendChild(dtt);
    const dring = document.createElementNS(SVGNS, 'circle');
    dring.setAttribute('cx', cx); dring.setAttribute('cy', h - 11); dring.setAttribute('r', 7);
    dring.setAttribute('class', 'cdelring');
    del.appendChild(dring);
    const dx = document.createElementNS(SVGNS, 'text');
    dx.setAttribute('x', cx); dx.setAttribute('y', h - 7.5);
    dx.setAttribute('class', 'cdeltext');
    dx.setAttribute('text-anchor', 'middle');
    dx.textContent = '×';
    del.appendChild(dx);
    del.addEventListener('click', () => removeOpAt(k));
    g.appendChild(del);
    parent = svg;
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
    if (viewStep !== null) {
      if (k + 1 === viewStep) li.className = 'viewing';
      else if (k + 1 > viewStep) li.className = 'future';
    }
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
/* Phase dial: one amplitude drawn as an arrow in the complex plane.
 * Length = magnitude (full radius = 1), angle = atan2(im, re): 0° points
 * right, counter-clockwise is positive — so the -0.707 on |1⟩ after H,Z
 * points left (180°). That is the invisible sign lesson 3 is about, made
 * visible: probabilities ignore the angle, interference does not.
 * data-deg / data-mag mirror the drawn values for tests and debugging. */
function phaseDial(a) {
  const mag = Q.cabs(a);
  const rad = Q.carg(a);
  const deg = Math.round(rad * 180 / Math.PI);
  const zero = mag < 5e-4; // below fmt()'s 3-decimal display threshold
  const dial = document.createElementNS(SVGNS, 'svg');
  dial.setAttribute('class', 'phasedial');
  dial.setAttribute('viewBox', '0 0 24 24');
  dial.setAttribute('role', 'img');
  dial.setAttribute('data-deg', String(deg));
  dial.setAttribute('data-mag', Q.fmt(mag, 2));
  dial.setAttribute('aria-label', zero ? 'amplitude 0'
    : 'phase ' + deg + ' degrees, magnitude ' + Q.fmt(mag, 2));
  const title = document.createElementNS(SVGNS, 'title');
  title.textContent = zero
    ? 'Amplitude 0 — this branch is empty'
    : 'This amplitude in the complex plane: phase ' + deg + '°, magnitude ' + Q.fmt(mag, 2);
  dial.appendChild(title);
  const ring = document.createElementNS(SVGNS, 'circle');
  ring.setAttribute('cx', 12); ring.setAttribute('cy', 12); ring.setAttribute('r', 10);
  ring.setAttribute('class', 'dialring');
  dial.appendChild(ring);
  const tick = document.createElementNS(SVGNS, 'line'); // 0° reference notch
  tick.setAttribute('x1', 22); tick.setAttribute('y1', 12);
  tick.setAttribute('x2', 19); tick.setAttribute('y2', 12);
  tick.setAttribute('class', 'dialtick');
  dial.appendChild(tick);
  if (zero) {
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('cx', 12); dot.setAttribute('cy', 12); dot.setAttribute('r', 1.6);
    dot.setAttribute('class', 'dialzero');
    dial.appendChild(dot);
  } else {
    const x2 = 12 + 10 * mag * Math.cos(rad);
    const y2 = 12 - 10 * mag * Math.sin(rad); // SVG y grows downward
    const arrow = document.createElementNS(SVGNS, 'line');
    arrow.setAttribute('x1', 12); arrow.setAttribute('y1', 12);
    arrow.setAttribute('x2', x2); arrow.setAttribute('y2', y2);
    arrow.setAttribute('class', 'dialarrow');
    dial.appendChild(arrow);
    const tip = document.createElementNS(SVGNS, 'circle');
    tip.setAttribute('cx', x2); tip.setAttribute('cy', y2); tip.setAttribute('r', 1.8);
    tip.setAttribute('class', 'dialtip');
    dial.appendChild(tip);
  }
  return dial;
}

function renderAmps() {
  const box = $('ampRows');
  box.textContent = '';
  const st = displayState();
  const n = Q.nQubitsOf(st);
  const probs = Q.probabilities(st);
  st.forEach((a, i) => {
    const row = document.createElement('div');
    row.className = 'amprow';
    const basis = document.createElement('span');
    basis.className = 'basis mono';
    basis.textContent = '|' + Q.bitstring(i, n) + '⟩';
    const dial = phaseDial(a);
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
    row.appendChild(basis); row.appendChild(dial); row.appendChild(amp); row.appendChild(bar); row.appendChild(pct);
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
/* sweepState: an intermediate state from animateBloch. drawBloch is also a
 * resize/theme listener, so anything that isn't a state array (e.g. an Event)
 * falls through to the real displayed state. */
function drawBloch(sweepState) {
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
  const st = Array.isArray(sweepState) ? sweepState : displayState();
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
    : 'Circuit or state changed — run again to sample the new state.';
  box.appendChild(p);
}
function readSeed() {
  const seedRaw = parseInt($('seed').value, 10);
  const seed = Number.isFinite(seedRaw) && seedRaw >= 0 ? seedRaw : 42;
  $('seed').value = seed;
  return seed;
}
function runShots() {
  const seed = readSeed();
  const res = Q.measureShots(displayState(), 1000, seed);
  lastRunOpsKey = opsKey();
  const box = $('hist');
  box.textContent = '';
  const n = Q.nQubitsOf(displayState());
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

/* ---------- measure ONCE: a single shot that collapses the state ----------
 * Lesson 2 says "the state then updates to match the answer; the superposition
 * is gone" — this demonstrates it. One sample via the Born rule, then the
 * shown state snaps to the outcome basis state. Repeated clicks re-measure the
 * collapsed state and (honestly) keep giving the same answer. Any circuit edit
 * or "Back to circuit state" restores the circuit output.
 * Draws come from a seeded PRNG (same seed field): reloading and repeating the
 * same clicks reproduces the same outcomes, consistent with the app's
 * reproducibility rule. */
let onceRng = null, onceSeed = null;
function measureOnce() {
  const seed = readSeed();
  if (!onceRng || seed !== onceSeed) { onceRng = Q.mulberry32(seed); onceSeed = seed; }
  const pre = displayState();
  const probs = Q.probabilities(pre);
  const idx = Q.sampleIndex(probs, onceRng());
  const post = pre.map((_, i) => Q.c(i === idx ? 1 : 0));
  const wasCollapsed = measured !== null;
  measured = { index: idx, state: post };
  renderAmps();
  drawBloch();
  renderCollapse(wasCollapsed);
  renderHistPlaceholder();
}
function renderCollapse(reMeasured) {
  const box = $('collapseBox');
  if (!measured) { box.hidden = true; $('collapseMsg').textContent = ''; return; }
  const n = Q.nQubitsOf(measured.state);
  const ket = '|' + Q.bitstring(measured.index, n) + '⟩';
  $('collapseMsg').textContent = reMeasured
    ? 'Measured again: ' + ket + ' — same answer, with certainty. A collapsed state has nothing left to be random about.'
    : 'One shot: got ' + ket + '. The state collapsed — all amplitude is now on ' + ket + ' and the superposition is gone. Measure again: the answer repeats.';
  box.hidden = false;
}
$('onceBtn').addEventListener('click', measureOnce);
$('uncollapseBtn').addEventListener('click', () => {
  if (!measured) return;
  measured = null;
  renderAmps();
  drawBloch();
  renderCollapse();
  renderHistPlaceholder();
});

/* ================= presets (lesson "try it" buttons) ================= */
const PRESETS = {
  plus:    { n: 1, ops: [{ gate: 'H', target: 0 }], run: false },
  measure: { n: 1, ops: [{ gate: 'H', target: 0 }], run: true },
  hh:      { n: 1, ops: [{ gate: 'H', target: 0 }, { gate: 'H', target: 0 }], run: false },
  hzh:     { n: 1, ops: [{ gate: 'H', target: 0 }, { gate: 'Z', target: 0 }, { gate: 'H', target: 0 }], run: false },
  bell:    { n: 2, ops: [{ gate: 'H', target: 0 }, { gate: 'CNOT', control: 0, target: 1 }], run: true },
  // Deutsch's algorithm — the op lists come straight from the simulator so the
  // playground runs the exact circuit the tests verify. balanced-id's oracle is
  // a CNOT that (via phase kickback) leaves the state a product state.
  'deutsch-balanced': { n: 2, ops: Q.deutschCircuit('balanced-id'), run: true },
  'deutsch-constant': { n: 2, ops: Q.deutschCircuit('constant-1'), run: true },
  // Grover's search — likewise the exact op lists the tests verify. One
  // iteration on 2 qubits is exact (all 1000 shots land on the marked item);
  // running it twice overshoots back to 25% — the lesson's honesty demo.
  'grover-10':        { n: 2, ops: Q.groverCircuit('10', 1), run: true },
  'grover-overshoot': { n: 2, ops: Q.groverCircuit('10', 2), run: true },
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

/* ================= self-test harness (?selftest=1) =================
 * A machine-checked proof, in this browser, that the quantum math the app
 * teaches is correct. It runs the portable suite in selftest.js against the
 * SAME QSim the app uses, reports PASS n/n on the page, and exposes the result
 * on window.__selftest / the <html data-selftest> attribute for headless checks.
 * Mirrors the flagship app's ?selftest=1 convention. Deterministic (seeded). */
function renderSelfTest() {
  const params = new URLSearchParams(location.search);
  const flag = params.get('selftest');
  if (flag !== '1' && flag !== 'true' && flag !== 'on') return;

  const res = (window.QSelfTest && window.QSelfTest.run)
    ? window.QSelfTest.run(Q)
    : { pass: 0, fail: 1, total: 1, allPass: false,
        results: [{ ok: false, msg: 'selftest.js (QSelfTest) failed to load' }] };

  const panel = document.createElement('section');
  panel.className = 'panel selftest ' + (res.allPass ? 'selftest-pass' : 'selftest-fail');
  panel.setAttribute('role', 'status');

  const h = document.createElement('h2');
  h.textContent = (res.allPass ? '✓ Self-test PASS ' : '✗ Self-test FAILED ') +
    res.pass + '/' + res.total;
  panel.appendChild(h);

  const lede = document.createElement('p');
  lede.className = 'small muted';
  lede.textContent = 'Every check below runs the real simulator (sim.js) live in this ' +
    'browser and asserts a known quantum fact. Deterministic: the only sampling uses a ' +
    'fixed seed. The exhaustive proof is the 154-assertion Node harness (test/sim.test.mjs); ' +
    'this is its portable core, so the math can be verified on any device with no tooling.';
  panel.appendChild(lede);

  const list = document.createElement('ol');
  list.className = 'selftest-list mono small';
  for (const r of res.results) {
    const li = document.createElement('li');
    li.className = r.ok ? 'st-ok' : 'st-fail';
    li.textContent = (r.ok ? 'ok   ' : 'FAIL ') + r.msg;
    list.appendChild(li);
  }
  panel.appendChild(list);

  const mainEl = document.querySelector('main');
  mainEl.insertBefore(panel, mainEl.firstChild);

  // Machine-readable hooks for headless verification / scripting.
  window.__selftest = res;
  const root = document.documentElement;
  root.setAttribute('data-selftest', res.allPass ? 'pass' : 'fail');
  root.setAttribute('data-selftest-score', res.pass + '/' + res.total);

  const summary = (res.allPass ? 'PASS ' : 'FAILED ') + res.pass + '/' + res.total;
  document.title = 'Self-test ' + summary + ' — Quantum Explainer';
  for (const r of res.results) console.log((r.ok ? 'ok  - ' : 'FAIL - ') + r.msg);
  console.log('Quantum Explainer self-test: ' + summary);
}

/* ================= init ================= */
updateAngleLabel();
recompute();
if (location.hash === '#learn') switchView('learn');
renderSelfTest();
})();
