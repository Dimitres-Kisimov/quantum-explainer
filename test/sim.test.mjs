/*
 * test/sim.test.mjs — plain-Node test harness for sim.js (no framework).
 * Run:  node test/sim.test.mjs
 * Exit code 0 only if every assertion passes.
 */
import Q from '../sim.js';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log('ok  - ' + msg); }
  else { fail++; failures.push(msg); console.error('FAIL - ' + msg); }
}
const approx = (a, b, eps = 1e-10) => Math.abs(a - b) <= eps;
const P = Math.PI;
const H0 = { gate: 'H', target: 0 };
const CN01 = { gate: 'CNOT', control: 0, target: 1 };

/* ---------- basics ---------- */
{
  const s = Q.zeroState(1);
  ok(approx(s[0].re, 1) && approx(s[0].im, 0) && approx(s[1].re, 0) && approx(Q.norm(s), 1),
     'zeroState(1) is |0> with norm 1');
}

/* ---------- H creates an equal superposition ---------- */
{
  const s = Q.runOps([H0], 1);
  const p = Q.probabilities(s);
  ok(approx(p[0], 0.5), 'H|0>: P(0) = 0.5 (within 1e-10)');
  ok(approx(p[1], 0.5), 'H|0>: P(1) = 0.5 (within 1e-10)');
  ok(approx(s[0].re, Math.SQRT1_2) && approx(s[1].re, Math.SQRT1_2) &&
     approx(s[0].im, 0) && approx(s[1].im, 0),
     'H|0> amplitudes are both 1/sqrt(2), real');
}

/* ---------- interference: H twice returns |0> ---------- */
{
  const s = Q.runOps([H0, H0], 1);
  const p = Q.probabilities(s);
  ok(approx(p[0], 1), 'H·H|0> = |0>: P(0) = 1 (constructive interference)');
  ok(approx(Q.cabs(s[1]), 0), 'H·H|0>: amplitude of |1> is 0 (paths cancel: 1/2 - 1/2)');
}

/* ---------- X is a bit flip ---------- */
{
  const s1 = Q.applyOp(Q.zeroState(1), { gate: 'X', target: 0 });
  ok(approx(Q.probabilities(s1)[1], 1), 'X|0> = |1>');
  const s0 = Q.applyOp(s1, { gate: 'X', target: 0 });
  ok(approx(Q.probabilities(s0)[0], 1), 'X|1> = |0>');
}

/* ---------- phases: HZH = X ; S^2 = Z ; T^2 = S ---------- */
{
  const s = Q.runOps([H0, { gate: 'Z', target: 0 }, H0], 1);
  ok(approx(Q.probabilities(s)[1], 1), 'H·Z·H|0> = |1> (a hidden phase flips the outcome)');

  const plus = Q.runOps([H0], 1);
  const ss = Q.applyOp(Q.applyOp(plus, { gate: 'S', target: 0 }), { gate: 'S', target: 0 });
  const z = Q.applyOp(plus, { gate: 'Z', target: 0 });
  ok(approx(Q.fidelity(ss, z), 1), 'S·S = Z on |+> (fidelity 1)');

  const tt = Q.applyOp(Q.applyOp(plus, { gate: 'T', target: 0 }), { gate: 'T', target: 0 });
  const sgate = Q.applyOp(plus, { gate: 'S', target: 0 });
  ok(approx(Q.fidelity(tt, sgate), 1), 'T·T = S on |+> (fidelity 1)');
}

/* ---------- Y ---------- */
{
  const s = Q.applyOp(Q.zeroState(1), { gate: 'Y', target: 0 });
  ok(approx(s[1].im, 1) && approx(s[1].re, 0) && approx(Q.cabs(s[0]), 0), 'Y|0> = i|1>');
}

