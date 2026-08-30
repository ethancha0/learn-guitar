#!/usr/bin/env python3
"""
Parameter sweep for the aligner, scored by `evaluate.py`.

    python align/sweep.py --fixture align/fixtures/monster [--quick] [--positions bars]

A fixture directory holds one song:

    align/fixtures/<name>/score.gp        (or .gp3 .gp4 .gp5 .gp7 .gpx …)
    align/fixtures/<name>/recording.mp3   (or .m4a .flac .wav)

The expensive stages are done once and reused across every configuration:

* the reference render (fluidsynth),
* decoding both signals,
* the pitch filterbank — chroma is cached per feature rate, and the raw pitch
  onset peaks are cached per signal, so changing the DLNCO decay or `alpha`
  costs only the DTW itself.

Every row is scored against the same onset envelope, so the numbers are
directly comparable. `legacy` reproduces the pre-tuning configuration
(SyncToolbox library defaults, 200 ms DLNCO decay, 1 s grid) as the baseline to
beat.
"""
from __future__ import annotations

import argparse
import itertools
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

_ALIGN_DIR = Path(__file__).resolve().parent
if str(_ALIGN_DIR) not in sys.path:
    sys.path.insert(0, str(_ALIGN_DIR))

GP_EXTS = (".gp", ".gp3", ".gp4", ".gp5", ".gp6", ".gp7", ".gp8", ".gpx", ".ptb")
AUDIO_EXTS = (".mp3", ".m4a", ".flac", ".wav", ".ogg")


def find_fixture(fixture: Path) -> tuple[Path, Path]:
    gp = next((p for p in sorted(fixture.iterdir()) if p.suffix.lower() in GP_EXTS), None)
    audio = next((p for p in sorted(fixture.iterdir()) if p.suffix.lower() in AUDIO_EXTS), None)
    if not gp or not audio:
        raise SystemExit(
            f"{fixture} needs one Guitar Pro file and one audio file "
            f"(found gp={gp}, audio={audio})"
        )
    return gp, audio


