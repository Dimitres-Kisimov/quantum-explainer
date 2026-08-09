"""Build deliverables/quantum_explainer_onepager.pdf — a one-page summary.

Honesty rule: the verification counts printed on the page are not typed in,
they are measured — this script runs the repo's two Node harnesses and reads
the pass counts from their output, and aborts if either harness fails.

Run from the repo root:  python tools/make_onepager.py
Requires: matplotlib, and Node (to run the harnesses).
Stdout is ASCII only.
"""
import os
import re
import subprocess
import sys
import textwrap

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "deliverables")
OUT_PDF = os.path.join(OUT_DIR, "quantum_explainer_onepager.pdf")
LIVE_URL = "https://dimitres-kisimov.github.io/quantum-explainer/"

INK = "#111827"
MUTED = "#4b5563"
BG_HEAD = "#0e1631"      # app background colour
ACCENT = "#4cc9f0"       # app accent colour
RULE = "#c7d2fe"

LINE = 0.0142            # figure-fraction height of one 8.6pt text line
WRAP = 108               # characters per wrapped line at fontsize 8.6


def run_harness(cmd, label):
    """Run a Node harness; return its '<n> passed' count or abort."""
    proc = subprocess.run(
        cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    tail = (proc.stdout or "") + (proc.stderr or "")
    m = re.search(r"(\d+) passed, (\d+) failed", tail)
    if proc.returncode != 0 or not m or m.group(2) != "0":
        print("ERROR: harness not green: " + label)
        print(tail[-2000:])
        sys.exit(1)
    n = int(m.group(1))
    print("measured: " + label + " -> " + str(n) + " passed, 0 failed")
    return n


def section(fig, y, title):
    fig.text(0.06, y, title, fontsize=11, fontweight="bold", color=BG_HEAD)
    return y - 0.021


def bullets(fig, y, items):
    """Draw a bullet list; wrap text with textwrap so spacing is exact."""
    for body in items:
        lines = textwrap.wrap(body, WRAP)
        fig.text(0.068, y, "•", fontsize=8.6, color=ACCENT, va="top", fontweight="bold")
        for i, line in enumerate(lines):
            fig.text(0.082, y - i * LINE, line, fontsize=8.6, color=INK, va="top")
        y -= len(lines) * LINE + 0.0065
    return y


def main():
    sim_n = run_harness(["node", "test/sim.test.mjs"], "node test/sim.test.mjs")
    ver_n = run_harness(["node", "tools/verify.mjs"], "node tools/verify.mjs")

    os.makedirs(OUT_DIR, exist_ok=True)
    fig = plt.figure(figsize=(8.27, 11.69))  # A4 portrait

    # ---- header band ----
    ax = fig.add_axes([0, 0.895, 1, 0.105])
    ax.set_axis_off()
    ax.add_patch(plt.Rectangle((0, 0), 1, 1, transform=ax.transAxes, color=BG_HEAD))
    fig.text(0.06, 0.952, "Quantum Explainer", fontsize=23, fontweight="bold", color="white")
    fig.text(0.06, 0.928, "An installable, offline-first web app that teaches quantum computing",
             fontsize=9.5, color=RULE)
    fig.text(0.06, 0.911, "on a real (tiny) simulator - and refuses to hype.",
             fontsize=9.5, color=RULE)

    # app icon, top right (the app's own asset)
    icon_path = os.path.join(ROOT, "icons", "icon-512.png")
    if os.path.exists(icon_path):
        icon_ax = fig.add_axes([0.862, 0.9155, 0.078, 0.078 * 8.27 / 11.69])
        icon_ax.imshow(plt.imread(icon_path))
        icon_ax.set_axis_off()

    fig.text(0.06, 0.868, "Live (installable PWA):", fontsize=9, color=MUTED)
    fig.text(0.245, 0.868, LIVE_URL, fontsize=9.5, color="#1d4ed8", fontfamily="monospace")

    y = 0.836
    y = section(fig, y, "WHAT IT IS")
    y = bullets(fig, y, [
        "A hand-written 1-2 qubit state-vector simulator (sim.js, zero dependencies) driving a "
        "circuit playground: H/X/Y/Z/S/T, RX/RY/RZ with an angle slider, CNOT, seeded Born-rule "
        "measurement, and an explicit entanglement (factorability) check.",
        "A draggable Bloch sphere - in two-qubit mode it draws each qubit's reduced state, so "
        "entanglement appears honestly as both arrows collapsing to the centre of the sphere.",
        "Phase dials for every complex amplitude, animated gate sweeps along each gate's true "
        "rotation axis, and a step scrubber that replays any intermediate state.",
        "Cited lessons - superposition, measurement, interference, entanglement, Deutsch's "
        "algorithm (phase kickback) and Grover's search (amplitude amplification) - plus \"What "
        "quantum computers are NOT\": the parallel-worlds myth, NISQ-era limits, decoherence, "
        "error-correction overhead. Eight references, Nielsen & Chuang to Deutsch & Jozsa.",
        "A real PWA: manifest, precaching service worker, original icons. No frameworks, no "
        "build step, no CDNs, no analytics - fully offline after the first visit.",
    ])

    y -= 0.010
    y = section(fig, y, "VERIFIED QUALITY (measured while building this PDF)")
    y = bullets(fig, y, [
        str(sim_n) + " physics/behaviour assertions pass in plain Node (node test/sim.test.mjs): "
        "H|0> gives 50/50, H.H interference returns |0>, the Bell state measures "
        "{00: 0.5, 11: 0.5} and fails the factorability check, Deutsch's algorithm answers in "
        "one query, and Grover's one-iteration search finds the marked item with certainty.",
        str(ver_n) + " structural checks pass (node tools/verify.mjs): manifest and icon "
        "integrity, service-worker precache completeness, citation presence, and an offline "
        "guard proving the app references no external asset of any kind.",
        "CI re-runs every gate on each push: JS syntax checks, both harnesses, ruff on the "
        "Python helper scripts, and an independent offline-guard grep.",
    ])

    y -= 0.010
    y = section(fig, y, "THE HONESTY STANCE")
    y = bullets(fig, y, [
        "Every physics claim in the app is either demonstrated live on the simulator or cited "
        "to a real source. If a sentence sounds like marketing, it doesn't belong.",
        "The app says out loud what quantum computers cannot do - no \"tries every answer at "
        "once\", no \"your encryption is broken\", and no invented market figures here either: "
        "this is an educational artifact, and its value is that it is correct.",
    ])

    y -= 0.010
    y = section(fig, y, "LIMITATIONS (stated, not hidden)")
    y = bullets(fig, y, [
        "Two qubits is the deliberate ceiling - the largest system whose full state (4 complex "
        "amplitudes) can be shown completely on screen.",
        "Gates are ideal and noiseless; real hardware decoheres. The lessons say so, but the "
        "playground does not model noise.",
        "A classical simulator demonstrates the rules of quantum mechanics, not a quantum "
        "speedup.",
    ])

    # ---- footer ----
    ax_rule = fig.add_axes([0.06, 0.060, 0.88, 0.0008])
    ax_rule.set_axis_off()
    ax_rule.add_patch(plt.Rectangle((0, 0), 1, 1, transform=ax_rule.transAxes, color=RULE))
    fig.text(0.06, 0.043, "Dimitres Kisimov - portfolio project - repo: quantum-explainer - "
             "details: docs/BUSINESS_CASE.md", fontsize=8, color=MUTED)

    fig.savefig(OUT_PDF, format="pdf")
    plt.close(fig)
    size = os.path.getsize(OUT_PDF)
    print("wrote " + OUT_PDF + " (" + str(size) + " bytes)")
    if size < 10 * 1024:
        print("ERROR: PDF smaller than 10 KB")
        sys.exit(1)
    if y < 0.075:
        print("ERROR: content overflowed the page (y=" + format(y, ".3f") + ")")
        sys.exit(1)


if __name__ == "__main__":
    main()
