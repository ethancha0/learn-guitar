#!/usr/bin/env python3
"""
Offline score <-> recording alignment with SyncToolbox (MrMsDTW).

    python align/align.py \
        --recording recording.mp3 \
        --midi out/score.mid \
        --bars out/bars.json \
        --out out/sync.json \
        [--soundfont /path/to/GeneralUser.sf2] [--require-soundfont] \
        [--score-duration-sec 203.3] \
        [--feature-rate 50] [--alpha 0.5] [--snap off|bars|beats] \
        [--anchors '[{"scoreTime":82.1,"audioTime":83.7}]']

Pipeline:
    MIDI  -> fluidsynth -> reference WAV
    both  -> librosa @ 22050 Hz mono
    both  -> quantized chroma + DLNCO onset features  (SyncToolbox)
    DTW   -> sync_via_mrmsdtw (or ..._with_anchors) -> monotone warping path
    path  -> clipped to the score end -> resampled {scoreTime, audioTime} points
    + diagnostics; refuses to emit a misleading map on obvious failure.

The client derives alphaTab FlatSyncPoints from `points` (sampled at bar and
beat positions), so there is exactly one source of truth for the mapping.

## Tuning for fast material

At 170 BPM a sixteenth note is 88 ms, so anything that blurs the timeline by
~100 ms can slide the alignment a whole subdivision. Two knobs are set away
from the library defaults, and both were chosen by measurement (`sweep.py`,
scored by `evaluate.py`) rather than by argument:

* **Feature rate.** `--fast-profile auto` raises it to 100 Hz (10 ms frames)
  above `FAST_BPM`. On a 170 BPM fixture this halved the residual spread
  (median 5.3 -> 2.6 ms, p90 11.7 -> 5.7 ms) at no measured runtime cost — the
  pitch filterbank dominates extraction and runs at the sample rate either way.
* **`step_weights` / `threshold_rec`** follow SyncToolbox's own
  `sync_audio_audio` recommendation. With the library default `[1, 1, 1]` a
  horizontal or vertical step is as cheap as a diagonal, so the path can
  staircase. Measured neutral on a clean fixture; kept because it is the
  upstream recommendation and cannot hurt.

Two knobs that *look* like they should help at speed are deliberately left at
the library defaults, because measuring them said otherwise:

* Shortening the **DLNCO decay** to about one subdivision (the default smears
  each onset over 10 frames = 200 ms at 50 Hz) made results slightly worse on
  every fixture tried, and clearly worse with a weak reference render.
* Lowering **`alpha`** to weight onsets over chroma was the most harmful single
  change measured (median 13.7 -> 25.3 ms, 0 -> 5 subdivision slips, on a
  sine-fallback reference).

Both remain flags so `sweep.py` can revisit them on dense polyphonic material,
which is the case the original reasoning was about and which a sparse fixture
does not exercise.

**The dominant factor is none of the above — it is the reference render.**
Holding everything else constant, swapping the drumless, transient-free
`pretty_midi` fallback for a percussive render took the median residual from
25.3 ms to 6.2 ms and subdivision slips from 5 to 1. Use a soundfont.

Writes a JSON document (see align/schema.json). On any hard failure it still
writes JSON with "status":"failed" and a message, and exits non-zero.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import subprocess
import sys
import tempfile
import traceback
from dataclasses import dataclass, field
from pathlib import Path

SR = 22050
DEFAULT_FEATURE_RATE = 50  # Hz, SyncToolbox's working rate
#: Feature rate used above FAST_BPM — 10 ms frames instead of 20.
FAST_FEATURE_RATE = 100
#: Tempo above which the fast-song profile kicks in.
FAST_BPM = 140
#: SyncToolbox's DLNCO decay length, in frames.
DEFAULT_DLNCO_DECAY = 10
#: SyncToolbox's recommended step weights (its own demo notebook), not the
#: library defaults — see the module docstring.
DEFAULT_STEP_WEIGHTS = (1.5, 1.5, 2.0)
DEFAULT_THRESHOLD_REC = 10 ** 6

_ALIGN_DIR = str(Path(__file__).resolve().parent)
if _ALIGN_DIR not in sys.path:
    sys.path.insert(0, _ALIGN_DIR)


@dataclass
class AlignConfig:
    """Everything the DTW stage can be tuned on. One object so `sweep.py` can
    vary a single field and re-use cached features for the rest."""

    feature_rate: int = DEFAULT_FEATURE_RATE
    alpha: float = 0.5
    step_weights: tuple[float, float, float] = DEFAULT_STEP_WEIGHTS
    threshold_rec: int = DEFAULT_THRESHOLD_REC
    #: DLNCO decay length in frames; `None` = SyncToolbox default (10).
    dlnco_decay_frames: int | None = None
    #: Score-axis spacing of the emitted grid, before bar/beat times are unioned in.
    grid_sec: float = 0.25
    snap: str = "off"  # off | bars | beats
    require_soundfont: bool = False

    def as_diagnostics(self) -> dict:
        return {
            "featureRate": self.feature_rate,
            "alpha": round(self.alpha, 3),
            "stepWeights": list(self.step_weights),
            "thresholdRec": self.threshold_rec,
            "dlncoDecayFrames": self.dlnco_decay_frames,
            "gridSec": self.grid_sec,
            "snapMode": self.snap,
        }


def fast_profile(config: AlignConfig, tempo_bpm: float | None, explicit=()) -> AlignConfig:
    """Raise the feature rate on fast songs.

    Only the feature rate is profiled. Lowering `alpha` and shortening the
    DLNCO decay were both measured as neutral-to-harmful (see the module
    docstring), so they stay at the library defaults and are left to `sweep.py`.

    ``explicit`` names fields the user set on the command line; those are never
    overridden.
    """
    if config.dlnco_decay_frames is None:
        config.dlnco_decay_frames = DEFAULT_DLNCO_DECAY
    if not tempo_bpm or tempo_bpm < FAST_BPM:
        return config
    if "feature_rate" not in explicit:
        # 10 ms frames instead of 20. A sixteenth at 170 BPM is 88 ms, which is
        # only 4.4 frames at 50 Hz — not much to place an attack within.
        config.feature_rate = FAST_FEATURE_RATE
    return config


def decay_frames_for(tempo_bpm: float | None, feature_rate: int) -> int:
    """DLNCO decay length ~= one sixteenth note, clamped to a sane range.

    Not used by the default profile — kept because it is the natural axis for
    `sweep.py` to search when revisiting the decay on dense material.
    """
    if not tempo_bpm or tempo_bpm <= 0:
        return DEFAULT_DLNCO_DECAY
    sixteenth_sec = (60.0 / tempo_bpm) / 4.0
    return int(max(3, min(DEFAULT_DLNCO_DECAY, round(sixteenth_sec * feature_rate))))


def subdivision_sec(tempo_bpm: float | None) -> float:
    """Sixteenth-note duration, the yardstick for "how far is one slip"."""
    if not tempo_bpm or tempo_bpm <= 0:
        return 0.125
    return (60.0 / tempo_bpm) / 4.0


@contextlib.contextmanager
def stdout_to_stderr():
    """Keep library chatter off stdout.

    SyncToolbox's pitch filterbanks print a dot per MIDI pitch *regardless of
    their `verbose` flag* (`feature/pitch.py:99`, `feature/pitch_onset.py:118`),
    and they print without a newline. This script's contract with
    `app/api/align/route.ts` is that stdout carries a JSON document, so those
    dots would run into the JSON and make it unparseable.
    """
    saved = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = saved


def die(out_path: str, message: str, stage: str = "align") -> None:
    doc = {"status": "failed", "stage": stage, "message": message}
    try:
        with open(out_path, "w") as fh:
            json.dump(doc, fh)
    except OSError:
        pass
    print(json.dumps(doc))
    sys.exit(1)


# --- reference render --------------------------------------------------------


def render_midi_to_wav(
    midi_path: str,
    soundfont: str | None,
    out_wav: str,
    require_soundfont: bool = False,
) -> str:
    """MIDI -> WAV. Prefer fluidsynth; fall back to pretty_midi sine render.

    Returns ``referenceRender``: ``"soundfont"`` or ``"sine-fallback"``.

    The fallback is much worse than it looks, which is why
    ``require_soundfont`` exists: `PrettyMIDI.synthesize` returns **silence for
    drum tracks** and pure sines with no attack transient for everything else.
    That deletes the percussive backbone DLNCO onset features depend on, and
    leaves DTW matching a smooth drumless render against a full band mix.
    """
    sf = soundfont or os.environ.get("ALIGN_SOUNDFONT")
    if sf and os.path.exists(sf):
        # fluidsynth CLI keeps this dependency-light and deterministic.
        # -R 0 / -C 0 disable reverb and chorus: both smear exactly the
        # transients the onset features need to localise.
        cmd = [
            "fluidsynth", "-ni", "-F", out_wav, "-r", str(SR), "-g", "1.0",
            "-R", "0", "-C", "0",
            sf, midi_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode == 0 and os.path.exists(out_wav) and os.path.getsize(out_wav) > 1000:
            return "soundfont"
        if require_soundfont:
            raise RuntimeError(
                f"fluidsynth failed to render the reference ({proc.stderr.strip()[:300]}). "
                "Is fluid-synth installed and ALIGN_SOUNDFONT a valid .sf2?"
            )
        # fall through to the pure-python renderer
    elif require_soundfont:
        raise RuntimeError(
            "--require-soundfont was set but no soundfont is configured. "
            "Install fluidsynth and point ALIGN_SOUNDFONT (or --soundfont) at a "
            "General MIDI .sf2. See align/README.md."
        )

    try:
        import numpy as np
        import pretty_midi
        import soundfile as sf_lib

        pm = pretty_midi.PrettyMIDI(midi_path)
        audio = pm.synthesize(fs=SR)  # sine-ish; drums are silent
        if audio.size == 0:
            raise RuntimeError("empty synthesis")
        peak = float(np.max(np.abs(audio))) or 1.0
        sf_lib.write(out_wav, (audio / peak * 0.9).astype("float32"), SR)
        return "sine-fallback"
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"could not render reference audio (fluidsynth + pretty_midi both failed): {exc}"
        ) from exc


def load_audio(path: str):
    import librosa

    audio, _ = librosa.load(path, sr=SR, mono=True)
    return audio


def midi_onset_times(midi_path: str) -> list[float]:
    """Note-on times from the reference MIDI, seconds. Used to decide which
    grid points actually have a notated attack to snap onto."""
    try:
        import pretty_midi

        pm = pretty_midi.PrettyMIDI(midi_path)
        return sorted(n.start for inst in pm.instruments for n in inst.notes)
    except Exception:  # noqa: BLE001
        return []


# --- features ----------------------------------------------------------------


@dataclass
class Features:
    chroma: object
    dlnco: object
    tuning: float = 0.0
    #: Cached raw pitch-onset peaks; DLNCO can be recomputed from these with a
    #: different decay without re-running the (expensive) filterbank.
    peaks: object = field(default=None, repr=False)


def estimate_tuning_offset(audio) -> float:
    from synctoolbox.feature.utils import estimate_tuning

    return estimate_tuning(audio, SR)


def extract_chroma(audio, tuning_offset: float, feature_rate: int):
    """Quantized chroma at ``feature_rate``.

    MrMsDTW does its own multi-scale (CENS-like) downsampling internally, so it
    wants *quantized* chroma at the full feature rate — not pre-computed CENS.
    """
    from synctoolbox.feature.chroma import pitch_to_chroma, quantize_chroma
    from synctoolbox.feature.pitch import audio_to_pitch_features

    with stdout_to_stderr():
        f_pitch = audio_to_pitch_features(
            f_audio=audio, Fs=SR, tuning_offset=tuning_offset,
            feature_rate=feature_rate, verbose=False,
        )
    return quantize_chroma(f_chroma=pitch_to_chroma(f_pitch=f_pitch))


def extract_peaks(audio, tuning_offset: float):
    """Raw pitch-onset peaks (times in ms). Independent of feature rate and of
    the DLNCO decay, so a sweep extracts them once per signal."""
    from synctoolbox.feature.pitch_onset import audio_to_pitch_onset_features

    with stdout_to_stderr():
        return audio_to_pitch_onset_features(
            f_audio=audio, Fs=SR, tuning_offset=tuning_offset, verbose=False,
        )


def peaks_to_dlnco(peaks, feature_rate: int, length: int, decay_frames: int | None):
    """DLNCO onset features. ``decay_frames`` shortens SyncToolbox's decay tail.

    The library default is 10 frames — 200 ms at 50 Hz, which is more than two
    sixteenth notes at 170 BPM, so adjacent onsets merge into one ridge and the
    feature can no longer say *which* subdivision an attack belongs to.

    Both feature streams must share the frame count of the chroma or DLNCO's
    time index overruns the buffer.
    """
    import numpy as np
    from synctoolbox.feature.dlnco import pitch_onset_features_to_DLNCO

    kwargs = {}
    if decay_frames:
        kwargs["DLNCO_filtercoef"] = np.sqrt(1 / np.arange(1, int(decay_frames) + 1))
    return pitch_onset_features_to_DLNCO(
        f_peaks=peaks, feature_rate=feature_rate,
        feature_sequence_length=length, visualize=False, **kwargs,
    )


def extract_features(audio, config: AlignConfig, tuning_offset: float | None = None) -> Features:
    tuning = estimate_tuning_offset(audio) if tuning_offset is None else tuning_offset
    chroma = extract_chroma(audio, tuning, config.feature_rate)
    peaks = extract_peaks(audio, tuning)
    dlnco = peaks_to_dlnco(
        peaks, config.feature_rate, chroma.shape[1], config.dlnco_decay_frames
    )
    return Features(chroma=chroma, dlnco=dlnco, tuning=tuning, peaks=peaks)


# --- DTW ---------------------------------------------------------------------


def run_dtw(ref: Features, rec: Features, config: AlignConfig, anchor_pairs=None):
    """MrMsDTW over the two feature streams. Returns ``(warping_path, method)``."""
    import numpy as np
    from synctoolbox.dtw.mrmsdtw import (
        sync_via_mrmsdtw,
        sync_via_mrmsdtw_with_anchors,
    )

    common = dict(
        f_chroma1=ref.chroma,
        f_onset1=ref.dlnco,
        f_chroma2=rec.chroma,
        f_onset2=rec.dlnco,
        input_feature_rate=config.feature_rate,
        step_weights=np.array(config.step_weights, dtype=np.float64),
        threshold_rec=config.threshold_rec,
        alpha=config.alpha,
        verbose=False,
    )
    if anchor_pairs:
        # Region-wise refinement: each interval between consecutive trusted
        # anchors is solved independently, so a bad chorus or a transcription
        # error cannot drag the rest of the song with it.
        return sync_via_mrmsdtw_with_anchors(**common, anchor_pairs=anchor_pairs), "dtw:mrmsdtw+anchors"
    return sync_via_mrmsdtw(**common), "dtw:mrmsdtw"


# --- path -> points ----------------------------------------------------------


def build_points(wp, feature_rate: int, bars_doc=None, grid_sec: float = 0.25):
    """Warping path (2 x N feature frames) -> monotone {scoreTime, audioTime}.

    The grid is the union of a fine fixed ruler and every bar downbeat and beat
    from `bars.json`. Both halves matter:

    * The bar/beat vertices are exactly where the client resamples the curve
      when it builds alphaTab sync points, so the curve alphaTab follows
      reproduces the DTW path there instead of chording across it.
    * The fine ruler keeps sub-beat detail for the scoring clock, and stops a
      single bad vertex from tilting a whole bar.

    Collapsing onto bar downbeats alone (~1.4 s apart at 170 BPM) threw away
    most of the path's own 20 ms resolution.
    """
    import numpy as np
    from synctoolbox.dtw.utils import make_path_strictly_monotonic

    wp = make_path_strictly_monotonic(wp)
    t_score = wp[0] / feature_rate
    t_audio = wp[1] / feature_rate

    grid: list[float] = []
    if grid_sec > 0:
        grid.extend(np.arange(t_score[0], t_score[-1], grid_sec).tolist())
    grid.append(float(t_score[0]))
    grid.append(float(t_score[-1]))

    if bars_doc:
        for b in bars_doc.get("bars") or []:
            grid.append(float(b.get("startSec", b.get("scoreTime", 0))))
        for t in bars_doc.get("beats") or []:
            grid.append(float(t))
        end = bars_doc.get("endSec")
        if end is not None:
            grid.append(float(end))

    lo, hi = float(t_score[0]), float(t_score[-1])
    ordered = sorted(t for t in grid if lo - 1e-9 <= t <= hi + 1e-9)
    deduped: list[float] = []
    for t in ordered:
        if not deduped or t > deduped[-1] + 1e-3:
            deduped.append(t)
    if len(deduped) < 2:
        return [], t_score, t_audio

    grid_arr = np.array(deduped)
    audio_on_grid = np.interp(grid_arr, t_score, t_audio)

    # Force strict monotonicity after interpolation.
    for i in range(1, len(audio_on_grid)):
        if audio_on_grid[i] <= audio_on_grid[i - 1]:
            audio_on_grid[i] = audio_on_grid[i - 1] + 1e-3

    points = [
        {"scoreTime": round(float(s), 4), "audioTime": round(float(a), 4)}
        for s, a in zip(grid_arr, audio_on_grid)
    ]
    return points, t_score, t_audio


def _median_slope(points) -> float:
    """Typical audio-per-score slope, robust to a few pathological segments."""
    slopes = []
    for a, b in zip(points, points[1:]):
        dx = b["scoreTime"] - a["scoreTime"]
        if dx > 1e-9:
            slopes.append((b["audioTime"] - a["audioTime"]) / dx)
    if not slopes:
        return 1.0
    slopes.sort()
    return slopes[len(slopes) // 2]


def clip_to_score_end(points, score_end: float, rec_len: float, max_slope_factor: float = 3.0):
    """Trim the path to the score end, repairing DTW end-effects.

    Two things go wrong at the tail:

    * The reference render outlasts the score (release tails), so the path
      continues past the last bar.
    * The final frames often go near-vertical — the decay tail matching the
      recording's outro — so audio races ahead while the score barely moves.
      Extrapolating on that slope throws the terminal point seconds past the end
      of the recording, and the audio then finishes before the cursor does.

    So: drop the degenerate tail, extrapolate on the *median* slope, and never
    emit a point at or beyond the recording duration.
    """
    kept = [p for p in points if p["scoreTime"] <= score_end + 1e-6]
    if len(kept) < 2:
        return kept

    median = _median_slope(kept)

    # Drop trailing points whose slope is far outside the song's tempo ratio.
    while len(kept) > 2:
        dx = kept[-1]["scoreTime"] - kept[-2]["scoreTime"]
        if dx <= 1e-9:
            break
        slope = (kept[-1]["audioTime"] - kept[-2]["audioTime"]) / dx
        if slope <= median * max_slope_factor:
            break
        kept.pop()

    audio_max = rec_len - 0.005
    kept = [p for p in kept if p["audioTime"] <= audio_max]
    if len(kept) < 2:
        return kept

    last = kept[-1]
    if last["scoreTime"] < score_end - 1e-3:
        terminal = last["audioTime"] + (score_end - last["scoreTime"]) * median
        if terminal > last["audioTime"] + 1e-3:
            kept.append(
                {
                    "scoreTime": round(score_end, 4),
                    "audioTime": round(min(terminal, audio_max), 4),
                }
            )
    return kept


# --- diagnostics -------------------------------------------------------------


def diagnose(points, method: str = "dtw:mrmsdtw") -> dict:
    """Shape statistics for the emitted curve.

    Computed on a **1 s resampling** of the curve rather than on the emitted
    points. `pathStability` counts segments whose local slope sits near the
    median, so it is sensitive to grid spacing: on the 0.25 s grid the same
    curve would score far worse than on the old 1 s grid purely because short
    segments amplify slope noise, and the `< 0.6` / `< 0.35` status gates below
    would start firing on healthy alignments. Resampling first keeps the
    numbers comparable across grid settings.
    """
    import numpy as np

    dense_s = np.array([p["scoreTime"] for p in points])
    dense_a = np.array([p["audioTime"] for p in points])
    if dense_s.size < 2:
        return {"method": method}

    step = 1.0
    grid = np.arange(dense_s[0], dense_s[-1], step)
    grid = np.append(grid, dense_s[-1])
    s = grid
    a = np.interp(grid, dense_s, dense_a)

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
        "method": method,
        "globalTempoRatio": round(float(slope), 5),
        "globalOffsetSec": round(float(intercept), 4),
        "residualRmsMs": round(float(np.sqrt(np.mean(residual ** 2)) * 1000), 1),
        "residualMaxMs": round(float(np.max(np.abs(residual)) * 1000), 1),
        "pathStability": round(stability, 3),
        "pathCoverageScoreSec": round(float(dense_s[-1] - dense_s[0]), 2),
        "suspectRegions": suspect[:20],
    }


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


# --- orchestration -----------------------------------------------------------


def apply_snap(points, rec_audio, bars_doc, midi_path: str, config: AlignConfig, tempo: float | None):
    """Run the onset snapper according to ``config.snap``. Returns (points, stats)."""
    from snap import snap_points_to_onsets

    if config.snap == "off":
        return points, {"snapMode": "off"}

    candidates: list[float] = [
        float(b.get("startSec", 0)) for b in (bars_doc.get("bars") or [])
    ]
    if config.snap == "beats":
        candidates.extend(float(t) for t in (bars_doc.get("beats") or []))
    score_onsets = midi_onset_times(midi_path)
    if not score_onsets:
        return points, {"snapMode": config.snap, "snapSkipped": "no MIDI note onsets"}

    # Never search more than a fraction of a subdivision: a window that spans a
    # whole sixteenth is how the previous version snapped to the wrong note.
    window = min(0.08, 0.4 * subdivision_sec(tempo))
    snapped, stats = snap_points_to_onsets(
        points,
        rec_audio,
        SR,
        candidate_score_times=candidates,
        score_onset_times=score_onsets,
        window_sec=window,
    )
    stats["snapMode"] = config.snap
    stats["snapWindowMs"] = round(window * 1000, 1)
    return snapped, stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--recording", required=True)
    ap.add_argument("--midi", required=True)
    ap.add_argument("--bars", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--soundfont", default=None)
    ap.add_argument(
        "--require-soundfont",
        action="store_true",
        help=(
            "Fail instead of falling back to the pretty_midi sine renderer. That "
            "fallback renders drum tracks as silence and has no attack "
            "transients, which costs a lot of accuracy on fast material."
        ),
    )
    ap.add_argument("--score-duration-sec", type=float, default=None)
    ap.add_argument("--feature-rate", type=int, default=None,
                    help="DTW feature rate in Hz (50 = 20 ms frames, 100 = 10 ms). "
                         f"Default {DEFAULT_FEATURE_RATE}, raised to {FAST_FEATURE_RATE} "
                         f"above {FAST_BPM} BPM by --fast-profile auto.")
    ap.add_argument("--alpha", type=float, default=0.5,
                    help="Chroma weight in the finest-level cost; 1-alpha goes to DLNCO onsets.")
    ap.add_argument("--step-weights", default=",".join(str(w) for w in DEFAULT_STEP_WEIGHTS),
                    help="Comma-separated DTW step weights for [1,0], [0,1], [1,1].")
    ap.add_argument("--threshold-rec", type=int, default=DEFAULT_THRESHOLD_REC)
    ap.add_argument("--dlnco-decay-frames", type=int, default=None,
                    help="DLNCO decay length in frames; default is derived from the score tempo.")
    ap.add_argument("--grid-sec", type=float, default=0.25,
                    help="Score-axis spacing of the emitted grid; bar and beat times are added on top.")
    ap.add_argument("--snap", choices=("off", "bars", "beats"), default="off",
                    help="Onset de-jittering of notated bar/beat positions. Off by default until measured.")
    ap.add_argument("--fast-profile", choices=("auto", "off"), default="auto",
                    help="Derive fast-song defaults from the score tempo.")
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
        step_weights = tuple(float(w) for w in args.step_weights.split(","))
        if len(step_weights) != 3:
            raise ValueError("expected 3 comma-separated values")
    except ValueError as exc:
        die(args.out, f"bad --step-weights: {exc}", "args")

    config = AlignConfig(
        feature_rate=args.feature_rate or DEFAULT_FEATURE_RATE,
        alpha=args.alpha,
        step_weights=step_weights,
        threshold_rec=args.threshold_rec,
        dlnco_decay_frames=args.dlnco_decay_frames,
        grid_sec=args.grid_sec,
        snap=args.snap,
        require_soundfont=args.require_soundfont,
    )

    try:
        import librosa  # noqa: F401
        import numpy as np  # noqa: F401
        import synctoolbox  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        die(args.out, f"missing python deps: {exc}. See align/README.md", "import")

    try:
        with open(args.bars) as fh:
            bars_doc = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        die(args.out, f"could not read bars.json: {exc}", "bars")

    tempo = bars_doc.get("tempo")
    explicit = {"feature_rate"} if args.feature_rate is not None else set()
    if args.fast_profile == "auto":
        config = fast_profile(config, tempo, explicit)
    elif config.dlnco_decay_frames is None:
        config.dlnco_decay_frames = DEFAULT_DLNCO_DECAY

    with tempfile.TemporaryDirectory() as tmp:
        ref_wav = os.path.join(tmp, "ref.wav")
        reference_render = "unknown"
        try:
            reference_render = render_midi_to_wav(
                args.midi, args.soundfont, ref_wav, config.require_soundfont
            )
        except Exception as exc:  # noqa: BLE001
            die(args.out, str(exc), "render")

        try:
            ref_audio = load_audio(ref_wav)
            rec_audio = load_audio(args.recording)
        except Exception as exc:  # noqa: BLE001
            die(args.out, f"could not decode audio: {exc}", "decode")

        if ref_audio.size < SR or rec_audio.size < SR:
            die(args.out, "reference or recording shorter than 1 s", "decode")

        try:
            ref_feats = extract_features(ref_audio, config)
            rec_feats = extract_features(rec_audio, config)
        except Exception as exc:  # noqa: BLE001
            die(args.out, f"feature extraction failed: {exc}\n{traceback.format_exc()}", "features")

        ref_len = ref_audio.size / SR
        rec_len = rec_audio.size / SR
        anchor_pairs = parse_anchors(args.anchors, ref_len, rec_len)

        try:
            wp, method = run_dtw(ref_feats, rec_feats, config, anchor_pairs)
        except Exception as exc:  # noqa: BLE001
            die(args.out, f"MrMsDTW failed: {exc}", "dtw")

        points, _t_score, _t_audio = build_points(
            wp, config.feature_rate, bars_doc, config.grid_sec
        )
        if len(points) < 2:
            die(args.out, "warping path collapsed to < 2 points", "dtw")

        # The DTW path lives in *rendered reference* time, which runs past the
        # score end by the synth's release tail, and its final frames are often a
        # degenerate near-vertical run. Repair both, and keep every point inside
        # the recording.
        score_end = args.score_duration_sec or bars_doc.get("endSec")
        if score_end:
            points = clip_to_score_end(points, float(score_end), rec_len)
            if len(points) < 2:
                die(args.out, "no alignment points inside the score range", "dtw")

        points, snap_stats = apply_snap(points, rec_audio, bars_doc, args.midi, config, tempo)

        diag = diagnose(points, method)
        diag["referenceRender"] = reference_render
        diag.update(config.as_diagnostics())
        diag.update(snap_stats)

        status = "ok"
        message = f"{len(points)} points; RMS {diag['residualRmsMs']} ms from linear fit."
        if reference_render == "sine-fallback":
            status = "low-confidence"
            message = (
                f"Aligned with sine-fallback reference (no soundfont; drums are "
                f"silent and there are no attack transients). Set ALIGN_SOUNDFONT "
                f"for better accuracy. {message}"
            )
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
            "featureRate": config.feature_rate,
            "anchorCount": len(anchor_pairs),
            "referenceDurationSec": round(ref_len, 3),
            "recordingDurationSec": round(rec_len, 3),
            "scoreDurationSec": score_end,
            # `points` is the single source of truth. The client derives alphaTab
            # FlatSyncPoints from it (sampled at bar/beat positions) so the curve
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
