/*
 * selftest.js — a portable correctness self-test for the quantum math in sim.js.
 *
 * WHY THIS EXISTS
 * ---------------
 * The exhaustive proof that the simulator is right is test/sim.test.mjs (run in
 * Node). But a teaching tool should also be able to prove — on the actual device
 * a learner is holding, in the actual browser engine that runs the lessons, with
 * zero tooling installed — that the math it teaches is correct. This file is that
 * portable core: a focused set of the headline guarantees, each one CALLING the
 * existing QSim routines (it does not re-implement any physics), so the same
 * assertions run in BOTH places:
 *
 *   - In the browser:  open the app with ?selftest=1  (app.js renders PASS n/n).
 *   - In Node (a gate): node selftest.js               (prints PASS n/n, exit 0/1).
 *
 * It is intentionally a subset of the 107-assertion Node harness, not a
 * replacement for it — the goal is a runtime, no-dependency sanity check a
 * learner (or a reviewer on a phone) can trust, not a second source of truth
 * for the physics. Everything here is deterministic: the only sampling uses a
 * fixed seed, and there is no wall-clock or unseeded randomness.
 *
 * Works as a browser classic script (reads globalThis.QSim, exposes
 * globalThis.QSelfTest) and as a CommonJS module for `node selftest.js`.
 */
'use strict';

