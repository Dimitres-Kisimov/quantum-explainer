# Quantum Explainer

An installable, offline-first web app that teaches the basics of quantum
computing on a real (tiny) simulator — and refuses to hype.

I built this because most introductory material about quantum computing sits at
one of two bad extremes: textbook walls of matrices, or breathless marketing
about "trying every answer at once". Neither helps a curious person build a
correct intuition. So this app takes the third path: show the actual formalism
at the only scale where it can be shown completely — one and two qubits — let
you poke it interactively, and say out loud what quantum computers *cannot* do.
Every physics claim in the app is either demonstrated live on the simulator or
cited to a real source (references below and in the app footer).

## What's inside

- **A hand-written state-vector simulator** (`sim.js`, ~300 lines, zero
  dependencies): complex arithmetic, H/X/Y/Z/S/T gates, RX/RY/RZ rotations
  with an angle slider, CNOT, Born-rule measurement with a seeded PRNG so runs
  are reproducible, and an entanglement check (the a₀₀a₁₁ − a₀₁a₁₀ product
  test). Pure functions, unit-tested in plain Node.
- **Circuit playground**: click gates to build a 1–2 qubit circuit, see the
  live amplitudes and probabilities, run 1000 seeded shots, and read a
  plain-language "why did this happen" entry for every step — with the actual
  numbers from the state vector, including the explicit non-factorability
  check when a CNOT entangles the qubits.
- **A step scrubber**: click any step number in the circuit diagram (or use
  Prev/Next) to replay the state after any intermediate gate — the amplitude
  table, phase dials, and Bloch arrow all follow, the viewed column is
  highlighted, and not-yet-applied gates dim. The simulator always stored
  every intermediate state; the scrubber just lets you look at them, so you
  can watch H,H take the arrow pole → equator → pole. Measuring while
  scrubbed honestly samples the state you are looking at.
- **Phase dials**: next to each complex amplitude, a small dial draws it as
  an arrow in the complex plane (length = magnitude, angle = phase). Phases
  don't change measurement odds on their own — the dials make that visible:
  after H,Z the |1⟩ arrow points backwards at 180° while the bars still say
  50/50, which is exactly why the second H then flips the outcome.
- **An interactive Bloch sphere** (canvas, drag to rotate) with θ/φ readout.
  In two-qubit mode it draws each qubit's *reduced* state — so you can watch
  both arrows collapse to the centre of the sphere when the qubits entangle,
  which is the most honest picture of entanglement I know how to draw.
- **Animated gate sweeps**: every gate is a Bloch-sphere rotation, so the
  arrow now *sweeps* along the gate's actual rotation axis (~260 ms) instead
  of teleporting — RX/RY/RZ visibly turn about x/y/z, H about the (x+z)
  diagonal, and Undo/Prev sweep the same rotation backwards. The frames come
  from `partialOp` in the simulator (the state a fraction *t* of the way
  through the gate, unit-tested like everything else); a CNOT animates as a
  controlled partial flip, phase-corrected so the endpoint is exactly CNOT.
  The animation is display-only — tables, checks, and seeded runs always use
  the exact final state — and is skipped under `prefers-reduced-motion`.
