/*
 * sim.js — a tiny quantum state-vector simulator for 1 and 2 qubits.
 * Hand-written for Quantum Explainer (no dependencies, no frameworks).
 *
 * Conventions
 * -----------
 * - A state is an array of complex amplitudes {re, im} of length 2^n.
 * - Qubit 0 is the LEFT bit of the ket label: |q0 q1>, basis index = q0*2 + q1.
 * - All functions are pure: they return new states and never mutate inputs.
 * - Randomness is a seeded PRNG (mulberry32) so every "run" is reproducible.
 *   Real quantum hardware is not reproducible shot-by-shot; the seed is a
 *   teaching convenience, and the app says so.
 *
 * Works both as a browser classic script (exposes globalThis.QSim) and as a
 * CommonJS module for the Node test harness (test/sim.test.mjs).
 */
'use strict';

const QSim = (() => {

  /* ---------------- complex numbers ---------------- */
  const c = (re, im) => ({ re: re, im: im || 0 });
  const cadd = (a, b) => c(a.re + b.re, a.im + b.im);
  const csub = (a, b) => c(a.re - b.re, a.im - b.im);
  const cmul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  const cconj = (a) => c(a.re, -a.im);
  const cscale = (a, s) => c(a.re * s, a.im * s);
  const cabs2 = (a) => a.re * a.re + a.im * a.im;
  const cabs = (a) => Math.sqrt(cabs2(a));
  const carg = (a) => Math.atan2(a.im, a.re);

  /* ---------------- states ---------------- */
  const zeroState = (nQubits) => {
    const dim = 1 << nQubits;
    const s = new Array(dim);
    for (let i = 0; i < dim; i++) s[i] = c(i === 0 ? 1 : 0);
    return s;
  };
  const nQubitsOf = (state) => Math.round(Math.log2(state.length));
  const clone = (state) => state.map((a) => c(a.re, a.im));
  const tensor = (a, b) => {
    const out = [];
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++) out.push(cmul(a[i], b[j]));
    return out;
  };
  const norm = (state) => Math.sqrt(state.reduce((t, a) => t + cabs2(a), 0));
  const probabilities = (state) => state.map(cabs2);
  const bitstring = (i, n) => i.toString(2).padStart(n, '0');
  // |<s1|s2>| — 1 means "same state up to a global phase".
  const fidelity = (s1, s2) => {
    let acc = c(0);
    for (let i = 0; i < s1.length; i++) acc = cadd(acc, cmul(cconj(s1[i]), s2[i]));
    return cabs(acc);
  };
  // index of the basis state if the state (numerically) IS one, else -1.
  const basisIndexOf = (state, eps) => {
    const e = eps || 1e-9;
    for (let i = 0; i < state.length; i++) if (cabs2(state[i]) > 1 - e) return i;
    return -1;
  };

  /* ---------------- gate matrices (2x2, row major) ---------------- */
  const R2 = Math.SQRT1_2; // 1/sqrt(2)
  const GATES = {
    H: [[c(R2), c(R2)], [c(R2), c(-R2)]],
    X: [[c(0), c(1)], [c(1), c(0)]],
    Y: [[c(0), c(0, -1)], [c(0, 1), c(0)]],
    Z: [[c(1), c(0)], [c(0), c(-1)]],
    S: [[c(1), c(0)], [c(0), c(0, 1)]],
    T: [[c(1), c(0)], [c(0), c(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4))]],
  };
  const RX = (t) => {
    const h = t / 2;
    return [[c(Math.cos(h)), c(0, -Math.sin(h))], [c(0, -Math.sin(h)), c(Math.cos(h))]];
  };
  const RY = (t) => {
    const h = t / 2;
    return [[c(Math.cos(h)), c(-Math.sin(h))], [c(Math.sin(h)), c(Math.cos(h))]];
  };
  const RZ = (t) => {
    const h = t / 2;
    return [[c(Math.cos(h), -Math.sin(h)), c(0)], [c(0), c(Math.cos(h), Math.sin(h))]];
  };
  const ROTATIONS = { RX: RX, RY: RY, RZ: RZ };

  /* ---------------- applying gates ---------------- */
  // Apply a 2x2 matrix m to `target` (0-based, qubit 0 = left bit).
  function applySingle(state, m, target) {
    const n = nQubitsOf(state);
    const mask = 1 << (n - 1 - target);
    const out = clone(state);
    for (let i = 0; i < state.length; i++) {
      if ((i & mask) !== 0) continue;
      const j = i | mask;
      const a0 = state[i], a1 = state[j];
      out[i] = cadd(cmul(m[0][0], a0), cmul(m[0][1], a1));
      out[j] = cadd(cmul(m[1][0], a0), cmul(m[1][1], a1));
    }
    return out;
  }

  // CNOT: flip `target` exactly in the branches where `control` is 1.
  function applyCNOT(state, control, target) {
    const n = nQubitsOf(state);
    const cm = 1 << (n - 1 - control);
    const tm = 1 << (n - 1 - target);
    const out = clone(state);
    for (let i = 0; i < state.length; i++) out[i] = (i & cm) ? state[i ^ tm] : state[i];
    return out;
  }

  // op: {gate:'H'|'X'|'Y'|'Z'|'S'|'T', target}
  //   | {gate:'RX'|'RY'|'RZ', target, angle}   (angle in radians)
  //   | {gate:'CNOT', control, target}
  function applyOp(state, op) {
    if (op.gate === 'CNOT') return applyCNOT(state, op.control, op.target);
    if (ROTATIONS[op.gate]) return applySingle(state, ROTATIONS[op.gate](op.angle || 0), op.target);
    const m = GATES[op.gate];
    if (!m) throw new Error('unknown gate: ' + op.gate);
    return applySingle(state, m, op.target);
  }
  const runOps = (ops, nQubits) => ops.reduce((s, op) => applyOp(s, op), zeroState(nQubits));

  /* ---------------- fractional gates (for the Bloch-sweep animation) ----
   * Every single-qubit gate here is a Bloch-sphere rotation: up to a global
   * phase, gate = exp(-i·angle/2 · axis·σ). axisAngleOf returns that
   * decomposition; rotationMatrix builds the partial rotation, so
   * partialOp(state, op, t) is the state t of the way (t ∈ [0,1]) through
   * applying op. At t = 1 it equals applyOp up to a global phase, which is
   * invisible to probabilities and to (reduced) Bloch vectors — exactly what
   * the animation draws. CNOT is not a single-qubit rotation; it animates as
   * a controlled partial X with the phase chosen so t = 1 is EXACTLY CNOT
   * (a relative phase between control branches would be physical, so it is
   * corrected, not ignored). */
  function axisAngleOf(op) {
    switch (op.gate) {
      case 'X': return { axis: [1, 0, 0], angle: Math.PI };
      case 'Y': return { axis: [0, 1, 0], angle: Math.PI };
      case 'Z': return { axis: [0, 0, 1], angle: Math.PI };
      case 'H': return { axis: [R2, 0, R2], angle: Math.PI };
      case 'S': return { axis: [0, 0, 1], angle: Math.PI / 2 };
      case 'T': return { axis: [0, 0, 1], angle: Math.PI / 4 };
      case 'RX': return { axis: [1, 0, 0], angle: op.angle || 0 };
      case 'RY': return { axis: [0, 1, 0], angle: op.angle || 0 };
      case 'RZ': return { axis: [0, 0, 1], angle: op.angle || 0 };
      default: return null; // CNOT: handled by partialOp directly
    }
  }
  // exp(-i·angle/2 · n·σ) = cos(angle/2)·I − i·sin(angle/2)·(n·σ)
  function rotationMatrix(axis, angle) {
    const h = angle / 2, ch = Math.cos(h), sh = Math.sin(h);
    const nx = axis[0], ny = axis[1], nz = axis[2];
    return [
      [c(ch, -sh * nz), c(-sh * ny, -sh * nx)],
      [c(sh * ny, -sh * nx), c(ch, sh * nz)],
    ];
  }
  function partialOp(state, op, t) {
    if (op.gate === 'CNOT') {
      const n = nQubitsOf(state);
      const cm = 1 << (n - 1 - op.control);
      const tm = 1 << (n - 1 - op.target);
      // e^{i·tπ/2}·RX(tπ) on the target in the control-1 branches: identity
      // at t = 0, exactly X (no stray phase) at t = 1.
      const ph = c(Math.cos(t * Math.PI / 2), Math.sin(t * Math.PI / 2));
      const m = rotationMatrix([1, 0, 0], t * Math.PI)
        .map((row) => row.map((e) => cmul(ph, e)));
      const out = clone(state);
      for (let i = 0; i < state.length; i++) {
        if ((i & tm) !== 0 || (i & cm) === 0) continue;
        const j = i | tm;
        const a0 = state[i], a1 = state[j];
        out[i] = cadd(cmul(m[0][0], a0), cmul(m[0][1], a1));
        out[j] = cadd(cmul(m[1][0], a0), cmul(m[1][1], a1));
      }
      return out;
    }
    const aa = axisAngleOf(op);
    if (!aa) throw new Error('unknown gate: ' + op.gate);
    return applySingle(state, rotationMatrix(aa.axis, aa.angle * t), op.target);
  }

  /* ---------------- measurement (seeded, reproducible) ---------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function sampleIndex(probs, r) {
    let acc = 0;
    for (let i = 0; i < probs.length; i++) {
      acc += probs[i];
      if (r < acc) return i;
    }
    return probs.length - 1; // guard against floating-point round-off
  }
  // Born rule sampling: outcome i with probability |amplitude_i|^2.
  function measureShots(state, shots, seed) {
    const n = nQubitsOf(state);
    const probs = probabilities(state);
    const rng = mulberry32(seed);
    const counts = {};
    for (let i = 0; i < (1 << n); i++) counts[bitstring(i, n)] = 0;
    for (let s = 0; s < shots; s++) counts[bitstring(sampleIndex(probs, rng()), n)]++;
    return { counts: counts, shots: shots, seed: seed };
  }

  /* ---------------- Bloch sphere ---------------- */
  // 1-qubit pure state -> Bloch vector (x,y,z) plus angles theta, phi.
  // x = 2 Re(a* b), y = 2 Im(a* b), z = |a|^2 - |b|^2  (phase-invariant).
  function blochVector(state) {
    const inner = cmul(cconj(state[0]), state[1]);
    const x = 2 * inner.re;
    const y = 2 * inner.im;
    const z = cabs2(state[0]) - cabs2(state[1]);
    const zc = Math.max(-1, Math.min(1, z));
    const theta = Math.acos(zc);
    const phi = (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) ? 0 : Math.atan2(y, x);
    return { x: x, y: y, z: z, theta: theta, phi: phi };
  }

  // Bloch vector of ONE qubit inside a 2-qubit state (partial trace).
  // Length 1 = pure (unentangled); length < 1 = mixed, i.e. entangled with
  // the other qubit. which: 0 = left qubit, 1 = right qubit.
  function reducedBloch(state, which) {
    const a00 = state[0], a01 = state[1], a10 = state[2], a11 = state[3];
    let rho01, z;
    if (which === 0) {
      rho01 = cadd(cmul(a00, cconj(a10)), cmul(a01, cconj(a11)));
      z = cabs2(a00) + cabs2(a01) - cabs2(a10) - cabs2(a11);
    } else {
      rho01 = cadd(cmul(a00, cconj(a01)), cmul(a10, cconj(a11)));
      z = cabs2(a00) + cabs2(a10) - cabs2(a01) - cabs2(a11);
    }
    const x = 2 * rho01.re;
    const y = -2 * rho01.im;
    return { x: x, y: y, z: z, len: Math.sqrt(x * x + y * y + z * z) };
  }

  /* ---------------- entanglement check (2 qubits) ---------------- */
  // A 2-qubit pure state factors as (alpha|0>+beta|1>) (x) (gamma|0>+delta|1>)
  // if and only if  a00*a11 - a01*a10 = 0.  (Rank-1 check on the 2x2
  // amplitude matrix.)  Concurrence = 2|det|: 0 = product, 1 = maximal.
  const productDet = (state) => csub(cmul(state[0], state[3]), cmul(state[1], state[2]));
  const concurrence = (state) => 2 * cabs(productDet(state));
  const isEntangled = (state, eps) => concurrence(state) > (eps || 1e-9);

  /* ---------------- Deutsch's algorithm (1-bit Deutsch–Jozsa) ----------------
   * The smallest program where a quantum computer beats a classical one, and a
   * clean demonstration of PHASE KICKBACK. You are handed f:{0,1}->{0,1} as a
   * black box and asked: is it CONSTANT (same output for both inputs) or
   * BALANCED (different)? Classically you must look at both f(0) and f(1) — two
   * queries. This circuit queries the oracle U_f exactly ONCE and then measures
   * the input qubit: 0 => constant, 1 => balanced, with certainty.
   *
   * q0 = input x, q1 = ancilla. The ancilla is prepared in |−>; the oracle map
   * |x>|y> -> |x>|y⊕f(x)> then only multiplies |−> by (−1)^f(x), so it stamps a
   * PHASE (−1)^f(x) onto the |x> branch and leaves the ancilla untouched
   * (kickback). Consequently the oracle never entangles the two qubits — not
   * even the f(x)=x oracle, which is literally a CNOT. Everything below is
   * COMPOSED from gates the simulator already has (H, X, CNOT) and run through
   * runOps; no new physics is defined here.
   *
   * HONEST SCOPE: with a single input bit the advantage is 1 query vs 2 — real
   * and exact, but modest. The famous EXPONENTIAL Deutsch–Jozsa separation needs
   * n input qubits (one query vs up to 2^{n-1}+1 classical) and more than the
   * two qubits this simulator models. What is verifiable here is the mechanism,
   * not a large separation.
   */
  const DEUTSCH_ORACLES = {
    'constant-0':   { label: 'f(x) = 0 (constant)',     kind: 'constant', table: [0, 0], ops: () => [] },
    'constant-1':   { label: 'f(x) = 1 (constant)',     kind: 'constant', table: [1, 1], ops: () => [{ gate: 'X', target: 1 }] },
    'balanced-id':  { label: 'f(x) = x (balanced)',     kind: 'balanced', table: [0, 1], ops: () => [{ gate: 'CNOT', control: 0, target: 1 }] },
    'balanced-not': { label: 'f(x) = NOT x (balanced)', kind: 'balanced', table: [1, 0], ops: () => [{ gate: 'CNOT', control: 0, target: 1 }, { gate: 'X', target: 1 }] },
  };
  // Full circuit for one oracle: prep (input |+>, ancilla |−>), the single
  // oracle query, then H on the input to interfere the kicked-back phases.
  function deutschCircuit(name) {
    const o = DEUTSCH_ORACLES[name];
    if (!o) throw new Error('unknown Deutsch oracle: ' + name);
    return [
      { gate: 'X', target: 1 },   // ancilla |0> -> |1>
      { gate: 'H', target: 0 },   // input   -> |+>
      { gate: 'H', target: 1 },   // ancilla -> |−>
      ...o.ops(),                 // U_f  (the one and only query)
      { gate: 'H', target: 0 },   // interfere: constant -> |0>, balanced -> |1>
    ];
  }
  // Run the circuit and read the verdict off the input qubit q0. Index into the
  // 2-qubit state is q0*2 + q1, so q0 = 1 is indices 2 and 3.
  function deutschRun(name) {
    const state = runOps(deutschCircuit(name), 2);
    const p = probabilities(state);
    const pOne = p[2] + p[3]; // marginal P(q0 = 1)
    return {
      name: name,
      oracle: DEUTSCH_ORACLES[name],
      verdict: pOne > 0.5 ? 'balanced' : 'constant',
      pOne: pOne,
      state: state,
    };
  }

  /* ---------------- Grover's search (2 qubits, amplitude amplification) ----
   * Unstructured search: one of N = 4 items (|00>..|11>) is secretly marked,
   * and the only tool is an ORACLE that answers a query by flipping the SIGN
   * of the marked item's amplitude. Classically, checking items one at a time
   * takes 2.25 queries on average (worst case 3) to find the mark among 4.
   * Grover's circuit takes ONE query — and n = 2 is the special case where a
   * single oracle-plus-diffusion iteration is EXACT: the marked item is then
   * measured with probability 1.
   *
   * Everything is COMPOSED from gates the simulator already has (H, X, CNOT);
   * no new physics is defined here. CZ = (I⊗H)·CNOT·(I⊗H) because H·X·H = Z —
   * exactly diag(1,1,1,−1), no stray phase. The oracle conjugates CZ by X's so
   * the −1 lands on the marked state; the diffusion is H⊗H·(flip the sign of
   * |00>)·H⊗H = −(2|s><s| − I), the textbook "inversion about the mean" times
   * a global phase of −1 that no measurement can see.
   *
   * Exact amplitudes for marked item m:
   *   after H⊗H          : all four +1/2                    (P = 25% each)
   *   after the oracle   : −1/2 on m, +1/2 elsewhere        (P STILL 25% each
   *                        — the mark is a phase, invisible on its own)
   *   after the diffusion: a -> 2·mean − a with mean = 1/4, so the marked
   *                        −1/2 -> 1 and the others 1/2 -> 0; the circuit
   *                        lands on −|m> (global −1), so P(m) = 1 exactly.
   * Running the iteration TWICE overshoots: P(m) drops back to 25% —
   * amplitude amplification is a rotation, not a monotone climb.
   *
   * HONEST SCOPE: in general Grover needs ~(π/4)·√N iterations — a QUADRATIC
   * speedup, provably optimal for black-box search, not exponential; and the
   * "database" is a function you can evaluate, not a warehouse of records.
   * What is verifiable here is the mechanism, not a large speedup.
   */
  const GROVER_ITEMS = ['00', '01', '10', '11'];
  const gH = (q) => ({ gate: 'H', target: q });
  const gX = (q) => ({ gate: 'X', target: q });
  // CZ from existing gates: H on the target turns CNOT's X into Z (H·X·H = Z).
  const czOps = () => [gH(1), { gate: 'CNOT', control: 0, target: 1 }, gH(1)];
  // Oracle O_m = diag(1,..,−1 at m,..,1): X's map |m> <-> |11>, CZ flips |11>,
  // the same X's map back. One call to this list = one query.
  function groverOracle(item) {
    if (GROVER_ITEMS.indexOf(item) < 0) throw new Error('unknown Grover item: ' + item);
    const flips = [];
    if (item.charAt(0) === '0') flips.push(0);
    if (item.charAt(1) === '0') flips.push(1);
    return [...flips.map(gX), ...czOps(), ...flips.map(gX)];
  }
  // Diffusion: H⊗H · (X⊗X·CZ·X⊗X = flip the sign of |00>) · H⊗H — inversion
  // about the mean, up to the overall −1 noted above.
  const groverDiffusion = () =>
    [gH(0), gH(1), gX(0), gX(1), ...czOps(), gX(0), gX(1), gH(0), gH(1)];
  // Full circuit: uniform superposition, then k oracle+diffusion iterations
  // (k defaults to 1 — exact on 2 qubits; k = 2 demonstrates the overshoot).
  function groverCircuit(item, iterations) {
    const k = iterations === undefined ? 1 : iterations;
    const ops = [gH(0), gH(1)];
    for (let i = 0; i < k; i++) ops.push(...groverOracle(item), ...groverDiffusion());
    return ops;
  }
  function groverRun(item, iterations) {
    const k = iterations === undefined ? 1 : iterations;
    const state = runOps(groverCircuit(item, k), 2);
    const index = parseInt(item, 2); // q0 is the left bit: index = q0·2 + q1
    return {
      item: item,
      index: index,
      iterations: k,
      state: state,
      pMarked: probabilities(state)[index],
    };
  }

  /* ---------------- superdense coding (2 classical bits via 1 sent qubit) --
   * Alice must deliver TWO classical bits to Bob but may transmit only ONE
   * qubit. A lone qubit cannot do that — a measurement yields at most one
   * classical bit (Holevo's bound). The way around is a resource prepared
   * earlier: a Bell pair the two ALREADY SHARE — q0 in Alice's hands, q1 in
   * Bob's.
   *
   *   share : H, CNOT               -> (|00> + |11>)/sqrt2   (in advance)
   *   encode: Alice, on q0 ONLY     -> X if the right message bit is 1,
   *                                    then Z if the left message bit is 1.
   *           The four results are exactly the four Bell states — mutually
   *           orthogonal, which is why two bits fit:
   *             00 -> (|00>+|11>)/sqrt2      01 -> (|01>+|10>)/sqrt2
   *             10 -> (|00>-|11>)/sqrt2      11 -> (|01>-|10>)/sqrt2
   *   send  : the qubit travels — transport, not a gate; nothing to compute.
   *   decode: Bob rotates the Bell basis onto the computational basis with
   *           CNOT then H (this simulator measures only in the 0/1 basis, so
   *           the "Bell measurement" is honestly BUILT that way, the standard
   *           construction) and measures both qubits: exactly |b0 b1>, with
   *           certainty — the final amplitude is +1 on the message state,
   *           not even a global phase left over.
   *
   * Everything is COMPOSED from gates the simulator already has (H, X, Z,
   * CNOT); no new physics is defined here.
   *
   * The honest heart of the protocol: Alice's encoding is LOCAL — she only
   * touches her own qubit — yet it steers the JOINT state between four
   * orthogonal states. Locally it is invisible: after any of the four
   * encodings each qubit alone is maximally mixed (reduced Bloch length 0),
   * and the phase-flip message even leaves the joint counts identical to the
   * untouched Bell pair. No signal moves until the qubit physically arrives
   * — entanglement plus local gates is not faster-than-light messaging.
   *
   * HONEST SCOPE: two qubits are used in total — one of them was shipped
   * ahead of time as shared entanglement, before the message existed.
   * Superdense coding doubles the classical capacity of the one qubit Alice
   * SENDS, given that resource; it does not pack two bits into an isolated
   * qubit and it does not beat Holevo's bound. What is verifiable here is
   * the mechanism, not a communication miracle.
   */
  const SUPERDENSE_MESSAGES = ['00', '01', '10', '11'];
  const gZ = (q) => ({ gate: 'Z', target: q });
  // Alice's local encoding: gates on q0 only — I, X, Z or Z·X. Maps the
  // shared pair onto the four Bell states, one per 2-bit message.
  function superdenseEncodeOps(message) {
    if (SUPERDENSE_MESSAGES.indexOf(message) < 0)
      throw new Error('unknown superdense message: ' + message);
    const ops = [];
    if (message.charAt(1) === '1') ops.push(gX(0));
    if (message.charAt(0) === '1') ops.push(gZ(0));
    return ops;
  }
  // Full protocol: share the Bell pair, encode locally, (send q0), decode via
  // the CNOT+H basis rotation. The first two ops are the share stage and the
  // last two the decode stage — the lesson and the tests slice on that.
  function superdenseCircuit(message) {
    return [
      gH(0), { gate: 'CNOT', control: 0, target: 1 },  // share (in advance)
      ...superdenseEncodeOps(message),                 // Alice: local, q0 only
      { gate: 'CNOT', control: 0, target: 1 }, gH(0),  // Bob: Bell measurement
    ];
  }
  function superdenseRun(message) {
    const state = runOps(superdenseCircuit(message), 2);
    const index = parseInt(message, 2); // q0 is the left bit: index = q0·2 + q1
    return {
      message: message,
      index: index,
      state: state,
      pMessage: probabilities(state)[index],
    };
  }

  /* ---------------- formatting ---------------- */
  const fmt = (x, d) => {
    const dd = (d === undefined) ? 3 : d;
    let v = x;
    if (Math.abs(v) < 0.5 * Math.pow(10, -dd)) v = 0; // avoid "-0.000"
    return v.toFixed(dd);
  };
  const fmtComplex = (a, d) => {
    const dd = (d === undefined) ? 3 : d;
    const re = Math.abs(a.re) < 0.5 * Math.pow(10, -dd) ? 0 : a.re;
    const im = Math.abs(a.im) < 0.5 * Math.pow(10, -dd) ? 0 : a.im;
    return fmt(re, dd) + (im < 0 ? ' - ' : ' + ') + fmt(Math.abs(im), dd) + 'i';
  };
  const degOf = (rad) => Math.round(rad * 180 / Math.PI);

  /* ---------------- per-step plain-language explainer ---------------- */
  // Honest, dynamic text: numbers come from the actual pre/post states.
  function describeStep(op, pre, post) {
    const n = nQubitsOf(post);
    const t = 'q' + op.target;
    const preBasis = basisIndexOf(pre);
    const postBasis = basisIndexOf(post);

    if (op.gate === 'H') {
      let s;
      if (preBasis >= 0) {
        s = 'H split ' + t + ' into an equal superposition: the |' + bitstring(preBasis, n) +
            '⟩ branch became two branches with amplitude 1/√2 ≈ 0.707 each. ' +
            'This is a definite state — only the measurement outcome is random (50/50 on ' + t + ').';
      } else if (postBasis >= 0) {
        s = 'Interference: H recombined the two branches and one path sum cancelled to zero, ' +
            'leaving the definite state |' + bitstring(postBasis, n) + '⟩.';
      } else {
        s = 'H recombined the branches of ' + t + ' — amplitudes were added and subtracted (interference).';
      }
      if (n === 1) {
        const p0 = cmul(c(R2), pre[0]);
        const p1 = cmul(c(R2), pre[1]);
        s += ' Path sums: amp(|0⟩) = 0.707·(' + fmtComplex(pre[0]) + ') + 0.707·(' +
             fmtComplex(pre[1]) + ') = ' + fmtComplex(cadd(p0, p1)) +
             ';  amp(|1⟩) = 0.707·(' + fmtComplex(pre[0]) + ') − 0.707·(' +
             fmtComplex(pre[1]) + ') = ' + fmtComplex(csub(p0, p1)) + '.';
      }
      return s;
    }
    if (op.gate === 'X') {
      return 'X swapped the |0⟩ and |1⟩ amplitudes of ' + t +
             ' — a classical NOT applied to the branch labels. Probabilities swap accordingly.';
    }
    if (op.gate === 'Y') {
      return 'Y flipped ' + t + ' like X and also multiplied the branches by ±i — ' +
             'a bit flip combined with a phase flip.';
    }
    if (op.gate === 'Z' || op.gate === 'S' || op.gate === 'T') {
      const deg = op.gate === 'Z' ? 180 : (op.gate === 'S' ? 90 : 45);
      return op.gate + ' rotated the phase of ' + t + '’s |1⟩ component by ' + deg +
             '°. Measurement probabilities are unchanged — a phase is invisible to a ' +
             'single measurement, but it decides how amplitudes add or cancel later (interference).';
    }
    if (op.gate === 'RX' || op.gate === 'RY' || op.gate === 'RZ') {
      const axis = op.gate.charAt(1).toLowerCase();
      let s = op.gate + '(' + degOf(op.angle || 0) + '°) rotated ' + t + ' by ' +
              degOf(op.angle || 0) + '° around the ' + axis + '-axis of the Bloch sphere.';
      if (op.gate === 'RZ') s += ' Phase-only: probabilities in the 0/1 basis are unchanged.';
      return s;
    }
    if (op.gate === 'CNOT') {
      const ctl = 'q' + op.control;
      const detPost = productDet(post);
      const magPre = cabs(productDet(pre));
      const magPost = cabs(detPost);
      let s = 'CNOT flipped ' + t + ' exactly in the branches where ' + ctl + ' is 1. ';
      const check = 'a₀₀·a₁₁ − a₀₁·a₁₀ = ' +
                    fmtComplex(detPost) + ' (magnitude ' + fmt(magPost) + ')';
      if (magPost > 1e-9 && magPre <= 1e-9) {
        s += 'That entangled the qubits. Product check: ' + check +
             ' ≠ 0, so the state cannot be written as (α|0⟩+β|1⟩)⊗(γ|0⟩+δ|1⟩). ' +
             'Neither qubit has a definite state of its own any more.';
      } else if (magPost <= 1e-9 && magPre > 1e-9) {
        s += 'That disentangled them: the product check ' + check + ' is back to 0, so the state factors again.';
      } else if (magPost > 1e-9) {
        s += 'The qubits remain entangled: product check ' + check + ' ≠ 0.';
      } else {
        s += 'The state is still a product state: ' + check + '.';
      }
      return s;
    }
    return op.gate + ' applied to ' + t + '.';
  }

  /* ---------------- exports ---------------- */
  return {
    // complex
    c: c, cadd: cadd, csub: csub, cmul: cmul, cconj: cconj, cscale: cscale,
    cabs: cabs, cabs2: cabs2, carg: carg,
    // states
    zeroState: zeroState, nQubitsOf: nQubitsOf, clone: clone, tensor: tensor,
    norm: norm, probabilities: probabilities, bitstring: bitstring,
    fidelity: fidelity, basisIndexOf: basisIndexOf,
    // gates
    GATES: GATES, RX: RX, RY: RY, RZ: RZ,
    applySingle: applySingle, applyCNOT: applyCNOT, applyOp: applyOp, runOps: runOps,
    axisAngleOf: axisAngleOf, rotationMatrix: rotationMatrix, partialOp: partialOp,
    // measurement
    mulberry32: mulberry32, sampleIndex: sampleIndex, measureShots: measureShots,
    // bloch + entanglement
    blochVector: blochVector, reducedBloch: reducedBloch,
    productDet: productDet, concurrence: concurrence, isEntangled: isEntangled,
    // Deutsch's algorithm (composed from the gates above; no new physics)
    DEUTSCH_ORACLES: DEUTSCH_ORACLES, deutschCircuit: deutschCircuit, deutschRun: deutschRun,
    // Grover's search (likewise composed from H, X, CNOT only)
    GROVER_ITEMS: GROVER_ITEMS, groverOracle: groverOracle,
    groverDiffusion: groverDiffusion, groverCircuit: groverCircuit, groverRun: groverRun,
    // superdense coding (likewise composed from H, X, Z, CNOT only)
    SUPERDENSE_MESSAGES: SUPERDENSE_MESSAGES, superdenseEncodeOps: superdenseEncodeOps,
    superdenseCircuit: superdenseCircuit, superdenseRun: superdenseRun,
    // formatting + explainer
    fmt: fmt, fmtComplex: fmtComplex, degOf: degOf, describeStep: describeStep,
  };
})();

/* Browser: expose global. Node (CommonJS): export for the test harness. */
if (typeof globalThis !== 'undefined') globalThis.QSim = QSim;
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') module.exports = QSim;