(function () {
  const FIXED_SEED = 20260805; // deterministic: same counts every run, everywhere

  // Run the suite against a QSim instance (defaults to the global one the app
  // exposes). Returns a structured, machine-readable result.
  function run(Q) {
    Q = Q || (typeof globalThis !== 'undefined' ? globalThis.QSim : undefined);
    const results = [];
    const ok = (cond, msg) => { results.push({ ok: !!cond, msg: msg }); };

    if (!Q || typeof Q.runOps !== 'function') {
      ok(false, 'QSim simulator is available');
      return summarize(results);
    }

    const approx = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-10 : eps);
    const P = Math.PI;
    const H0 = { gate: 'H', target: 0 };
    const CN01 = { gate: 'CNOT', control: 0, target: 1 };

    // A 2x2 gate matrix U is unitary iff U^dagger U = I. Built from QSim's own
    // complex arithmetic and its own gate matrices — no re-derivation.
    const isUnitary = (m, eps) => {
      const e = eps === undefined ? 1e-12 : eps;
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          let acc = Q.c(0, 0);
          for (let k = 0; k < 2; k++) acc = Q.cadd(acc, Q.cmul(Q.cconj(m[k][i]), m[k][j]));
          const target = (i === j) ? Q.c(1, 0) : Q.c(0, 0);
          if (Q.cabs(Q.csub(acc, target)) > e) return false;
        }
      }
      return true;
    };
    const argDeg = (a) => Q.carg(a) * 180 / Math.PI;

    /* ---- normalization: a state vector's probabilities sum to 1 ---- */
    {
      const s0 = Q.zeroState(1);
      ok(approx(Q.norm(s0), 1), 'zeroState(1) is normalized: ||psi|| = 1');
      const sumP = Q.probabilities(s0).reduce((t, p) => t + p, 0);
      ok(approx(sumP, 1), 'probabilities of |0> sum to 1');
      // probability = |amplitude|^2, for every amplitude, on a generic state
      const g = Q.runOps([H0, { gate: 'T', target: 0 }], 1);
      const pg = Q.probabilities(g);
      ok(pg.every((p, i) => approx(p, Q.cabs2(g[i]))),
        'Born rule identity: probability_i = |amplitude_i|^2 for every basis state');
      ok(approx(pg.reduce((t, p) => t + p, 0), 1), 'those probabilities also sum to 1');
    }

    /* ---- standard gates are unitary (U^dagger U = I) ---- */
    {
      for (const name of ['H', 'X', 'Y', 'Z', 'S', 'T']) {
        ok(isUnitary(Q.GATES[name]), 'gate ' + name + ' is unitary (U†U = I)');
      }
      ok(isUnitary(Q.RX(0.7)), 'RX(0.7) is unitary');
      ok(isUnitary(Q.RY(-1.3)), 'RY(-1.3) is unitary');
      ok(isUnitary(Q.RZ(2.1)), 'RZ(2.1) is unitary');
    }

    /* ---- known one-qubit circuits give known results ---- */
    {
      const hp = Q.probabilities(Q.runOps([H0], 1));
      ok(approx(hp[0], 0.5) && approx(hp[1], 0.5), 'H|0> gives 50/50: P(0) = P(1) = 0.5');

      const x0 = Q.applyOp(Q.zeroState(1), { gate: 'X', target: 0 });
      ok(approx(Q.probabilities(x0)[1], 1), 'X|0> = |1>');
      const x1 = Q.applyOp(x0, { gate: 'X', target: 0 });
      ok(approx(Q.probabilities(x1)[0], 1), 'X|1> = |0>');

      const hh = Q.runOps([H0, H0], 1);
      ok(approx(Q.probabilities(hh)[0], 1) && approx(Q.cabs(hh[1]), 0),
        'H·H|0> = |0>: paths to |1> cancel (destructive interference)');

      const hzh = Q.runOps([H0, { gate: 'Z', target: 0 }, H0], 1);
      ok(approx(Q.probabilities(hzh)[1], 1), 'H·Z·H|0> = |1>: a hidden phase flips the outcome');
    }

    /* ---- phases: invisible to a single measurement, visible in interference --- */
    {
      const plus = Q.runOps([H0], 1);
      const minus = Q.applyOp(plus, { gate: 'Z', target: 0 });
      ok(approx(Q.probabilities(minus)[0], 0.5) && approx(Q.probabilities(minus)[1], 0.5),
        'Z on |+> leaves probabilities at 50/50 (a phase is invisible to one measurement)');
      ok(approx(argDeg(minus[1]), 180) && approx(argDeg(minus[0]), 0),
        'Z on |+> flips the |1> amplitude phase to 180 degrees (what the phase dials draw)');
    }

    /* ---- rotations reproduce the fixed gates up to a global phase ---- */
    {
      const ryPi = Q.applyOp(Q.zeroState(1), { gate: 'RY', target: 0, angle: P });
      const xg = Q.applyOp(Q.zeroState(1), { gate: 'X', target: 0 });
      ok(approx(Q.fidelity(ryPi, xg), 1), 'RY(pi)|0> = X|0> up to a global phase (fidelity 1)');
    }

    /* ---- the Bell circuit: entanglement, correlations, non-factorability ---- */
    {
      const bell = Q.runOps([H0, CN01], 2);
      const p = Q.probabilities(bell);
      ok(approx(p[0], 0.5) && approx(p[3], 0.5), 'Bell circuit: P(00) = P(11) = 0.5');
      ok(approx(p[1], 0) && approx(p[2], 0), 'Bell circuit: P(01) = P(10) = 0');
      ok(approx(Q.cabs(Q.productDet(bell)), 0.5),
        'Bell is non-factorable: |a00·a11 − a01·a10| = 0.5 (not 0)');
      ok(approx(Q.concurrence(bell), 1) && Q.isEntangled(bell),
        'Bell concurrence = 1 (maximally entangled)');

      const r0 = Q.reducedBloch(bell, 0);
      const r1 = Q.reducedBloch(bell, 1);
      ok(approx(r0.len, 0) && approx(r1.len, 0),
        'each qubit of a Bell pair is maximally mixed (reduced Bloch length 0)');

      const prod = Q.runOps([H0, { gate: 'H', target: 1 }], 2);
      ok(approx(Q.concurrence(prod), 0) && !Q.isEntangled(prod),
        'H⊗H|00> is a product state (concurrence 0)');
    }

    /* ---- unitarity across a circuit: the norm never drifts from 1 ---- */
    {
      const ops = [
        H0, { gate: 'T', target: 0 }, { gate: 'RX', target: 1, angle: 0.7 },
        { gate: 'S', target: 1 }, { gate: 'RY', target: 0, angle: 1.1 },
        CN01, { gate: 'RZ', target: 1, angle: 2.2 }, { gate: 'H', target: 1 },
      ];
      let s = Q.zeroState(2);
      let worst = 0;
      for (const op of ops) { s = Q.applyOp(s, op); worst = Math.max(worst, Math.abs(Q.norm(s) - 1)); }
      ok(worst <= 1e-10, 'norm stays 1 through an 8-gate circuit (worst drift ' + worst.toExponential(2) + ')');
    }

    /* ---- measurement statistics match |amplitude|^2 (seeded, deterministic) -- */
    {
      const shots = 4000;
      const plus = Q.runOps([H0], 1);
      const m = Q.measureShots(plus, shots, FIXED_SEED);
      ok(m.counts['0'] + m.counts['1'] === shots, 'seeded shots: counts sum to ' + shots);
      const f0 = m.counts['0'] / shots;
      ok(Math.abs(f0 - 0.5) < 0.03,
        'H|0> sampled frequency ≈ Born P(0)=0.5 (got ' + f0.toFixed(3) + ', seed ' + FIXED_SEED + ')');
      const m2 = Q.measureShots(plus, shots, FIXED_SEED);
      ok(JSON.stringify(m.counts) === JSON.stringify(m2.counts),
        'seeded measurement is reproducible: the same seed gives identical counts');

      const bell = Q.runOps([H0, CN01], 2);
      const bs = Q.measureShots(bell, shots, FIXED_SEED);
      ok(bs.counts['01'] === 0 && bs.counts['10'] === 0 &&
        bs.counts['00'] + bs.counts['11'] === shots,
        'Bell shots: only 00/11 appear, perfectly correlated');
    }

    /* ---- Bloch vectors of reference states ---- */
    {
      const b0 = Q.blochVector(Q.zeroState(1));
      ok(approx(b0.z, 1) && approx(b0.x, 0) && approx(b0.y, 0), 'blochVector(|0>) = +z pole');
      const bp = Q.blochVector(Q.runOps([H0], 1));
      ok(approx(bp.x, 1) && approx(bp.theta, P / 2), 'blochVector(H|0>) = +x (theta = pi/2)');
    }

    /* ---- Deutsch's algorithm (1-bit Deutsch–Jozsa): one query decides
       constant vs balanced, and phase kickback means the oracle never
       entangles — even when it is literally a CNOT. ---- */
    {
      for (const name of ['constant-0', 'constant-1']) {
        const r = Q.deutschRun(name);
        ok(r.verdict === 'constant' && approx(r.pOne, 0),
          'Deutsch ' + name + ': one query -> "constant" (input qubit measures 0)');
      }
      for (const name of ['balanced-id', 'balanced-not']) {
        const r = Q.deutschRun(name);
        ok(r.verdict === 'balanced' && approx(r.pOne, 1),
          'Deutsch ' + name + ': one query -> "balanced" (input qubit measures 1)');
      }
      // the f(x)=x oracle is a CNOT, yet with the ancilla in |−> it kicks back a
      // phase instead of entangling: the post-oracle state stays a product state.
      const afterOracle = Q.runOps(Q.deutschCircuit('balanced-id').slice(0, -1), 2);
      ok(approx(Q.concurrence(afterOracle), 0),
        'phase kickback: the Deutsch oracle (a CNOT) leaves the state unentangled (concurrence 0)');
    }

    return summarize(results);
  }

  function summarize(results) {
    let pass = 0;
    for (const r of results) if (r.ok) pass++;
    const total = results.length;
    return { pass: pass, fail: total - pass, total: total, allPass: pass === total, results: results };
  }

  const api = { run: run, FIXED_SEED: FIXED_SEED };
  if (typeof globalThis !== 'undefined') globalThis.QSelfTest = api;
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') module.exports = api;

  /* Node CLI: `node selftest.js` runs the suite and exits non-zero on any fail. */
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    const Q = require('./sim.js');
    const r = run(Q);
    for (const x of r.results) console.log((x.ok ? 'ok  - ' : 'FAIL - ') + x.msg);
    console.log('');
    const tag = r.allPass ? 'PASS ' : 'FAILED ';
    console.log(r.pass + ' passed, ' + r.fail + ' failed  (self-test ' + tag + r.pass + '/' + r.total + ')');
    process.exit(r.allPass ? 0 : 1);
  }
})();