def build_configs(quick: bool, tempo: float | None):
    """The grid.

    `legacy` (SyncToolbox library defaults, 1 s grid) and `default` (what
    `align.py` ships today) are always included as the two reference rows, so
    every sweep says whether the shipped configuration is still the one to beat.

    `alpha` and the DLNCO decay are swept rather than fixed: shortening the
    decay and weighting onsets over chroma both *look* right for fast music but
    measured neutral-to-harmful on sparse material. The case they were meant for
    is dense polyphony, so a real song has to settle it.
    """
    from align import (DEFAULT_DLNCO_DECAY, FAST_FEATURE_RATE, AlignConfig,
                       decay_frames_for, fast_profile)

    default = fast_profile(AlignConfig(), tempo)
    configs: list[tuple[str, AlignConfig]] = [
        (
            "legacy (pre-tuning)",
            AlignConfig(
                feature_rate=50, alpha=0.5, step_weights=(1.0, 1.0, 1.0),
                threshold_rec=10000, dlnco_decay_frames=DEFAULT_DLNCO_DECAY,
                grid_sec=1.0, snap="off",
            ),
        ),
        ("default (shipped)", default),
    ]

    feature_rates = [FAST_FEATURE_RATE] if quick else [50, FAST_FEATURE_RATE]
    alphas = [0.35, 0.5] if quick else [0.25, 0.35, 0.5, 0.65]
    snaps = ["off", "bars"]
    seen = {(c.feature_rate, c.alpha, c.dlnco_decay_frames, c.snap) for _, c in configs}

    for rate, alpha, snap in itertools.product(feature_rates, alphas, snaps):
        decays = [DEFAULT_DLNCO_DECAY, decay_frames_for(tempo, rate)]
        for decay in dict.fromkeys(decays):  # de-duplicate, keep order
            key = (rate, alpha, decay, snap)
            if key in seen:
                continue
            seen.add(key)
            configs.append(
                (
                    f"fr{rate}/a{alpha}/decay{decay}/snap-{snap}",
                    AlignConfig(
                        feature_rate=rate, alpha=alpha,
                        step_weights=(1.5, 1.5, 2.0), threshold_rec=10 ** 6,
                        dlnco_decay_frames=decay, grid_sec=0.25, snap=snap,
                    ),
                )
            )
    return configs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", required=True)
    ap.add_argument("--work", default=None, help="Where to keep score.mid / bars.json / ref.wav.")
    ap.add_argument("--quick", action="store_true", help="Smaller grid.")
    ap.add_argument("--positions", choices=("bars", "beats"), default="beats")
    ap.add_argument(
        "--no-holdout", action="store_true",
        help=(
            "Score snapped maps at the positions the snapper fitted. Off by "
            "default: the snapper moves points onto peaks of the very envelope "
            "this scores against, so without hold-out every snapped row reports "
            "a residual of zero and wins on arithmetic rather than on alignment."
        ),
    )
    ap.add_argument("--soundfont", default=None)
    ap.add_argument("--json", default=None, help="Write the full result table here.")
    args = ap.parse_args()

    from align import (
        SR, apply_snap, build_points, clip_to_score_end, extract_chroma,
        extract_peaks, estimate_tuning_offset, load_audio, peaks_to_dlnco,
        render_midi_to_wav, run_dtw, Features,
    )
    from evaluate import evaluate_points, format_report
    from onsets import onset_envelope

    fixture = Path(args.fixture).resolve()
    gp_path, audio_path = find_fixture(fixture)

    tmp_holder = None
    if args.work:
        work = Path(args.work)
        work.mkdir(parents=True, exist_ok=True)
    else:
        tmp_holder = tempfile.TemporaryDirectory()
        work = Path(tmp_holder.name)

    print(f"fixture   : {gp_path.name} + {audio_path.name}")
    if (work / "score.mid").exists() and (work / "bars.json").exists():
        print(f"gp-to-midi: reusing {work}")
    else:
        proc = subprocess.run(
            ["node", str(_ALIGN_DIR / "gp-to-midi.mjs"), str(gp_path), str(work)],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            raise SystemExit(f"gp-to-midi failed: {proc.stderr.strip() or proc.stdout.strip()}")
        print(f"gp-to-midi: {proc.stdout.strip()}")

    midi_path = str(work / "score.mid")
    with open(work / "bars.json") as fh:
        bars_doc = json.load(fh)
    tempo = bars_doc.get("tempo")
    score_end = bars_doc.get("endSec")

    ref_wav = str(work / "ref.wav")
    render = "reused" if Path(ref_wav).exists() else render_midi_to_wav(
        midi_path, args.soundfont, ref_wav
    )
    print(f"reference : {render}")
    if render == "sine-fallback":
        print(
            "  WARNING: no soundfont — drums are silent and there are no attack\n"
            "  transients, so every row below is handicapped. Install fluid-synth\n"
            "  and set ALIGN_SOUNDFONT before trusting these numbers."
        )

    ref_audio = load_audio(ref_wav)
    rec_audio = load_audio(audio_path)
    rec_len = rec_audio.size / SR
    print(f"durations : reference {ref_audio.size / SR:.1f}s, recording {rec_len:.1f}s\n")

    env, hop_sec = onset_envelope(rec_audio, SR)

    # Hold-out set: every row is scored at the same positions, and those
    # positions exclude the bar downbeats the snapper is allowed to fit. That
    # keeps snapped and unsnapped rows directly comparable and turns the
    # snapper's score into a generalisation question.
    downbeats = [float(b.get("startSec", 0)) for b in (bars_doc.get("bars") or [])]
    holdout = None if args.no_holdout else downbeats
    if holdout and args.positions == "bars":
        print(
            "note      : --positions bars leaves nothing to hold out; "
            "scoring at beats instead."
        )
        args.positions = "beats"
    if holdout:
        print(f"scoring   : {args.positions}, excluding {len(downbeats)} snappable downbeats")

    tuning = {"ref": estimate_tuning_offset(ref_audio), "rec": estimate_tuning_offset(rec_audio)}
    peaks = {
        "ref": extract_peaks(ref_audio, tuning["ref"]),
        "rec": extract_peaks(rec_audio, tuning["rec"]),
    }
    chroma_cache: dict[tuple[str, int], object] = {}
    dlnco_cache: dict[tuple[str, int, int], object] = {}

    def features(which: str, rate: int, decay: int | None) -> Features:
        audio = ref_audio if which == "ref" else rec_audio
        ck = (which, rate)
        if ck not in chroma_cache:
            chroma_cache[ck] = extract_chroma(audio, tuning[which], rate)
        chroma = chroma_cache[ck]
        dk = (which, rate, decay or 0)
        if dk not in dlnco_cache:
            dlnco_cache[dk] = peaks_to_dlnco(peaks[which], rate, chroma.shape[1], decay)
        return Features(chroma=chroma, dlnco=dlnco_cache[dk], tuning=tuning[which])

    rows = []
    for name, config in build_configs(args.quick, tempo):
        started = time.perf_counter()
        try:
            ref_f = features("ref", config.feature_rate, config.dlnco_decay_frames)
            rec_f = features("rec", config.feature_rate, config.dlnco_decay_frames)
            wp, _method = run_dtw(ref_f, rec_f, config)
            points, _ts, _ta = build_points(wp, config.feature_rate, bars_doc, config.grid_sec)
            if score_end:
                points = clip_to_score_end(points, float(score_end), rec_len)
            points, _snap_stats = apply_snap(
                points, rec_audio, bars_doc, midi_path, config, tempo
            )
            result = evaluate_points(
                points, bars_doc, env, hop_sec, midi_path, args.positions, holdout
            )
        except Exception as exc:  # noqa: BLE001
            result = {"error": f"{type(exc).__name__}: {exc}"}
        result["config"] = name
        result["seconds"] = round(time.perf_counter() - started, 1)
        rows.append(result)
        if "error" in result:
            print(f"{name:34s} FAILED  {result['error']}")
        else:
            print(
                f"{name:34s} median {result['medianAbsMs']:6.1f} ms  "
                f"p90 {result['p90AbsMs']:6.1f} ms  "
                f"slips {result['slipCount']:3d}  "
                f"offset {result['signedMedianMs']:7.1f} ms  "
                f"({result['seconds']}s)"
            )

    ok = [r for r in rows if "error" not in r]
    ok.sort(key=lambda r: (r["slipCount"], r["medianAbsMs"], r["p90AbsMs"]))

    print("\n=== ranked (fewest subdivision slips, then tightest spread) ===")
    for r in ok[:12]:
        print(
            f"  {r['config']:34s} median {r['medianAbsMs']:6.1f}  p90 {r['p90AbsMs']:6.1f}  "
            f"max {r['maxAbsMs']:7.1f}  slips {r['slipCount']:3d}  "
            f"within25 {r['within25Pct']:5.1f}%"
        )
    if ok:
        print("\n=== best ===")
        print(format_report(ok[0]))

    if args.json:
        Path(args.json).write_text(json.dumps(rows, indent=2))
        print(f"\nwrote {args.json}")

    if tmp_holder:
        tmp_holder.cleanup()


if __name__ == "__main__":
    main()
