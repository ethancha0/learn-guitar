#!/usr/bin/env python3
"""
Offline score <-> recording alignment with SyncToolbox (MrMsDTW).

    python align/align.py \
        --recording recording.mp3 \
        --midi out/score.mid \
        --bars out/bars.json \
        --out out/sync.json \
        [--soundfont /path/to/GeneralUser.sf2] \
        [--score-duration-sec 203.3] \
        [--anchors '[{"scoreTime":82.1,"audioTime":83.7}]']

Pipeline:
    MIDI  -> fluidsynth -> reference WAV
    both  -> librosa @ 22050 Hz mono
    both  -> quantized chroma + DLNCO onset features  (SyncToolbox, 50 Hz)
    DTW   -> sync_via_mrmsdtw (or ..._with_anchors) -> monotone warping path
    path  -> clipped to the score end -> resampled {scoreTime, audioTime} points
    + diagnostics; refuses to emit a misleading map on obvious failure.

The client derives alphaTab FlatSyncPoints from `points` (simplified +
terminal-anchored), so there is exactly one source of truth for the mapping.

Writes a JSON document (see align/schema.json). On any hard failure it still
writes JSON with "status":"failed" and a message, and exits non-zero.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import traceback

FEATURE_RATE = 50  # Hz, SyncToolbox default working rate
SR = 22050


def die(out_path: str, message: str, stage: str = "align") -> None:
    doc = {"status": "failed", "stage": stage, "message": message}
    try:
        with open(out_path, "w") as fh:
            json.dump(doc, fh)
    except OSError:
        pass
    print(json.dumps(doc))
    sys.exit(1)


def render_midi_to_wav(midi_path: str, soundfont: str | None, out_wav: str) -> None:
    """MIDI -> WAV. Prefer fluidsynth; fall back to a pretty_midi sine render."""
    sf = soundfont or os.environ.get("ALIGN_SOUNDFONT")
    if sf and os.path.exists(sf):
        # fluidsynth CLI keeps this dependency-light and deterministic.
        cmd = [
            "fluidsynth", "-ni", "-F", out_wav, "-r", str(SR), "-g", "1.0",
            sf, midi_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode == 0 and os.path.exists(out_wav) and os.path.getsize(out_wav) > 1000:
            return
        # fall through to the pure-python renderer
    try:
        import numpy as np
        import pretty_midi
        import soundfile as sf_lib

        pm = pretty_midi.PrettyMIDI(midi_path)
        audio = pm.synthesize(fs=SR)  # sine-ish; still carries pitch/onset content
        if audio.size == 0:
            raise RuntimeError("empty synthesis")
        peak = float(np.max(np.abs(audio))) or 1.0
        sf_lib.write(out_wav, (audio / peak * 0.9).astype("float32"), SR)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"could not render reference audio (fluidsynth + pretty_midi both failed): {exc}"
        ) from exc


def get_features(audio, tuning_offset: float):
    """Quantized chroma + DLNCO onset features at FEATURE_RATE.

    MrMsDTW does its own multi-scale (CENS-like) downsampling internally, so it
    wants *quantized* chroma at the full feature rate — not pre-computed CENS.
    Both feature streams must share the same frame count / rate or DLNCO's
    time index overruns the buffer.
    """
    from synctoolbox.feature.chroma import pitch_to_chroma, quantize_chroma
    from synctoolbox.feature.dlnco import pitch_onset_features_to_DLNCO
    from synctoolbox.feature.pitch import audio_to_pitch_features
    from synctoolbox.feature.pitch_onset import audio_to_pitch_onset_features

    f_pitch = audio_to_pitch_features(
        f_audio=audio, Fs=SR, tuning_offset=tuning_offset,
        feature_rate=FEATURE_RATE, verbose=False,
    )
    f_chroma = pitch_to_chroma(f_pitch=f_pitch)
    f_chroma_quantized = quantize_chroma(f_chroma=f_chroma)

    f_pitch_onset = audio_to_pitch_onset_features(
        f_audio=audio, Fs=SR, tuning_offset=tuning_offset, verbose=False,
    )
    f_dlnco = pitch_onset_features_to_DLNCO(
        f_peaks=f_pitch_onset, feature_rate=FEATURE_RATE,
        feature_sequence_length=f_chroma_quantized.shape[1], visualize=False,
    )
    return f_chroma_quantized, f_dlnco


def path_to_points(wp, ref_len_sec: float, rec_len_sec: float):
    """warping path (2 x N feature frames) -> monotone {scoreTime, audioTime} list."""
    import numpy as np
    from synctoolbox.dtw.utils import make_path_strictly_monotonic

    wp = make_path_strictly_monotonic(wp)
    t_score = wp[0] / FEATURE_RATE
    t_audio = wp[1] / FEATURE_RATE

    # Uniform resample on the score axis (~1 s), keep first/last.
    step = 1.0
    grid = np.arange(t_score[0], t_score[-1], step)
    grid = np.append(grid, t_score[-1])
    audio_on_grid = np.interp(grid, t_score, t_audio)

    # Force strict monotonicity after interpolation.
    for i in range(1, len(audio_on_grid)):
        if audio_on_grid[i] <= audio_on_grid[i - 1]:
            audio_on_grid[i] = audio_on_grid[i - 1] + 1e-3

    points = [
        {"scoreTime": round(float(s), 4), "audioTime": round(float(a), 4)}
        for s, a in zip(grid, audio_on_grid)
    ]
    return points, t_score, t_audio


def diagnose(points, t_score, t_audio) -> dict:
    import numpy as np

    s = np.array([p["scoreTime"] for p in points])
    a = np.array([p["audioTime"] for p in points])
    # Global linear fit (offset + single tempo ratio) -> residuals show the
    # nonlinearity a single-offset method would miss.
    A = np.vstack([s, np.ones_like(s)]).T
    slope, intercept = np.linalg.lstsq(A, a, rcond=None)[0]
    residual = a - (slope * s + intercept)
    # Local slopes.
    ds = np.diff(s)
    local = np.diff(a) / np.where(ds == 0, 1e-9, ds)
    med = float(np.median(local)) if local.size else 1.0
    stability = float(np.mean(np.abs(local - med) < 0.15)) if local.size else 0.0

    # Suspect regions: |residual| > 120 ms.
    suspect = []
    over = np.abs(residual) > 0.120
    i = 0
    while i < len(over):
        if over[i]:
            j = i
            while j + 1 < len(over) and over[j + 1]:
                j += 1
            suspect.append(
                {
                    "scoreStart": round(float(s[i]), 2),
                    "scoreEnd": round(float(s[min(j + 1, len(s) - 1)]), 2),
                    "reason": f"{int(np.max(np.abs(residual[i:j + 1])) * 1000)} ms from global linear fit",
                }
            )
            i = j + 1
        else:
            i += 1

    return {
        "method": "dtw:mrmsdtw",
        "globalTempoRatio": round(float(slope), 5),
        "globalOffsetSec": round(float(intercept), 4),
        "residualRmsMs": round(float(np.sqrt(np.mean(residual ** 2)) * 1000), 1),
        "residualMaxMs": round(float(np.max(np.abs(residual)) * 1000), 1),
        "pathStability": round(stability, 3),
        "pathCoverageScoreSec": round(float(t_score[-1] - t_score[0]), 2),
        "suspectRegions": suspect[:20],
    }


def clip_to_score_end(points, score_end: float):
    """Trim/interpolate the path so its last point is exactly the score end.

    The reference render is longer than the score (release tails), and alphaTab
    stretches everything after our last sync point to the media duration — so an
    explicit, correct terminal point is what keeps the end of the song honest.
    """
    kept = [p for p in points if p["scoreTime"] <= score_end + 1e-6]
    if len(kept) < 2:
        return kept
    last = kept[-1]
    if last["scoreTime"] >= score_end - 1e-3:
        return kept
    # Interpolate the terminal audio time using the final local slope.
    nxt = next((p for p in points if p["scoreTime"] > last["scoreTime"]), None)
    prev = kept[-2]
    if nxt:
        span = nxt["scoreTime"] - last["scoreTime"]
        slope = (nxt["audioTime"] - last["audioTime"]) / span if span > 1e-9 else 1.0
    else:
        span = last["scoreTime"] - prev["scoreTime"]
        slope = (last["audioTime"] - prev["audioTime"]) / span if span > 1e-9 else 1.0
    kept.append(
        {
            "scoreTime": round(score_end, 4),
            "audioTime": round(
                last["audioTime"] + (score_end - last["scoreTime"]) * slope, 4
            ),
        }
    )
    return kept


def parse_anchors(raw: str | None, ref_len: float, rec_len: float):
    """JSON anchors -> SyncToolbox `anchor_pairs` [(ref_sec, rec_sec), ...].

    SyncToolbox requires anchors strictly inside both signals and monotonically
    increasing; (0,0) and (len1,len2) are rejected by the library itself, so they
    are filtered here.
    """
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        return []
    pairs = []
    for a in items:
        try:
            s = float(a["scoreTime"])
            r = float(a["audioTime"])
        except (KeyError, TypeError, ValueError):
            continue
        if 0.05 < s < ref_len - 0.05 and 0.05 < r < rec_len - 0.05:
            pairs.append((s, r))
    pairs.sort()
    # strictly increasing on both axes
    out = []
    for p in pairs:
        if not out or (p[0] > out[-1][0] + 1e-3 and p[1] > out[-1][1] + 1e-3):
            out.append(p)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--recording", required=True)
    ap.add_argument("--midi", required=True)
    ap.add_argument("--bars", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--soundfont", default=None)
    ap.add_argument("--score-duration-sec", type=float, default=None)
    ap.add_argument(
        "--anchors",
        default=None,
        help=(
            'JSON list of trusted manual anchors, e.g. \'[{"scoreTime":82.14,'
            '"audioTime":83.72}]\'. When given, MrMsDTW solves each region '
            "*between* consecutive anchors instead of the whole song globally."
        ),
    )
    args = ap.parse_args()

    try:
        import librosa
        import numpy as np
        from synctoolbox.dtw.mrmsdtw import (
            sync_via_mrmsdtw,
            sync_via_mrmsdtw_with_anchors,
        )
        from synctoolbox.feature.utils import estimate_tuning
    except Exception as exc:  # noqa: BLE001
        die(args.out, f"missing python deps: {exc}. See align/README.md", "import")

    try:
        with open(args.bars) as fh:
            bars_doc = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        die(args.out, f"could not read bars.json: {exc}", "bars")

    with tempfile.TemporaryDirectory() as tmp:
        ref_wav = os.path.join(tmp, "ref.wav")
        try:
            render_midi_to_wav(args.midi, args.soundfont, ref_wav)
        except Exception as exc:  # noqa: BLE001
            die(args.out, str(exc), "render")

        try:
            ref_audio, _ = librosa.load(ref_wav, sr=SR, mono=True)
            rec_audio, _ = librosa.load(args.recording, sr=SR, mono=True)
        except Exception as exc:  # noqa: BLE001
            die(args.out, f"could not decode audio: {exc}", "decode")

        if ref_audio.size < SR or rec_audio.size < SR:
            die(args.out, "reference or recording shorter than 1 s", "decode")

        try:
            tuning_ref = estimate_tuning(ref_audio, SR)
            tuning_rec = estimate_tuning(rec_audio, SR)
            f_chroma_ref, f_dlnco_ref = get_features(ref_audio, tuning_ref)
            f_chroma_rec, f_dlnco_rec = get_features(rec_audio, tuning_rec)
        except Exception as exc:  # noqa: BLE001
            die(args.out, f"feature extraction failed: {exc}\n{traceback.format_exc()}", "features")

        ref_len_pre = ref_audio.size / SR
        rec_len_pre = rec_audio.size / SR
        anchor_pairs = parse_anchors(args.anchors, ref_len_pre, rec_len_pre)
        method = "dtw:mrmsdtw"

        common = dict(
            f_chroma1=f_chroma_ref,
            f_onset1=f_dlnco_ref,
            f_chroma2=f_chroma_rec,
            f_onset2=f_dlnco_rec,
            input_feature_rate=FEATURE_RATE,
            verbose=False,
        )
        try:
            if anchor_pairs:
                # Region-wise refinement: each interval between consecutive
                # trusted anchors is solved independently, so a bad chorus or a
                # transcription error cannot drag the rest of the song with it.
                method = "dtw:mrmsdtw+anchors"
                wp = sync_via_mrmsdtw_with_anchors(
                    **common, anchor_pairs=anchor_pairs
                )
            else:
                wp = sync_via_mrmsdtw(**common)
        except Exception as exc:  # noqa: BLE001
            die(args.out, f"MrMsDTW failed: {exc}", "dtw")

        ref_len = ref_audio.size / SR
        rec_len = rec_audio.size / SR
        points, t_score, t_audio = path_to_points(wp, ref_len, rec_len)
        if len(points) < 2:
            die(args.out, "warping path collapsed to < 2 points", "dtw")

        # The DTW path lives in *rendered reference* time, which runs past the
        # score end by the synth's release tail. Trim there so the map never
        # claims score positions that do not exist.
        score_end = args.score_duration_sec or bars_doc.get("endSec")
        if score_end:
            points = clip_to_score_end(points, float(score_end))
            if len(points) < 2:
                die(args.out, "no alignment points inside the score range", "dtw")

        diag = diagnose(points, t_score, t_audio)

        status = "ok"
        message = f"{len(points)} points; RMS {diag['residualRmsMs']} ms from linear fit."
        # Obvious-failure guards: refuse to emit a misleading map.
        if diag["pathStability"] < 0.35 or diag["residualRmsMs"] > 900:
            status = "failed"
            message = (
                "Alignment looks unreliable (unstable warping path). The score and "
                "recording may be different songs or the arrangements differ a lot."
            )
        elif diag["residualRmsMs"] > 250 or diag["pathStability"] < 0.6:
            status = "low-confidence"
            message = (
                f"Aligned, but with low confidence (RMS {diag['residualRmsMs']} ms, "
                f"stability {diag['pathStability']}). Review flagged sections."
            )

        doc = {
            "status": status,
            "method": method,
            "message": message,
            "featureRate": FEATURE_RATE,
            "anchorCount": len(anchor_pairs),
            "referenceDurationSec": round(ref_len, 3),
            "recordingDurationSec": round(rec_len, 3),
            "scoreDurationSec": score_end,
            # `points` is the single source of truth. The client derives alphaTab
            # FlatSyncPoints from it (simplified + terminal-anchored) so the curve
            # the cursor follows is provably the one scoring uses.
            "points": points if status != "failed" else [],
            "diagnostics": diag,
        }
        with open(args.out, "w") as fh:
            json.dump(doc, fh)
        print(json.dumps({k: doc[k] for k in ("status", "method", "message")}))
        sys.exit(0 if status != "failed" else 2)


if __name__ == "__main__":
    main()