/* ---------- rotations ---------- */
{
  const rx = Q.applyOp(Q.zeroState(1), { gate: 'RX', target: 0, angle: P });
  ok(approx(Q.probabilities(rx)[1], 1), 'RX(pi)|0> measures as |1>');

  const ry = Q.applyOp(Q.zeroState(1), { gate: 'RY', target: 0, angle: P });
  const x = Q.applyOp(Q.zeroState(1), { gate: 'X', target: 0 });
  ok(approx(Q.fidelity(ry, x), 1), 'RY(pi)|0> = X|0> up to global phase (fidelity 1)');
  ok(approx(Q.probabilities(ry)[1], 1), 'RY(pi)|0>: P(1) = 1');

  const ry2 = Q.applyOp(Q.zeroState(1), { gate: 'RY', target: 0, angle: P / 2 });
  const p2 = Q.probabilities(ry2);
  ok(approx(p2[0], 0.5) && approx(p2[1], 0.5), 'RY(pi/2)|0> gives 50/50');

  const plus = Q.runOps([H0], 1);
  const rz = Q.applyOp(plus, { gate: 'RZ', target: 0, angle: P });
  const minus = Q.applyOp(Q.applyOp(Q.zeroState(1), { gate: 'X', target: 0 }), H0); // H|1> = |->
  ok(approx(Q.fidelity(rz, minus), 1), 'RZ(pi)|+> = |-> up to global phase (fidelity 1)');
  const prz = Q.probabilities(rz);
  ok(approx(prz[0], 0.5) && approx(prz[1], 0.5), 'RZ leaves |+> probabilities at 50/50 (phase-only)');
}

/* ---------- Bell state: H then CNOT ---------- */
{
  const bell = Q.runOps([H0, CN01], 2);
  const p = Q.probabilities(bell);
  ok(approx(p[0], 0.5), 'Bell: P(00) = 0.5');
  ok(approx(p[3], 0.5), 'Bell: P(11) = 0.5');
  ok(approx(p[1], 0) && approx(p[2], 0), 'Bell: P(01) = P(10) = 0');
  ok(approx(Q.cabs(Q.productDet(bell)), 0.5), 'Bell non-factorable: |a00*a11 - a01*a10| = 0.5 (not 0)');
  ok(approx(Q.concurrence(bell), 1) && Q.isEntangled(bell), 'Bell concurrence = 1 (maximally entangled)');
}

/* ---------- product states stay factorable ---------- */
{
  const hh = Q.runOps([H0, { gate: 'H', target: 1 }], 2);
  ok(approx(Q.concurrence(hh), 0) && !Q.isEntangled(hh), 'H(x)H|00> is a product state (det = 0)');

  const viaTensor = Q.tensor(Q.runOps([H0], 1), Q.zeroState(1));
  const viaOp = Q.runOps([H0], 2);
  ok(approx(Q.fidelity(viaTensor, viaOp), 1), 'tensor(H|0>,|0>) matches H-on-q0 of |00> (fidelity 1)');
}

/* ---------- CNOT truth table + uncompute ---------- */
{
  const s10 = Q.runOps([{ gate: 'X', target: 0 }], 2);            // |10>
  ok(approx(Q.probabilities(Q.applyOp(s10, CN01))[3], 1), 'CNOT(0->1): |10> -> |11>');

  const s01 = Q.runOps([{ gate: 'X', target: 1 }], 2);            // |01>
  const flipped = Q.applyOp(s01, { gate: 'CNOT', control: 1, target: 0 });
  ok(approx(Q.probabilities(flipped)[3], 1), 'CNOT(1->0): |01> -> |11>');

  const back = Q.runOps([H0, CN01, CN01, H0], 2);
  ok(approx(Q.fidelity(back, Q.zeroState(2)), 1), 'uncompute: H,CNOT,CNOT,H returns |00> (fidelity 1)');
}

/* ---------- unitarity: norms preserved through a long circuit ---------- */
{
  const ops = [
    H0, { gate: 'T', target: 0 }, { gate: 'RX', target: 1, angle: 0.7 },
    { gate: 'S', target: 1 }, { gate: 'RY', target: 0, angle: 1.1 },
    CN01, { gate: 'RZ', target: 1, angle: 2.2 }, { gate: 'H', target: 1 },
  ];
  let s = Q.zeroState(2);
  let worst = 0;
  for (const op of ops) {
    s = Q.applyOp(s, op);
    worst = Math.max(worst, Math.abs(Q.norm(s) - 1));
  }
  ok(worst <= 1e-10, 'norm preserved at every step of an 8-gate circuit (drift ' + worst.toExponential(2) + ' <= 1e-10)');
}

