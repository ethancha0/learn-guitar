# Sync audit #2 — end-of-song drift, anchors, and making the map inspectable

_Follow-up to [`sync-audit.md`](./sync-audit.md). Focus: is the GP+MP3 sync
predictable, inspectable, and accurate across the **whole** song?_

---

## 1. How the system actually worked

The architecture matched the description, with three deviations that mattered.

```
GP ──▶ alphaTab (browser)  ──▶ score/MIDI ──▶ FluidSynth ref.wav
                                                    \
                                                     ▶ SyncToolbox MrMsDTW ──▶ points
                                                    /
MP3 ───────────────────────────────────────────────
```

**Deviation 1 — two converters, and the tested one was dead.**
`toAlphaTabFlatSyncPoints()` in `syncMap.ts` (monotonic guards, unit-tested) was
referenced *only by its own test*. The live path used `to_flat_sync_points()` in
`align.py`, which emitted **one FlatSyncPoint per 1-second DTW grid point** — for
a 3.5-minute song, ~200 raw points, each becoming a tempo change for alphaTab.
No simplification, no smoothing.

**Deviation 2 — the DTW map could be dropped silently.**

```ts
try { return SyncMap.fromPoints(storedSyncMap.points, …); }
catch { /* fall through to offset */ }   // ← no UI signal whatsoever
```

**Deviation 3 — the map's shape changed after playback started.**
`scoreDurationSec` came from `playerPositionChanged.endTime`, which is `0` until
playback or a seek occurs. So the initial map was built as "score duration ≡
audio duration" (a 1:1 line) and silently re-shaped once the first position event
arrived.

Verified as correct: GP parsing (alphaTab `ScoreLoader`, same parser in browser
and in `align/gp-to-midi.mjs`), reference render, `useBackingSync` as a pure
playback/cursor coupler, and speed/seek/loop — all three route through alphaTab
into one `IExternalMediaHandler`, and the map is position-based, so **playback
rate never requires re-alignment**.

---

## 2. What caused the end-of-song mismatch

**Root cause: alphaTab's final segment is anchored to the *reported media
duration*, not to a sync point we control.**

From `alphaTab.core.mjs`, `mainTimePositionFromBackingTrack`:

```js
} else {                                   // past the LAST sync point
  const relativeTimeDiff = timeDiff / (backingTrackLength - currentSyncPoint.syncTime);
  alphaTabTimeDiff = (mainState.endTime - currentSyncPoint.synthTime) * relativeTimeDiff;
}
```

`backingTrackLength` is whatever **our handler** returns — it was
`audio.duration * 1000`, taken on trust. Two consequences, both reproduced
numerically (`node /tmp/tail.mjs` during the audit):

**(a) A wrong `audio.duration` becomes end-of-song drift.** Chrome estimates VBR
MP3 duration from the bitrate header for blob URLs, and revises it later. With a
single bar-0 sync point and duration over-reported as 215 s for a real 205.5 s
file:

```
audio 102.0s -> score  96.34s   (5.4s early)
audio 205.5s -> score 194.30s   → cursor 8.99s SHORT of the end
```

That is exactly the reported symptom: **the MP3 finishes before the cursor
arrives.** Contributing bug: the 4-second metadata fallback timer set
`audioMetaReady` but *not* `audioDurationSec`, and there was no `durationchange`
listener, so a revised duration was never picked up.

**(b) A DTW path that stops before the audio end gets smeared.** The path lives
in *rendered-reference* time and stops where the reference stops; anything after
the last point is stretched to `backingTrackLength`. With a 35 s outro absent
from the tab, the last 3.3 s of score were spread across 38 s of audio — the
cursor crawls to a halt at the end.

**Also found:** a terminal point placed *exactly* on `backingTrackDuration` makes
that branch compute `0/0` → `NaN` position at the final instant.

---

## 3. Is SyncToolbox + alphaTab still the right architecture?

**Yes — unchanged.** The failure was never in DTW or in `useBackingSync`; it was
in the *hand-off* between them (unbounded tail, raw density, silent fallback).
`useBackingSync` is untouched as the playback/cursor layer. The division of
responsibility is now enforced rather than merely intended:

```
SyncToolbox/DTW → accurate positions → stable SyncMap → alphaTab FlatSyncPoints → useBackingSync
```

---

## 4. What changed

