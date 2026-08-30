#!/usr/bin/env python3
"""
Ground-truth scoring for a `sync.json`, without a browser.

    python align/evaluate.py \
        --recording recording.mp3 \
        --bars out/bars.json \
        --sync out/sync.json \
        [--midi out/score.mid] [--positions bars|beats] [--json]

Nothing else in the pipeline measures alignment. `diagnostics.residualRmsMs`
describes how far the warp curve bends away from its *own* linear fit, and the
player's "Error" readout compares the dense map against what alphaTab does with
its resampled copy — both can look perfect while the map is a subdivision out.

This asks the only question that matters: **map a notated attack through the
curve, and how far is the nearest real attack in the recording?**

Two numbers are reported separately because they are different problems:

* `signedMedianMs` — a constant lead-in error. One number fixes the whole song,
  and the onset detector's own lag lives in here too, so it is not evidence of
  a bad warp.
* everything else is **median-centred**: the spread that remains once that
  constant is removed. This is what DTW quality actually shows up in.

`slipHistogram` buckets the centred residuals by sixteenth note. A healthy
alignment is one tall bucket at 0; a bucket at ±1 means the path locked onto
the wrong subdivision somewhere, which is the characteristic fast-song failure.
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
MATCH_TOL_SEC = 0.015


def _within(sorted_arr, value: float, tol: float) -> bool:
    """Is ``value`` within ``tol`` of any entry of the sorted array?"""
    import numpy as np

    i = int(np.searchsorted(sorted_arr, value))
    return any(
        0 <= j < sorted_arr.size and abs(sorted_arr[j] - value) <= tol
        for j in (i - 1, i)
    )


def candidate_positions(bars_doc: dict, positions: str) -> list[float]:
    if positions == "beats":
        beats = [float(t) for t in (bars_doc.get("beats") or [])]
        if beats:
            return sorted(set(beats))
    return sorted({float(b.get("startSec", 0)) for b in (bars_doc.get("bars") or [])})


def notated_onsets(midi_path: str | None) -> list[float]:
    if not midi_path:
        return []
    try:
        import pretty_midi

        pm = pretty_midi.PrettyMIDI(midi_path)
        return sorted(n.start for inst in pm.instruments for n in inst.notes)
    except Exception:  # noqa: BLE001
        return []


def evaluate(
    recording: str,
    bars_doc: dict,
    sync_doc: dict,
    midi_path: str | None = None,
    positions: str = "bars",
) -> dict:
    """Score a `sync.json` against a recording on disk."""
    from align import load_audio
    from onsets import onset_envelope

    env, hop_sec = onset_envelope(load_audio(recording), SR)
    return evaluate_points(
        sync_doc.get("points") or [], bars_doc, env, hop_sec, midi_path, positions
    )


def evaluate_points(
    points: list,
    bars_doc: dict,
    env,
    hop_sec: float,
    midi_path: str | None = None,
    positions: str = "bars",
    exclude=None,
) -> dict:
    """The measurement itself, against a pre-computed onset envelope.

    Split out so `sweep.py` can score dozens of candidate maps against one
    envelope instead of re-decoding the recording every time.

    ``exclude`` drops score positions from the measurement. It exists for
    hold-out scoring of the onset snapper: the snapper moves points *onto*
    peaks of this same envelope, so grading it at the positions it fitted would
    measure nothing but its own arithmetic and it would win every comparison
    with a residual of zero. Excluding those positions turns the score back
    into a question about generalisation — did fixing the downbeats also fix
    the beats in between?
    """
    import numpy as np

    from align import subdivision_sec
    from onsets import find_peak

    if len(points) < 2:
        return {"error": "no usable points"}

    ps = np.array([float(p["scoreTime"]) for p in points])
    pa = np.array([float(p["audioTime"]) for p in points])

    tempo = bars_doc.get("tempo")
    sixteenth = subdivision_sec(tempo)
    beat_sec = sixteenth * 4
    # Half a beat: wide enough to find the attack, narrow enough that a hit two
    # subdivisions away cannot masquerade as a small residual.
    window = beat_sec / 2

    targets = candidate_positions(bars_doc, positions)
    if exclude is not None:
        blocked = np.array(sorted(exclude), dtype=float)
        if blocked.size:
            targets = [
                t
                for t in targets
                if not _within(blocked, t, MATCH_TOL_SEC)
            ]
    notes = np.array(notated_onsets(midi_path))
    if notes.size:
        targets = [t for t in targets if _within(notes, t, MATCH_TOL_SEC)]

    residuals: list[float] = []
    at_score: list[float] = []
    for t in targets:
        if t < ps[0] or t > ps[-1]:
            continue
        predicted = float(np.interp(t, ps, pa))
        peak, _strength = find_peak(env, hop_sec, predicted, window)
        if peak is None:
            continue
        residuals.append(peak - predicted)
        at_score.append(t)

    if len(residuals) < 4:
        return {
            "error": "too few measurable positions",
            "candidates": len(targets),
            "measured": len(residuals),
        }

    r = np.array(residuals)
    signed_median = float(np.median(r))
    centred = r - signed_median
    abs_centred = np.abs(centred)

    slips: dict[str, int] = {}
    for value in centred:
        bucket = int(round(value / sixteenth)) if sixteenth > 0 else 0
        key = str(bucket)
        slips[key] = slips.get(key, 0) + 1

    worst_idx = np.argsort(-abs_centred)[:10]

    def ms(x) -> float:
        return round(float(x) * 1000, 1)

    return {
        "candidates": len(targets),
        "measured": len(residuals),
        "positions": positions,
        "tempoBpm": tempo,
        "sixteenthMs": ms(sixteenth),
        "signedMedianMs": ms(signed_median),
        "meanAbsMs": ms(np.mean(abs_centred)),
        "medianAbsMs": ms(np.median(abs_centred)),
        "p90AbsMs": ms(np.percentile(abs_centred, 90)),
        "maxAbsMs": ms(np.max(abs_centred)),
        "within25Pct": round(float(np.mean(abs_centred <= 0.025)) * 100, 1),
        "within50Pct": round(float(np.mean(abs_centred <= 0.050)) * 100, 1),
        "slipHistogram": dict(sorted(slips.items(), key=lambda kv: int(kv[0]))),
        "slipCount": int(np.sum(np.abs(centred) > sixteenth * 0.5)),
        "worst": [
            {"scoreSec": round(at_score[i], 2), "residualMs": ms(centred[i])}
            for i in worst_idx
        ],
    }


def format_report(result: dict) -> str:
    if "error" in result:
        return f"evaluate: {result['error']} ({json.dumps(result)})"
    lines = [
        f"measured {result['measured']}/{result['candidates']} {result['positions']} "
        f"@ {result['tempoBpm']} BPM (sixteenth {result['sixteenthMs']} ms)",
        f"  constant offset (signed median) : {result['signedMedianMs']:>8} ms",
        "  --- spread after removing it ---",
        f"  median |residual|               : {result['medianAbsMs']:>8} ms",
        f"  mean   |residual|               : {result['meanAbsMs']:>8} ms",
        f"  p90    |residual|               : {result['p90AbsMs']:>8} ms",
        f"  max    |residual|               : {result['maxAbsMs']:>8} ms",
        f"  within 25 ms / 50 ms            : {result['within25Pct']}% / {result['within50Pct']}%",
        f"  subdivision slips (>1/2 16th)   : {result['slipCount']}",
        f"  slip histogram (16ths)          : {result['slipHistogram']}",
    ]
    if result.get("worst"):
        worst = ", ".join(
            f"{w['scoreSec']}s:{w['residualMs']}ms" for w in result["worst"][:5]
        )
        lines.append(f"  worst positions                 : {worst}")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--recording", required=True)
    ap.add_argument("--bars", required=True)
    ap.add_argument("--sync", required=True)
    ap.add_argument("--midi", default=None,
                    help="Reference MIDI; restricts scoring to positions the score actually attacks.")
    ap.add_argument("--positions", choices=("bars", "beats"), default="bars")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    with open(args.bars) as fh:
        bars_doc = json.load(fh)
    with open(args.sync) as fh:
        sync_doc = json.load(fh)

    result = evaluate(args.recording, bars_doc, sync_doc, args.midi, args.positions)
    if args.json:
        print(json.dumps(result))
    else:
        print(format_report(result))
    sys.exit(1 if "error" in result else 0)


if __name__ == "__main__":
    main()
