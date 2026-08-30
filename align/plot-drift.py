#!/usr/bin/env python3
"""Plot score→audio timing error versus score time, one panel per layer.

    python align/plot-drift.py \
        --recording align/fixtures/monster/monster.mp3 \
        --bars align/.cache/drift/bars.json \
        --sync align/.cache/drift/sync.json \
        --effective align/.cache/drift/sync-effective.json \
        --drift align/.cache/drift/drift.json \
        --drift-bars align/.cache/drift/drift-bars.json \
        --out align/.cache/drift/drift.png

Companion to `probe-playback.mjs`. The probe reproduces alphaTab's playback
math offline; this draws the result next to the ground truth from `onsets.py`,
so a drift that accumulates (a rate error) is visually distinguishable from one
that jumps (a DTW path slip) or oscillates (bad anchors / post-processing).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ALIGN_DIR = str(Path(__file__).resolve().parent)
if _ALIGN_DIR not in sys.path:
    sys.path.insert(0, _ALIGN_DIR)

SR = 22050


def residual_series(points, targets, env, hop_sec, window):
    """(scoreSec, residualMs) for every target position the detector can measure."""
    import numpy as np

    from onsets import find_peak

    ps = np.array([float(p["scoreTime"]) for p in points])
    pa = np.array([float(p["audioTime"]) for p in points])
    xs, ys = [], []
    for t in targets:
        if t < ps[0] or t > ps[-1]:
            continue
        predicted = float(np.interp(t, ps, pa))
        peak, _ = find_peak(env, hop_sec, predicted, window)
        if peak is None:
            continue
        xs.append(t)
        ys.append((peak - predicted) * 1000.0)
    return xs, ys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--recording", required=True)
    ap.add_argument("--bars", required=True)
    ap.add_argument("--sync", required=True)
    ap.add_argument("--effective", required=True)
    ap.add_argument("--drift", required=True,
                    help="probe output for the shipping configuration")
    ap.add_argument("--drift-bars", default=None,
                    help="probe output for --grid bars")
    ap.add_argument("--drift-before", default=None,
                    help="probe output for --no-compensate")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    from align import load_audio, subdivision_sec
    from onsets import onset_envelope

    bars_doc = json.loads(Path(args.bars).read_text())
    sync_doc = json.loads(Path(args.sync).read_text())
    eff_doc = json.loads(Path(args.effective).read_text())
    drift = json.loads(Path(args.drift).read_text())
    drift_bars = (
        json.loads(Path(args.drift_bars).read_text()) if args.drift_bars else None
    )
    drift_before = (
        json.loads(Path(args.drift_before).read_text()) if args.drift_before else None
    )

    sixteenth = subdivision_sec(bars_doc.get("tempo"))
    window = sixteenth * 2
    env, hop_sec = onset_envelope(load_audio(args.recording), SR)
    targets = sorted({float(t) for t in bars_doc.get("beats") or []})

    raw_x, raw_y = residual_series(sync_doc["points"], targets, env, hop_sec, window)
    eff_x, eff_y = residual_series(eff_doc["points"], targets, env, hop_sec, window)

    rows = drift["rows"]
    score_t = [r["scoreSec"] for r in rows]
    reported = [r["reportedErrMs"] for r in rows]

    fig, axes = plt.subplots(3, 1, figsize=(11, 11), sharex=True)

    ax = axes[0]
    if drift_before:
        ax.plot(
            [r["scoreSec"] for r in drift_before["rows"]],
            [r["reportedErrMs"] for r in drift_before["rows"]],
            color="#dc2626",
            lw=1.6,
            label="beat sync points, raw offsets (before)",
        )
    ax.plot(score_t, reported, color="#16a34a", lw=1.6, label="offsets compensated (after)")
    if drift_bars:
        ax.plot(
            [r["scoreSec"] for r in drift_bars["rows"]],
            [r["reportedErrMs"] for r in drift_bars["rows"]],
            color="#f59e0b",
            lw=1.4,
            label="bar sync points (counterfactual)",
        )
    ax.axhline(0, color="#71717a", lw=0.8)
    ax.axhline(-sixteenth * 1000, color="#a1a1aa", lw=0.8, ls=":")
    ax.text(1, -sixteenth * 1000, " one 16th note", va="bottom", fontsize=8, color="#71717a")
    ax.set_ylabel("alphaTab position − true score position (ms)")
    ax.set_title("Layer 4: what alphaTab does with the sync points it is given")
    ax.legend(loc="lower left", fontsize=9)
    ax.grid(alpha=0.25)

    ax = axes[1]
    pts = sync_doc["points"]
    ps = np.array([p["scoreTime"] for p in pts])
    pa = np.array([p["audioTime"] for p in pts])
    ax.plot(ps, (pa - ps) * 1000, color="#2563eb", lw=1.2, label="raw DTW path (audio − score)")
    ax.axhline(0, color="#71717a", lw=0.8)
    ax.set_ylabel("audio − score (ms)")
    ax.set_title("Layers 2/3: the warp the aligner produced (offset + local tempo)")
    ax.legend(loc="lower right", fontsize=9)
    ax.grid(alpha=0.25)

    ax = axes[2]
    ax.scatter(raw_x, raw_y, s=6, color="#2563eb", alpha=0.55, label="raw DTW map")
    ax.scatter(eff_x, eff_y, s=6, color="#dc2626", alpha=0.55, label="effective playback")
    ax.axhline(0, color="#71717a", lw=0.8)
    for k in (-1, 1):
        ax.axhline(k * sixteenth * 1000, color="#a1a1aa", lw=0.8, ls=":")
    ax.set_ylabel("nearest real onset − predicted (ms)")
    ax.set_xlabel("score time (s)")
    ax.set_title("Ground truth: notated attacks mapped through each curve vs detected onsets")
    ax.legend(loc="lower left", fontsize=9)
    ax.grid(alpha=0.25)

    fig.tight_layout()
    fig.savefig(args.out, dpi=130)
    print(json.dumps({"out": args.out, "rawMeasured": len(raw_y), "effectiveMeasured": len(eff_y)}))


if __name__ == "__main__":
    main()