/* ---------- seeded measurement ---------- */
{
  const plus = Q.runOps([H0], 1);
  const a = Q.measureShots(plus, 1000, 42);
  const b = Q.measureShots(plus, 1000, 42);
  ok(JSON.stringify(a.counts) === JSON.stringify(b.counts),
     'seeded shots reproducible: seed 42 twice -> identical counts (' + JSON.stringify(a.counts) + ')');
  ok(a.counts['0'] + a.counts['1'] === 1000, 'seeded shots: counts sum to 1000');
  ok(a.counts['0'] >= 400 && a.counts['0'] <= 600,
     'seeded shots: H|0> seed 42 is near 50/50 (got ' + a.counts['0'] + '/' + a.counts['1'] + ')');
  const d = Q.measureShots(plus, 1000, 7);
  ok(JSON.stringify(d.counts) !== JSON.stringify(a.counts),
     'different seed (7) gives a different sample (' + JSON.stringify(d.counts) + ')');

  const bell = Q.runOps([H0, CN01], 2);
  const bs = Q.measureShots(bell, 1000, 7);
  ok(bs.counts['01'] === 0 && bs.counts['10'] === 0 &&
     bs.counts['00'] + bs.counts['11'] === 1000,
     'Bell shots: only 00/11 outcomes, perfectly correlated (' + JSON.stringify(bs.counts) + ')');
}

/* ---------- Bloch sphere ---------- */
{
  const b0 = Q.blochVector(Q.zeroState(1));
  ok(approx(b0.z, 1) && approx(b0.x, 0) && approx(b0.y, 0), 'blochVector(|0>) = +z pole');

  const bp = Q.blochVector(Q.runOps([H0], 1));
  ok(approx(bp.x, 1) && approx(bp.theta, P / 2) && approx(bp.phi, 0),
     'blochVector(H|0>) = +x (theta = pi/2, phi = 0)');

  const bi = Q.blochVector(Q.runOps([H0, { gate: 'S', target: 0 }], 1));
  ok(approx(bi.y, 1) && approx(bi.phi, P / 2), 'blochVector(S·H|0>) = +y (phi = pi/2)');
}

/* ---------- reduced Bloch vectors (entanglement shrinks the arrow) ---------- */
{
  const bell = Q.runOps([H0, CN01], 2);
  const r0 = Q.reducedBloch(bell, 0), r1 = Q.reducedBloch(bell, 1);
  ok(approx(r0.len, 0) && approx(r1.len, 0),
     'reducedBloch(Bell): both arrows have length 0 (each qubit alone is maximally mixed)');

  const prod = Q.runOps([H0], 2); // (H|0>) (x) |0>
  const p0 = Q.reducedBloch(prod, 0), p1 = Q.reducedBloch(prod, 1);
  ok(approx(p0.len, 1) && approx(p0.x, 1) && approx(p1.len, 1) && approx(p1.z, 1),
     'reducedBloch(H|0> (x) |0>): q0 on +x, q1 on +z, both length 1 (no entanglement)');
}

/* ---------- explainer strings (dynamic, honest numbers) ---------- */
{
  const pre = Q.zeroState(1);
  const post = Q.applyOp(pre, H0);
  ok(/superposition/.test(Q.describeStep(H0, pre, post)),
     'describeStep: H on |0> talks about superposition');

  const mid = Q.runOps([H0], 2);
  const bell = Q.applyOp(mid, CN01);
  const txt = Q.describeStep(CN01, mid, bell);
  ok(/0\.500/.test(txt) && /cannot/.test(txt),
     'describeStep: Bell CNOT shows the explicit 0.500 product check and says "cannot ... factor"');

  const plus = Q.runOps([H0], 1);
  const back = Q.applyOp(plus, H0);
  ok(/[Ii]nterference/.test(Q.describeStep(H0, plus, back)),
     'describeStep: second H reports interference');
}

/* ---------- amplitude phases (what the phase dials draw) ---------- */
{
  const deg = (a) => Q.carg(a) * 180 / Math.PI;
  ok(approx(deg(Q.c(1, 0)), 0), 'carg(1) = 0 deg (real positive points right)');
  ok(approx(deg(Q.c(0, 1)), 90), 'carg(i) = 90 deg');
  ok(approx(deg(Q.c(-1, 0)), 180), 'carg(-1) = 180 deg');
  ok(approx(deg(Q.c(0, -1)), -90), 'carg(-i) = -90 deg');

  const plus = Q.runOps([H0], 1);
  const minus = Q.applyOp(plus, { gate: 'Z', target: 0 });
  ok(approx(deg(minus[0]), 0) && approx(deg(minus[1]), 180),
     'Z on |+>: |1> amplitude phase flips to 180 deg, |0> stays at 0');
  const sp = Q.applyOp(plus, { gate: 'S', target: 0 });
  ok(approx(deg(sp[1]), 90), 'S on |+>: |1> amplitude phase is 90 deg');
  const rz = Q.applyOp(plus, { gate: 'RZ', target: 0, angle: P / 2 });
  ok(approx(deg(rz[0]), -45) && approx(deg(rz[1]), 45),
     'RZ(90 deg) on |+>: phases split to -45/+45 deg, magnitudes unchanged');
  ok(approx(Q.cabs(rz[0]), Math.SQRT1_2) && approx(Q.cabs(rz[1]), Math.SQRT1_2),
     'RZ(90 deg) on |+>: both magnitudes still 1/sqrt(2) (phase-only gate)');
}