| Area | Change |
| --- | --- |
| **Terminal anchor** | `SyncMap.withTerminalAnchor(scoreEnd, audioDuration?)` extends the curve to the score end using the final local slope, clamped strictly inside the media (5 ms) so alphaTab's tail branch is degenerate and cannot distort — or divide by zero. |
| **Simplification** | `SyncMap.simplify(0.02)` — Douglas–Peucker on the warp curve. ~240 raw points → a handful of vertices, guaranteed within 20 ms of the original, **real tempo elbows preserved** (unit-tested). The dense map is kept in `points` for scoring. |
| **One converter** | `toAlphaTabFlatSyncPoints()` (TS, tested) is now the live path, called from `AlphaTabPlayer`. `align.py` no longer emits `alphaTabFlatSyncPoints`; its `points` array is the single source of truth. Dead `to_flat_sync_points()` removed. |
| **Trusted duration** | `useBackingSync` takes `trustedAudioDurationSec`; the handler prefers it over `audio.duration`. `AlphaTabPlayer` now listens to `durationchange` as well as `loadedmetadata`, and the fallback timer records the duration instead of only unblocking the UI. |
| **No silent fallback** | The map memo returns `{ syncMap, syncSource, syncWarning }`. A rejected stored map produces a red banner naming the reason, not a quiet linear line. |
| **Score length up front** | Score duration now comes from the GP bar timeline (`extractScoreTimeline`), available at load, so the map never starts life as an accidental 1:1. |
| **Python** | `clip_to_score_end()` trims the reference-render tail and interpolates an exact terminal point; `--anchors` + `sync_via_mrmsdtw_with_anchors`; `parse_anchors()` enforces SyncToolbox's monotonic/interior constraints. |
| **Anchors** | `SyncAnchor` in the data model, stored separately from `points`; `SyncMap.withAnchors()` applies them at playback time. |
| **Observability** | Status banner, sync-point counts (map vs. sent to alphaTab), score/audio durations, and a 0/25/50/75/100 % mapping table in the diagnostics panel; `window.__syncProbe()` in the console. |

Fix verified numerically against the original failure:

```
Chrome over-reports VBR duration as 215.0s (real 205.5s)

BEFORE  (single bar-0 point)
   audio 102.0s -> score  96.34s   (err -5.45s)
   audio 205.5s -> score 194.30s   short by 8.99s
AFTER   (+ terminal anchor at score end)
   audio 102.0s -> score 101.79s   (err -0.00s)
   audio 205.5s -> score 203.29s   short by 0.00s
```

Live check in the player: `syncPointsAppliedToScore` went from **1 → 2**, i.e.
the terminal anchor reaches alphaTab.

---

## 5. Manual anchors & refinement

An anchor is "this exact score position IS this exact recording position":

```ts
{ scoreTime: 82.140, audioTime: 83.720, label?: "chorus 2 downbeat" }
```

- **Stored separately** from the automatic `points` (`StoredSyncMap.anchors`), so
  re-running DTW never discards manual work.
- **Applied at playback time** by `SyncMap.withAnchors()` — local re-fit, stays
  monotone, honoured exactly, no Python round-trip needed.
- **Fed back into the refiner**: `AlphaTabPlayer` sends them with the align
  request; `align.py` switches to SyncToolbox's
  **`sync_via_mrmsdtw_with_anchors`**, which solves each interval *between*
  consecutive anchors independently:

```
0        anchor1        anchor2        end
|   DTW    |     DTW      |     DTW     |
```

That is the GoPlayAlong-style workflow: automatic first pass → correct the one
bad spot → re-solve only the affected regions. A confused chorus can no longer
drag the rest of the song with it.

The waveform editor is not built; `align/README.md` documents exactly how it
should consume this (click GP beat → `scoreTime`; click waveform → `audioTime`;
append to `anchors`; optionally re-run). `/sync-debug/[songId]` already has the
waveform, GP markers and click-to-seek, so it is the natural host.

---

## 6. Are raw DTW points simplified before reaching alphaTab?

They were not. **Now yes:**

```
raw DTW path (50 Hz)
  → align.py: strict monotonic cleanup + 1 s resample + clip to score end
  → SyncMap.fromPoints  (validate, force strict monotonicity)
  → withAnchors         (manual corrections win)
  → withTerminalAnchor  (bound the tail)
  → simplify(0.02)      (Douglas–Peucker, 20 ms tolerance)
  → toAlphaTabFlatSyncPoints  → useBackingSync
```

Tolerance is 20 ms — below the rhythm-game window, so nothing audible is lost,
and a test asserts a genuine 1.0×→1.15× tempo change survives while a straight
line collapses to two points. The dense curve stays in `StoredSyncMap.points`
for `AudioClock`/scoring.

---

## 7. Verifying DTW is actually active