- **Delete any single step**: the × under a circuit column (or the "Remove
  step" button while viewing one) deletes just that gate and recomputes —
  no more undoing your whole circuit to fix one middle gate. Later steps
  renumber; a toast says what was removed.
- **Learn mode**: short lessons on superposition, measurement, interference
  (with the cancellation arithmetic written out), entanglement (a Bell-state
  walkthrough), and **Deutsch's algorithm** — the smallest circuit with a
  genuine (if modest) quantum advantage, used to show *phase kickback* and the
  honest fact that a CNOT does not always entangle — and **Grover's search**
  on two qubits: one oracle query plus a diffusion step finds a marked item
  among four with certainty, with the exact amplitudes shown at every stage
  (all ½ → sign flip on the mark, probabilities unchanged → inversion about
  the mean piles everything onto the answer), plus the honest twists that the
  query alone changes no probabilities and that running the iteration twice
  overshoots back to 25%. Plus a "What quantum
  computers are NOT" section covering the parallel-worlds myth, NISQ-era
  limits, decoherence, error-correction overhead, and why your encryption is
  not being broken today — and a "where they may genuinely help" section with
  the asymptotics stated correctly. Every lesson ends with a "try it" button
  that loads the circuit.
- **A real PWA**: web app manifest, service worker that precaches the whole
  shell, install button, original icons. After the first visit it works with
  no network at all. Light/dark follows your system preference.

There are no frameworks, no build step, no CDNs, no web fonts, no analytics,
and no network calls. Everything is hand-written HTML/CSS/JS with system fonts
and inline SVG/canvas graphics.

## Run it

Open `index.html` in a browser and everything works except installation
(service workers require HTTP). For the full PWA experience serve the folder:

```
python -m http.server 8000
# then open http://localhost:8000
```

**Install on a phone** (needs HTTPS or localhost):

- **Android / desktop Chrome or Edge:** use the "Install app" button in the
  header when the browser offers it, or the browser menu's Install entry.
- **iOS / iPadOS:** open in Safari → Share → **Add to Home Screen**.

Once installed (or simply after the first load), the app runs fully offline.

## Verify

Everything is checkable from a stock Node installation:

```
node --check sim.js app.js selftest.js sw.js   # syntax
node test/sim.test.mjs               # 154 physics/behaviour assertions
node selftest.js                     # portable correctness self-test (46 checks)
node tools/verify.mjs                # manifest, precache, offline guard (86 checks)
```

**In-browser self-test.** A teaching tool should be able to prove — on the
device a learner is actually holding, with no tooling installed — that the math
it teaches is right. Open the app with `?selftest=1` (e.g.
`http://localhost:8000/?selftest=1`) and a panel reports **PASS n/n**, running
the same correctness suite (`selftest.js`) live against the real simulator: state
vectors stay normalized (probabilities sum to 1), the standard gates are unitary
(U†U = I), H|0⟩ → 50/50, X|0⟩ → |1⟩, H·H|0⟩ → |0⟩ (interference), the Bell
circuit gives {00: 0.5, 11: 0.5} with 01/10 impossible and a non-factorable
state, seeded measurement frequencies match the Born rule |amplitude|², and
Grover's one-query search finds each of the four markable items with
certainty (while the query alone leaves every probability at 25%). The
result is also on `window.__selftest` and the `<html data-selftest>` attribute
for scripting. It is deterministic (the only sampling uses a fixed seed) and is
a portable subset of the exhaustive Node harness, not a replacement for it — the
same suite runs headlessly as `node selftest.js` in CI.

The test harness asserts, among other things: H|0⟩ gives 50/50; H·H|0⟩
returns |0⟩ (interference); CNOT on (H|0⟩)⊗|0⟩ yields the Bell state with
joint probabilities {00: 0.5, 11: 0.5} and a failing factorability check;
RY(π) ≈ X up to global phase; seeded measurement is reproducible; norms
stay 1 to 1e-10 through long circuits; amplitude phases come out right for
the dials (Z flips |1⟩'s phase to 180°, RZ(90°) splits ±45°); the
op-by-op intermediate states the scrubber replays match the end-to-end
result; and the fractional gates behind the Bloch sweep are the identity at
t = 0, the true gate at t = 1 (exactly, for CNOT — no stray control phase),
and norm-preserving mid-sweep. For Deutsch's algorithm it checks all four
oracles: a single query yields the correct constant/balanced verdict with
certainty, and the oracle leaves the state a product state (concurrence 0) —
phase kickback, not entanglement — even when the oracle is a CNOT. For
Grover's search it checks all four marked items with hand-computed amplitudes
at every stage: the uniform state is exactly (½,½,½,½); the single query
flips only the marked amplitude's sign and leaves every probability at 25%
(the mark is invisible on its own); the diffusion is verified to map each
amplitude to the inversion-about-the-mean value (mean exactly ¼); one
iteration lands on the marked basis state with probability exactly 1 (1000
seeded shots all agree); a second iteration overshoots back to exactly 25%;
and the whole circuit is composed from H, X and CNOT only (the CZ inside is
H·CNOT·H — no new gate primitive). The verifier proves the app references no
external asset of any kind.

`tools/make_icons.py` (Python + Pillow) regenerates the PNG icons from the
same geometry as the hand-drawn `icons/icon.svg`.

## Project layout

```
index.html            app shell + all lesson content
styles.css            hand-written styles, light/dark via prefers-color-scheme
sim.js                the quantum simulator (pure functions, Node-testable)
selftest.js           portable correctness self-test — powers ?selftest=1 and `node selftest.js`
app.js                DOM glue: playground, Bloch canvas, histogram, PWA wiring
manifest.webmanifest  PWA manifest
sw.js                 service worker (precache-the-shell, cache-first)
icons/                original icon: SVG source + rasterized PNGs
test/sim.test.mjs     Node test harness (no framework)
tools/verify.mjs      structural + offline-guard checks
tools/make_icons.py   PNG icon generator (Pillow)
```

Simulator convention: qubit 0 is the left bit of the ket, so |10⟩ means
q0 = 1, q1 = 0, and basis index = q0·2 + q1.

## References

1. M. A. Nielsen and I. L. Chuang, *Quantum Computation and Quantum
   Information*, Cambridge University Press (10th anniversary edition, 2010).
2. J. Preskill, "Quantum Computing in the NISQ era and beyond",
   Quantum 2, 79 (2018). arXiv:1801.00862.
3. IBM Quantum Learning, "Basics of quantum information" course materials,
   learning.quantum.ibm.com (accessed 2026).
4. C. Gidney and M. Ekerå, "How to factor 2048 bit RSA integers in 8 hours
   using 20 million noisy qubits", Quantum 5, 433 (2021). arXiv:1905.09749.
5. C. H. Bennett, E. Bernstein, G. Brassard and U. Vazirani, "Strengths and
   Weaknesses of Quantum Computing", SIAM J. Comput. 26, 1510 (1997).
   arXiv:quant-ph/9701001.
6. P. W. Shor, "Polynomial-Time Algorithms for Prime Factorization and
   Discrete Logarithms on a Quantum Computer", SIAM J. Comput. 26, 1484
   (1997). arXiv:quant-ph/9508027.
7. L. K. Grover, "A fast quantum mechanical algorithm for database search",
   Proc. 28th ACM STOC (1996). arXiv:quant-ph/9605043.
8. D. Deutsch and R. Jozsa, "Rapid solution of problems by quantum
   computation", Proc. R. Soc. Lond. A 439, 553 (1992).

## License

© 2026 Dimitres Kisimov — all rights reserved; published for portfolio review. See LICENSE.