/* ---------- intermediate states (what the step scrubber replays) ---------- */
{
  const hzh = [H0, { gate: 'Z', target: 0 }, H0];
  const states = [Q.zeroState(1)];
  for (const op of hzh) states.push(Q.applyOp(states[states.length - 1], op));
  ok(states.length === 4, 'scrubber invariant: N ops store N+1 states (start included)');
  ok(approx(Q.probabilities(states[1])[0], 0.5), 'H,Z,H after step 1: 50/50');
  ok(approx(states[2][1].re, -Math.SQRT1_2) && approx(states[2][1].im, 0),
     'H,Z,H after step 2 is |->: amp(|1>) = -0.707 (the hidden sign)');
  ok(approx(Q.probabilities(states[2])[1], 0.5),
     'after step 2 probabilities are still 50/50 (the phase is invisible to measurement)');
  ok(approx(Q.probabilities(states[3])[1], 1), 'after step 3 interference resolves to |1>');
  ok(approx(Q.fidelity(states[3], Q.runOps(hzh, 1)), 1),
     'stepping through op-by-op matches runOps end-to-end (fidelity 1)');
}

/* ---------- fractional gates (what the Bloch-sweep animation draws) ---------- */
{
  // a generic, unstructured start state to catch phase mistakes
  const generic = Q.runOps([H0, { gate: 'T', target: 0 }], 1);
  for (const op of [
    H0, { gate: 'X', target: 0 }, { gate: 'Y', target: 0 }, { gate: 'Z', target: 0 },
    { gate: 'S', target: 0 }, { gate: 'T', target: 0 },
    { gate: 'RX', target: 0, angle: 0.7 }, { gate: 'RY', target: 0, angle: -1.3 },
    { gate: 'RZ', target: 0, angle: 2.1 },
  ]) {
    ok(approx(Q.fidelity(Q.partialOp(generic, op, 0), generic), 1),
       'partialOp t=0 is the identity for ' + op.gate);
    ok(approx(Q.fidelity(Q.partialOp(generic, op, 1), Q.applyOp(generic, op)), 1),
       'partialOp t=1 matches applyOp up to global phase for ' + op.gate);
  }

  // partial RX is literally RX of the partial angle
  const half = Q.partialOp(Q.zeroState(1), { gate: 'RX', target: 0, angle: P / 2 }, 0.5);
  ok(approx(Q.fidelity(half, Q.applyOp(Q.zeroState(1), { gate: 'RX', target: 0, angle: P / 4 })), 1),
     'partialOp(RX(90 deg), t=0.5) = RX(45 deg)');

  // halfway through H, the Bloch vector is mid-sweep about the (x+z)/sqrt(2)
  // axis: Rodrigues gives (0.5, -1/sqrt(2), 0.5) from the +z pole
  const bh = Q.blochVector(Q.partialOp(Q.zeroState(1), H0, 0.5));
  ok(approx(bh.x, 0.5) && approx(bh.y, -Math.SQRT1_2) && approx(bh.z, 0.5),
     'partialOp(H, t=0.5) Bloch vector is (0.5, -0.707, 0.5) — mid-sweep, still length 1');

  // norm preserved at an arbitrary fraction
  ok(approx(Q.norm(Q.partialOp(generic, H0, 0.37)), 1),
     'partialOp preserves the norm at t=0.37');

  // CNOT: t=1 must be EXACTLY CNOT (phase-corrected), not just fidelity-1
  const mid = Q.runOps([H0], 2);
  const bellVia = Q.partialOp(mid, CN01, 1);
  const bell = Q.applyOp(mid, CN01);
  ok(bellVia.every((a, i) => approx(a.re, bell[i].re) && approx(a.im, bell[i].im)),
     'partialOp(CNOT, t=1) equals CNOT amplitude-for-amplitude (relative phase corrected)');
  ok(approx(Q.fidelity(Q.partialOp(mid, CN01, 0), mid), 1), 'partialOp(CNOT, t=0) is the identity');
  const plusplus = Q.runOps([H0, { gate: 'H', target: 1 }], 2);
  const cpp = Q.partialOp(plusplus, CN01, 1);
  const r0pp = Q.reducedBloch(cpp, 0);
  ok(approx(r0pp.x, 1) && approx(r0pp.len, 1),
     'partialOp(CNOT, t=1) on |++>: control stays exactly on +x (no stray control phase)');
  ok(approx(Q.norm(Q.partialOp(mid, CN01, 0.42)), 1), 'partial CNOT preserves the norm mid-sweep');
}