Three independent ways:

1. **Diagnostics panel** (dev, activity icon): a green **"Nonlinear DTW map
   ACTIVE"** banner vs. an amber **"FALLBACK: linear offset map (no DTW)"**.
2. **The mapping table** in the same panel. A linear map shows a *constant* lag:
   ```
   Score 0.00s → Audio 0.21s   +0.21s
   Score 50.82s → Audio 51.03s  +0.21s     ← constant ⇒ linear fallback
   ```
   A real DTW map's lag moves (`+1.21s`, `+1.05s`, `+0.63s`, `+0.22s`).
3. **Console**: `window.__syncProbe()` →
   ```js
   { method: "dtw:mrmsdtw", source: "dtw", pointCount: 37,
     scoreDurationSec: 203.29, audioDurationSec: 205.5,
     rows: [ …0/25/50/75/100 %… ], lagSpreadSec: 0.99, looksLinear: false,
     warnings: [] }
   ```
   `warnings` calls out a fallback, a suspiciously-linear DTW map, sudden
   tempo-ratio jumps, and **"the audio will finish before the cursor does"**.

Objective end-to-end measurement is unchanged: `/sync-debug/[songId]` →
**Measure onsets** gives mean/median/p90/max residual per bar.

---

## 7b. Follow-up: DTW end-effects (fast-tempo song, error at the very end)

**Symptom.** With a fast song the diagnostics panel showed a healthy body and a
blown-up tail:

```
Score duration 203.3s   Audio duration 205.5s
  0.00s → 0.00s    +0.00s
 50.82s → 51.31s   +0.48s     ← steady
101.65s → 102.14s  +0.49s
152.47s → 152.95s  +0.48s
203.29s → 212.29s  +9.00s     ← 6.8s PAST the end of the recording
Local rate 1.2400×   residualMaxMs 8289.3
```

**Cause — a DTW end-effect, then extrapolated on it.** A warping path routinely
finishes with a near-vertical run: the FluidSynth reference's decay tail matches
against the recording's outro, so audio races ahead while the score barely moves.
`clip_to_score_end()` then extrapolated the terminal point using *that* final
segment's slope, throwing it seconds past the end of the audio. Two gaps let it
through:

- `clip_to_score_end()` had **no clamp to the recording duration**.
- `SyncMap.withTerminalAnchor()` **early-returns** when a terminal point already
  exists, so a bad point produced offline was never validated on the client.

**Fix — validate, don't trust.** New `SyncMap.sanitize({ scoreEndSec, audioDurationSec })`
runs on every stored map regardless of origin:

1. Trims trailing points whose local slope exceeds **3× the median slope** (a
   real tempo change is a fraction of that; 3×+ is a defect).
2. Drops any point mapping past the recording.
3. Extends to the score end on the **median** slope, not the final segment.
4. Returns a `repairs[]` list, surfaced in the diagnostics panel.

`withTerminalAnchor` now also extrapolates on `medianSlope()`. Mirrored in
`align.py` (`clip_to_score_end` gained `rec_len` + the same median-slope logic),
so new runs are correct at the source.

**Verified end-to-end** by injecting the reported map into storage:

```
before: 203.29s → 212.29s  (+9.00s)   local rate 1.2400×
after : 203.29s → 203.89s  (+0.59s)   local rate 1.0015×
panel : "Sync map repaired: trimmed 1 end-effect point(s) whose slope exceeded
         3× the median (1.002×); extended the curve to the score end on the
         median slope."
```

Existing stored maps are repaired **at load time**, so no DTW re-run is needed.

---

## 8. Remaining work for GoPlayAlong-like reliability

1. **Anchor editing UI** — the model and backend are ready; the waveform page
   needs "click beat + click waveform → save anchor".
2. **Repeats.** All sync points use `barOccurence: 0`. A song whose recording
   takes a repeat differently from the transcription still needs per-occurrence
   points; alphaTab's model supports it, the pipeline does not populate it yet.
3. **Reference-render quality.** Alignment is only as good as the FluidSynth
   render; without a soundfont the `pretty_midi` sine fallback aligns noticeably
   worse. Worth failing loudly rather than silently degrading.
4. **Confidence-driven review.** `suspectRegions` is computed but not surfaced on
   the waveform as "review this section".
5. **Verify on a real full-band recording.** This sandbox's Chrome cannot decode
   media, so end-to-end audible verification (and a real DTW run) is still
   pending on your machine.
6. **Scoring clock.** `AudioClock` exists and is wired to the same `SyncMap`, but
   nothing consumes it yet.
