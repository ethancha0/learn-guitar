"""Onset detection shared by `snap.py` (which moves points onto onsets) and
`evaluate.py` (which measures how far points sit from onsets).

One implementation on purpose: if the snapper and the scorer disagreed about
where an onset is, the scorer would grade the snapper against a different
ground truth than the one it optimised for.

Resolution matters here. The previous snapper ran at hop 512 (23 ms at
22.05 kHz) and took a plain `argmax` over the search window. At 170 BPM a
sixteenth note is 88 ms, so a 23 ms quantisation is a quarter of a subdivision
and `argmax` has no way to tell a real attack from the shoulder of a louder
neighbour. This module uses hop 256 (11.6 ms), requires a genuine local
maximum, judges strength against the *local* envelope rather than the whole
song, and refines the peak parabolically for sub-hop precision.
"""
from __future__ import annotations

HOP = 256  # 11.6 ms at 22050 Hz


def onset_envelope(audio, sr: int, hop: int = HOP):
    """Spectral-flux onset strength. Returns ``(envelope, hop_sec)``.

    Note the envelope peaks slightly *after* the true attack: librosa's
    `onset_strength` is a first difference (`lag=1`) of a mel spectrogram, so
    the rise is reported at the frame where the energy has already grown.
    Callers must not treat an absolute peak time as an absolute attack time —
    `snap.py` cancels the bias by working with median-centred shifts and
    `evaluate.py` reports the signed median separately from the spread.
    """
    import librosa

    env = librosa.onset.onset_strength(y=audio, sr=sr, hop_length=hop)
    return env, hop / sr


def find_peak(
    env,
    hop_sec: float,
    target_sec: float,
    window_sec: float,
    *,
    prominence_ratio: float = 0.25,
    local_sec: float = 0.5,
):
    """Nearest onset peak to ``target_sec`` within ``±window_sec``.

    A candidate must be a local maximum of the envelope and reach
    ``prominence_ratio`` of the strongest value within ``±local_sec`` of the
    target. Scoring against a local maximum rather than the song's global
    maximum is what lets quiet passages be measured at all — a fraction of the
    loudest hit in the song is unreachable during a verse.

    Returns ``(peak_sec, strength)`` or ``(None, 0.0)``.
    """
    import numpy as np

    n = len(env)
    if n < 3 or hop_sec <= 0:
        return None, 0.0

    centre = target_sec / hop_sec
    half = window_sec / hop_sec
    lo = max(1, int(np.floor(centre - half)))
    hi = min(n - 2, int(np.ceil(centre + half)))
    if hi < lo:
        return None, 0.0

    local_half = local_sec / hop_sec
    l_lo = max(0, int(np.floor(centre - local_half)))
    l_hi = min(n, int(np.ceil(centre + local_half)) + 1)
    local_max = float(np.max(env[l_lo:l_hi])) if l_hi > l_lo else 0.0
    if local_max <= 1e-9:
        return None, 0.0
    floor = local_max * prominence_ratio

    best = -1
    best_dist = float("inf")
    for i in range(lo, hi + 1):
        if env[i] < floor:
            continue
        if env[i] < env[i - 1] or env[i] < env[i + 1]:
            continue
        dist = abs(i - centre)
        if dist < best_dist:
            best_dist = dist
            best = i
    if best < 0:
        return None, 0.0

    # Parabolic refinement through the three samples around the peak.
    y0, y1, y2 = float(env[best - 1]), float(env[best]), float(env[best + 1])
    denom = y0 - 2 * y1 + y2
    shift = (0.5 * (y0 - y2) / denom) if denom != 0 else 0.0
    shift = max(-1.0, min(1.0, shift))
    return (best + shift) * hop_sec, y1 / local_max


def median(values) -> float:
    """Plain median of a Python list, without pulling numpy into callers."""
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[mid])
    return float((ordered[mid - 1] + ordered[mid]) / 2)