/* ---------- Deutsch's algorithm (1-bit Deutsch–Jozsa) + phase kickback ---------- */
{
  const names = ['constant-0', 'constant-1', 'balanced-id', 'balanced-not'];
  for (const name of names) {
    const o = Q.DEUTSCH_ORACLES[name];
    const r = Q.deutschRun(name);

    // 1) a single oracle query decides constant vs balanced, with certainty
    ok(r.verdict === o.kind, 'Deutsch ' + name + ': one query -> verdict "' + o.kind + '"');
    const p = Q.probabilities(r.state);
    if (o.kind === 'constant') {
      ok(approx(p[0] + p[1], 1) && approx(p[2] + p[3], 0),
         'Deutsch ' + name + ': input qubit measures 0 with certainty (P(q0=0) = 1)');
    } else {
      ok(approx(p[2] + p[3], 1) && approx(p[0] + p[1], 0),
         'Deutsch ' + name + ': input qubit measures 1 with certainty (P(q0=1) = 1)');
    }

    // 2) phase kickback: after the single oracle query the state is STILL a
    //    product state — the oracle imprinted a phase on the input, it did not
    //    entangle. True even when the oracle is literally a CNOT (balanced-id).
    const afterOracle = Q.runOps(Q.deutschCircuit(name).slice(0, -1), 2);
    ok(approx(Q.concurrence(afterOracle), 0) && !Q.isEntangled(afterOracle),
       'Deutsch ' + name + ': the oracle does NOT entangle (phase kickback, concurrence 0)');

    // 3) the kicked-back phase lands on q0: constant -> ±|+> (Bloch +x),
    //    balanced -> ±|−> (Bloch −x); the arrow stays full length (pure).
    const rq0 = Q.reducedBloch(afterOracle, 0);
    const expX = o.kind === 'constant' ? 1 : -1;
    ok(approx(rq0.x, expX) && approx(rq0.len, 1),
       'Deutsch ' + name + ': kickback puts q0 on ' + (expX > 0 ? '+x (|+>)' : '−x (|−>)') + ', length 1');

    // 4) the ancilla is handed back untouched in |−> (Bloch −x)
    const rq1 = Q.reducedBloch(afterOracle, 1);
    ok(approx(rq1.x, -1) && approx(rq1.len, 1),
       'Deutsch ' + name + ': ancilla returns to exactly |−> (untouched by the query)');

    // 5) honesty: the whole circuit uses only gates the simulator actually has
    ok(Q.deutschCircuit(name).every((op) => ['H', 'X', 'CNOT'].includes(op.gate)),
       'Deutsch ' + name + ': built only from H, X, CNOT (no hidden gate)');
  }

  // the four oracles really are two constant + two balanced
  const kinds = Object.values(Q.DEUTSCH_ORACLES).map((o) => o.kind);
  ok(kinds.filter((k) => k === 'constant').length === 2 &&
     kinds.filter((k) => k === 'balanced').length === 2,
     'Deutsch: exactly two constant and two balanced oracles are provided');

  // why one classical query is not enough: a constant and a balanced oracle can
  // agree on f(0) and only differ at f(1) — the quantum circuit still separates
  // them in a single query.
  const c0 = Q.DEUTSCH_ORACLES['constant-0'].table;
  const bid = Q.DEUTSCH_ORACLES['balanced-id'].table;
  ok(c0[0] === bid[0] && c0[1] !== bid[1],
     'Deutsch: constant-0 and balanced-id agree on f(0) but differ on f(1) (one classical query cannot tell them apart)');
}

/* ---------- summary ---------- */
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.error('Failures:'); failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
