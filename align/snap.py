"""Post-DTW bar onset snapping — nudge bar audio times toward recording transients."""
from __future__ import annotations


def snap_bars_to_onsets(
    points: list[dict],
    rec_audio,
    sr: int,
    window_sec: float = 0.1,
    strength_threshold: float = 0.2,
) -> tuple[list[dict], list[float]]:
    """For each point, search ±window_sec for the strongest onset peak.

    Returns (snapped_points, shift_ms_per_point).
    """
    import librosa
    import numpy as np

    if len(points) < 2:
        return points, [0.0] * len(points)

    onset_env = librosa.onset.onset_strength(y=rec_audio, sr=sr, hop_length=512)
    hop_sec = 512 / sr
    env_max = float(np.max(onset_env)) or 1.0

    out: list[dict] = []
    shifts: list[float] = []
    prev_audio = -1.0

    for p in points:
        target = float(p["audioTime"])
        centre = int(target / hop_sec)
        half = int(window_sec / hop_sec)
        lo = max(0, centre - half)
        hi = min(len(onset_env), centre + half + 1)
        if hi <= lo:
            audio = target
            shift_ms = 0.0
        else:
            window = onset_env[lo:hi]
            peak_i = int(np.argmax(window))
            peak_val = float(window[peak_i]) / env_max
            if peak_val >= strength_threshold:
                audio = (lo + peak_i) * hop_sec
                shift_ms = (audio - target) * 1000
            else:
                audio = target
                shift_ms = 0.0

        audio = max(audio, prev_audio + 1e-3)
        out.append(
            {
                "scoreTime": p["scoreTime"],
                "audioTime": round(audio, 4),
            }
        )
        shifts.append(round(shift_ms, 1))
        prev_audio = audio

    return out, shifts
