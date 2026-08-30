"""Post-DTW onset snapping — de-jitter the warp curve against the recording.

## What went wrong before

The first version moved *every* map point to the strongest `onset_strength`
frame within ±100 ms. On a fast song that is actively harmful:

* ±100 ms is wider than a sixteenth note at 170 BPM (88 ms), so "the strongest
  onset nearby" is routinely the neighbouring subdivision rather than the
  intended position — the exact one-subdivision slip we are trying to remove.
* It snapped points that are not musical positions at all. On the 1 s fallback
  grid nothing says a point should coincide with an attack, so snapping it is
  pure noise injection.
* It never asked whether the *score* has an attack there, and `argmax` over a
  handful of hop frames is not peak picking.

## What this does instead

Snapping is now a **relative** correction and nothing else:

1. Only points that are both a musical position (bar downbeat, or beat) *and*
   carry a notated attack are candidates. Everything else is left alone.
2. The search window is derived from the tempo, so it can never span a whole
   subdivision.
3. Every candidate shift is measured, then the **median shift is subtracted**.
   That deliberately throws away any global offset: the detector has a
   systematic lag (see `onsets.onset_envelope`) and DTW's chroma term is the
   thing that should own global alignment. Snapping only fixes points that are
   off *relative to their neighbours*.
4. A shift is applied only when it agrees with the local median. A point that
   wants to jump a subdivision while its neighbours are steady is rejected, not
   baked in.
"""
from __future__ import annotations

from onsets import HOP, find_peak, median, onset_envelope

#: A point counts as "on" a musical position / notated attack within this much.
MATCH_TOL_SEC = 0.015
#: Number of neighbouring candidates used for the local-median agreement test.
LOCAL_NEIGHBOURS = 8
#: Below this many measurable candidates there is not enough evidence to snap.
MIN_CANDIDATES = 8


def snap_points_to_onsets(
    points: list[dict],
    rec_audio,
    sr: int,
    *,
    candidate_score_times,
    score_onset_times,
    window_sec: float,
    hop: int = HOP,
) -> tuple[list[dict], dict]:
    """De-jitter ``points`` against onsets in the recording.

    ``candidate_score_times`` — musical positions eligible for snapping (bar
    downbeats, or bar+beat times), in score seconds.
    ``score_onset_times`` — note-on times from the reference MIDI, score
    seconds; a candidate with no notated attack is skipped.
    ``window_sec`` — half-width of the onset search, tempo-derived by the
    caller.

    Returns ``(points, stats)``; ``points`` is a new list, never mutated in
    place, and stays strictly increasing on the audio axis.
    """
    import numpy as np

    stats = {
        "snapMode": "on",
        "snapCandidates": 0,
        "snapMeasured": 0,
        "snapAppliedCount": 0,
        "snapRejectedCount": 0,
        "snapGlobalMedianMs": 0.0,
        "snapMaxMs": 0.0,
        "snapMeanAbsMs": 0.0,
    }
    if len(points) < 2 or window_sec <= 0:
        return list(points), stats

    cand = np.asarray(sorted(candidate_score_times), dtype=float)
    notes = np.asarray(sorted(score_onset_times), dtype=float)
    if cand.size == 0 or notes.size == 0:
        return list(points), stats

    def near(sorted_arr, value: float) -> bool:
        i = int(np.searchsorted(sorted_arr, value))
        for j in (i - 1, i):
            if 0 <= j < sorted_arr.size and abs(sorted_arr[j] - value) <= MATCH_TOL_SEC:
                return True
        return False

    eligible = [
        i
        for i, p in enumerate(points)
        if near(cand, float(p["scoreTime"])) and near(notes, float(p["scoreTime"]))
    ]
    stats["snapCandidates"] = len(eligible)
    if len(eligible) < MIN_CANDIDATES:
        return list(points), stats

    env, hop_sec = onset_envelope(rec_audio, sr, hop=hop)

    measured: list[tuple[int, float]] = []  # (point index, raw shift seconds)
    for i in eligible:
        target = float(points[i]["audioTime"])
        peak, _strength = find_peak(env, hop_sec, target, window_sec)
        if peak is not None:
            measured.append((i, peak - target))
    stats["snapMeasured"] = len(measured)
    if len(measured) < MIN_CANDIDATES:
        return list(points), stats

    # Subtract the global median: snapping corrects local jitter, never the
    # song's overall offset.
    shifts = [s for _, s in measured]
    global_shift = median(shifts)
    stats["snapGlobalMedianMs"] = round(global_shift * 1000, 1)
    relative = [(i, s - global_shift) for i, s in measured]

    # Agreement test against the local median, then apply.
    tolerance = window_sec / 2
    applied: dict[int, float] = {}
    for k, (i, rel) in enumerate(relative):
        lo = max(0, k - LOCAL_NEIGHBOURS)
        hi = min(len(relative), k + LOCAL_NEIGHBOURS + 1)
        local = median([r for _, r in relative[lo:hi]])
        if abs(rel - local) <= tolerance:
            applied[i] = rel
        else:
            stats["snapRejectedCount"] += 1

    out: list[dict] = []
    prev_audio = -1.0
    for i, p in enumerate(points):
        audio = float(p["audioTime"]) + applied.get(i, 0.0)
        audio = max(audio, prev_audio + 1e-3)
        q = dict(p)
        q["audioTime"] = round(audio, 4)
        out.append(q)
        prev_audio = audio

    used = list(applied.values())
    stats["snapAppliedCount"] = len(used)
    stats["snapMaxMs"] = round(max((abs(s) for s in used), default=0.0) * 1000, 1)
    stats["snapMeanAbsMs"] = round(
        (sum(abs(s) for s in used) / len(used) if used else 0.0) * 1000, 1
    )
    return out, stats
