# Score ↔ audio synchronization: audit & upgrade

> **Round 2 (end-of-song drift):** see [`sync-audit-2.md`](./sync-audit-2.md) for
> the follow-up audit that found the cause of "the MP3 finishes before the cursor
> reaches the end", the terminal-anchor fix, DTW-path simplification, and the
> anchor/refinement workflow. Some details below (dense raw points fed straight
> to alphaTab; Python emitting `alphaTabFlatSyncPoints`) are superseded there.

_Engineering report. Companion code: `features/player/data/{syncMap,syncGenerator,audioClock,syncDebug,backingSync}.ts`, `align/`, `app/api/align/route.ts`._

---

## 1. Current implementation

### Flow

```
score.gp (base64 in localStorage: learn-bass.imported-songs)
   │
   ▼  alphaTab AlphaTabApi, player.playerMode = EnabledExternalMedia
score timeline + animated beat cursor
                                   ▲
                                   │  output.updatePosition(audio.currentTime*1000)   ← rAF pump, ~60 Hz
recording.mp3 (Blob in IndexedDB: learn-bass / backing-audio)
   │
   ▼  <audio> element (hidden), the app owns it
audio.currentTime  ── THE CLOCK ──┘

sync generation:
   estimateLeadInMs(mp3)         first-onset RMS threshold, first 12 s   →  offsetMs   (localStorage: learn-bass.audio-sync)
   OR manual ± nudge buttons     ±10 / ±100 ms
      │
      ▼
   score.applyFlatSyncPoints([{ barIndex:0, barPosition:0, barOccurence:0, millisecondOffset: offsetMs }])
   api.updateSyncPoints()
      │
      ▼
   alphaTab piecewise-linear interpolation between that ONE point and the
   implicit end anchor (audio.duration) → effectively:  audioTime = offset + scoreTime · k
```

### Files / functions

| Concern | Location |
| --- | --- |
| GP load | `ImportSongDialog.tsx` (`fileToBase64`) → `songStore.ts` `learn-bass.imported-songs`; decoded by `base64ToBytes` and `api.load(...)` in `AlphaTabPlayer.tsx` |
| alphaTab config | `AlphaTabPlayer.tsx` ~L184 — `player.playerMode = EnabledExternalMedia`, `enableCursor/enableAnimatedBeatCursor/enableElementHighlighting`, no soundfont |
| `useBackingSync` | `features/player/data/backingSync.ts` — **playback layer only**. Builds an `IExternalMediaHandler` (`play/pause/seekTo/playbackRate/masterVolume`), assigns it to `api.player.output.handler`, and pumps `output.updatePosition(audio.currentTime*1000)` each animation frame while playing. It does **no audio analysis**. |
| Sync points | `backingSync.ts` `applySync()` (was `applyOffset()`) — one bar-0 `FlatSyncPoint` from `offsetMs`. |
| Sync-point **generation** | `features/player/data/autoAlign.ts` `estimateLeadInMs()` — decode first ≤12 s, sliding 1024-sample RMS, first hop above `max(peak·0.15, noiseFloor·4)`. Plus manual `handleOffsetChange` nudges in `AlphaTabPlayer.tsx`. |
| MP3 load | `AlphaTabPlayer.tsx` audio-load effect — `getBackingAudio` (IndexedDB) → `URL.createObjectURL` → `audio.src` → `audio.load()`; `preservesPitch = true`. |
| Playback time | `HTMLAudioElement.currentTime` (seconds). Sampled every animation frame + on `timeupdate`/`seeked`. Not `AudioContext.currentTime`. |
| Cursor follows mp3 | `output.updatePosition(...)` → alphaTab maps media-ms → internal-ms via its sync points → `playerPositionChanged` → cursor. |
| Seeking | transport range → `api.timePosition = ms` → alphaTab → `handler.seekTo(ms)` → `audio.currentTime`. |
| Speed | `api.playbackSpeed = v` → alphaTab → `handler.playbackRate = v` → `audio.playbackRate` (+`preservesPitch`). Position-based, so **no re-alignment on speed change** ✔. |
| Loops | `api.isLooping = true`; alphaTab drives the loop and re-seeks the handler at each wrap. No app-side loop math. |
| Drift correction | none beyond alphaTab's sync-point interpolation. (A previous rate-trim controller was removed when the mp3 became the master clock.) |
| Multiple sync points | data model reserved (`AudioSyncSettings.syncPoints?`) but **nothing generated or consumed more than the single bar-0 point**. |

**Verified distinction:** `useBackingSync` is a playback/cursor coupler. It never analyses audio. All "alignment intelligence" is the single `offsetMs` from `estimateLeadInMs` + manual nudges.

---

## 2. Current limitations — why it drifts

The mapping is **affine**: `audioTime = offset + k·scoreTime`, with `k = (audioDuration − offset) / scoreEnd` (alphaTab's implicit end anchor). Two degrees of freedom for a 3–5 minute song.

| Case | Handled? |
| --- | --- |
| Intro offset / lead-in silence | Partially — `estimateLeadInMs` finds *first sound*, not *beat 1*. Wrong on count-ins, ambient intros, crowd noise, fade-ins, pickup notes. |
| Count-in | No. |
| Constant tempo error (GP 170 vs record 168.5) | Yes, absorbed by `k` — but only if it's truly constant. |
| Gradual drift / accelerando / ritardando | No. Error grows ∝ ∫(local tempo − k). A 0.3 % swing over 90 s ≈ 270 ms. |
| Rubato, fermatas, pauses | No. |
| Tempo changes (score has them; `bars.json` shows per-bar tempo) | No — collapsed into one global `k`. |
| Human timing variation / live feel | No. |
| Breakdowns / half-time sections | No. |
| Repeated sections, GP repeats, alternate endings | No — one bar-0 point, `barOccurence: 0` only. |
| Transcription ≠ recording (added/dropped bars) | No — silently mis-maps. |
| Different songs entirely | No guard — produces a confident-looking wrong line. |

Second issue: the **clock**. `HTMLAudioElement.currentTime` is fine for a moving cursor but jitters ~20–40 ms and its update model is browser-dependent. For note judging in "tens of ms" windows that is borderline; `AudioContext.currentTime` is the right source.

**Verdict:** adequate for a *tab viewer* where the user nudges by ear and tolerates a bar-ish cursor. **Not adequate** for a rhythm game targeting 20–40 ms alignment error across arbitrary real recordings. No evidence the current method reaches that target; by construction it usually won't past the first minute of any song with tempo movement.

---

## 3. Comparison — current vs DTW / SyncToolbox

| Axis | Current (offset + global `k`) | SyncToolbox MrMsDTW |
| --- | --- | --- |
| Mapping shape | affine (2 DOF) | dense nonlinear monotone warp path |
| Local tempo variation | ignored | tracked (that's the point of DTW) |
| Drift over 3–5 min | accumulates | bounded by feature resolution (~20 ms at 50 Hz) in well-aligned sections |
| Intro / count-in | onset heuristic | absorbed by the warp path automatically |
| Repeats / arrangement diffs | unhandled | DTW maps recording order → score order; still needs `barOccurence` expansion for alphaTab (follow-up), but the *time map* is right |
| Different-song / bad-transcription detection | none | path-stability + residual-from-linear-fit + refuse-to-emit guard |
| Runtime | instant, in browser | ~seconds–1 min offline (feature extraction + MrMsDTW), Python |
| Deps | none | Python: `synctoolbox`, `librosa`, `numpy/scipy/numba`; fluidsynth + a GM soundfont for the reference render |
| Music fit | n/a | designed for exactly this (align a MIDI-rendered version to a recording); chroma features are percussion-tolerant, DLNCO locks onsets — works on full-band pop/rock/J-pop/J-rock |
| Playback-speed compatibility | ✔ (position-based) | ✔ (position-based; speed never touches the map) |
| Manual anchors later | not designed for | `sync_via_mrmsdtw_with_anchors`; our `SyncMap.withAnchor()` already supports local re-fit |
| alphaTab integration | native (`FlatSyncPoint`) | same — convert the warp path to `FlatSyncPoint`s; `useBackingSync` unchanged |
| Maintainability | trivial | one Python script + one Node script + a dev API route |

SyncToolbox is the right library (International Audio Laboratories Erlangen / Meinard Müller; the "Music Synchronization" use case is literally this). Writing a custom DTW would be strictly worse.

Expected accuracy of DTW here: **tens of ms in harmonically/rhythmically clear sections**; **unreliable (>100 ms or unstable) in ambient intros, solos, breakdowns, and where the transcription diverges**. Hence the confidence signals and manual-anchor path are not optional extras — they're how you get a rhythm-game-grade result.

---

## 4. Recommendation

```
ADD DTW / SYNCTOOLBOX
```

as an **offline sync-point generator** behind a `SyncGenerator` abstraction, feeding the **unchanged** `useBackingSync` playback layer. Keep the current offset method as the fast in-browser default and the fallback when DTW fails or reports low confidence.

Why not "keep current": a 2-DOF affine map cannot meet a tens-of-ms target on real 3–5 minute recordings with any tempo movement, and the evidence (per-bar tempo in `bars.json`, the nature of live/produced recordings) says movement is the norm.

Why keep `useBackingSync`: it already does the hard playback plumbing correctly (mp3 = master clock, cursor can't drift from audio, seek/loop/speed all route through one handler, `FlatSyncPoint`s carry masterbar/repeat semantics). DTW changes *what points it's given*, not *how playback works*.

---

## 5. What was implemented

### Data model — `features/player/data/syncMap.ts` (unit-tested)

```ts
interface SyncPoint { scoreTime: number; audioTime: number; confidence?: number }   // seconds

class SyncMap {
  static fromPoints(raw, diagnostics?)          // DTW path — sorted, de-duped, forced strictly monotone, validated
  static fromOffset(offsetSec, scoreDur, audioDur)  // ≡ current behaviour, as a 2-point map
  static fromConstantOffset(offsetSec)
  scoreTimeToAudioTime(t): number               // piecewise-linear, monotone, clamped ≥ 0, edge-slope extrapolation
  audioTimeToScoreTime(t): number               // exact inverse
  slopeAtScoreTime(t): number                   // local playback-rate ratio
  resample(stepSec): SyncPoint[]                 // stable uniform payload (don't expose raw noisy path)
  smoothed({minSlope,maxSlope}): SyncMap         // isotonic (PAVA) + slope clamp
  withAnchor(scoreTime, audioTime): SyncMap      // manual correction, local re-fit, stays monotone
}

toAlphaTabFlatSyncPoints(map, barTimeline, stepSec?) : AlphaTabFlatSyncPoint[]
```

Invariants (see `syncMap.test.ts`, 21 cases): exact points, interpolation, `score→audio→score` round-trip, monotonicity of both directions, boundary/extrapolation, and rejection of empty / <2 / NaN / decreasing-audio / duplicate-timestamp input.

### Strategy abstraction — `features/player/data/syncGenerator.ts`

```ts
interface SyncGenerator { id: string; generate(input: SyncInput): Promise<SyncResult> }
class OffsetSyncGenerator   // current: estimateLeadInMs + SyncMap.fromOffset
class DtwSyncGenerator      // POST GP+mp3 → /api/align → nonlinear SyncResult
```

`SyncResult` carries `status: ok | low-confidence | failed`, `points`, optional precomputed `alphaTabFlatSyncPoints`, and `diagnostics`. Both live behind the same interface so you can benchmark on one song.

### Playback wiring — `backingSync.ts` (`useBackingSync` preserved)

`useBackingSync({ …, syncMap, flatSyncPoints })`. `applySync()`:
- `flatSyncPoints` present (from the DTW pipeline) → `score.applyFlatSyncPoints(flat)` verbatim.
- else → single bar-0 point from `syncMap.scoreTimeToAudioTime(0)` — byte-for-byte the previous behaviour.

`AlphaTabPlayer.tsx` builds `syncMap` with `useMemo`: a stored DTW/anchored map when present, else `SyncMap.fromOffset(offsetMs, scoreDur, audioDur)`. Manual ± nudge slides the whole curve (works on top of DTW). Persisted per song in `learn-bass.audio-sync` as `AudioSyncSettings.syncMap: StoredSyncMap`.

### Gameplay clock — `features/player/data/audioClock.ts` (unit-tested)

`AudioClock(el, { webAudio? })` reads `AudioContext.currentTime`, re-anchoring to `<audio>.currentTime` on `seeked/ratechange/play/pause`. `now()` = interpolated recording seconds; `scoreNow(map)` / `expectedAudioTime(scoreTime, map)` bridge through the same `SyncMap`. `webAudio: true` routes the element through a `GainNode` for a rock-solid clock and a place to hang analysers later. **Not wired to scoring** (there is no scoring yet) — it exists so visual sync (alphaTab cursor) and gameplay timing stay separate from day one.

### Offline pipeline — `align/`

- `align/gp-to-midi.mjs` (Node, uses the app's alphaTab) → `score.mid` (SMF 1.0, MIDI-2.0 bend events stripped) + `bars.json` (`barIndex → startSec`, `endSec`, per-bar tempo). Same parser as playback ⇒ identical bar/tempo model. **Verified** on `monster.gp` (144 bars, endSec 203.29).
- `align/align.py` (SyncToolbox) — fluidsynth renders `score.mid` → `ref.wav`; `librosa` @ 22.05 kHz mono; quantized chroma + DLNCO onset features; `sync_via_mrmsdtw`; `make_path_strictly_monotonic`; resample to a 1 s grid → `points`; convert via `bars.json` → `alphaTabFlatSyncPoints`; diagnostics (RMS/max residual from the path's own linear fit, `pathStability`, `suspectRegions`); **refuses** to emit a map when the path is badly unstable (`status: "failed"`).
- `app/api/align/route.ts` — **dev-only** (`404` in production). Multipart `gp` + `audio` → temp dir → spawn both scripts → return `sync.json`. 240 s timeout.

### Diagnostics — `syncDebug.ts` + `SyncDiagnostics.tsx` (dev only)

`window.__syncDebug()` → `{ method, pointCount, scoreTimeSec, audioTimeSec, mappedAudioTimeSec, mappedScoreTimeSec, errorSec, localRate, confidence, nearestPoints, diagnostics }`.

Transport "activity" button (dev) opens a panel: the **score→audio warping curve** (x = score time, y = audio time; dashed = identical tempo; slope changes = local tempo differences), live error in ms (green < 40 ms), local rate, sync-point count, method, a **Run DTW alignment** button, and the raw diagnostics JSON.

### Sync-debug page — `/sync-debug/[songId]` (`SyncDebugView.tsx`)

A full-page visual + measurement tool (linked from the diagnostics panel):

- The recording drawn as a **waveform** (`waveform.ts`, `decodeAudioData` → min/max peaks), zoomable, click-to-seek. Played back through an `AudioBufferSourceNode` (`syncDebugSession.ts`) — sample-accurate position from `AudioContext.currentTime`, independent of the `<audio>` element and alphaTab.
- **GP markers** overlaid at their mapped `audioTime`: score bars, score beats (`scoreTimeline.ts` — alphaTab MIDI generator, same bar/tempo model as playback, runs in the browser with no worker), or the raw sync-map points.
- **Click overlay** (`clickTrack.ts`): scheduled square-wave clicks on bar or beat positions, mapped through the `SyncMap`, on the same audio graph — if the map is right, clicks sit exactly on the recording's beats.
- **Measure onsets** (`onsetDetect.ts`): energy-flux onset envelope; for every bar marker, the nearest real onset within ±350 ms → per-bar **residual** (detected − predicted). Reports mean / median / p90 / max |error|, mean signed error, a **residual-vs-score-time scatter**, and a worst-bars table. Residual ticks are also drawn on the waveform, colour-coded (green < 40 ms, amber < 100, red else).

This is how you compare offset vs DTW numerically on one song without watching a cursor. Unit-tested: `waveform.test.ts`, `onsetDetect.test.ts`.

---

## 6. Final architecture

```
PROCESSING (offline, dev / preprocessing)

score.gp ──▶ align/gp-to-midi.mjs ──▶ score.mid + bars.json     (alphaTab: same bar/tempo/repeat model as playback)
                                          │
recording.mp3 ────────────────────────────┼──▶ align/align.py
                                          │      fluidsynth: score.mid → ref.wav
                                          │      librosa @ 22.05 kHz mono
                                          │      SyncToolbox: quantized chroma + DLNCO onsets
                                          │      sync_via_mrmsdtw → strictly-monotone warp path
                                          └──────resample → sync.json { points[], alphaTabFlatSyncPoints[], diagnostics }
                                                     │
                                                     ▼
                              persist: localStorage learn-bass.audio-sync → AudioSyncSettings.syncMap


PLAYBACK (browser, unchanged transport)

recording.mp3 (<audio>, app-owned)  ── the clock
      │  output.updatePosition(audio.currentTime · 1000)
      ▼
alphaTab (playerMode = EnabledExternalMedia)
      ▲  score.applyFlatSyncPoints( StoredSyncMap.alphaTabFlatSyncPoints  ||  single bar-0 point )
      │  api.updateSyncPoints()
   useBackingSync  ── PRESERVED
      │
      ▼
tab cursor + note highlighting


GAMEPLAY TIMING (separate; not yet wired to scoring)

AudioContext.currentTime ──▶ AudioClock.now() ──▶ SyncMap.audioTimeToScoreTime() ──▶ expected note score-time
```

Selecting a playback instrument (`renderTracks`) is independent of alignment — the reference always uses the full arrangement.

---

## 7. Running locally

```bash
# app + tests (no Python needed for the current/offset method)
npm install
npm run dev
npm test                    # vitest: syncMap + audioClock

# DTW pipeline (one-time)
python3 -m venv align/.venv && source align/.venv/bin/activate
pip install -r align/requirements.txt
brew install fluid-synth     # or: apt-get install fluidsynth
export ALIGN_SOUNDFONT=/abs/path/GeneralUser-GS.sf2
# .env.local:
#   ALIGN_PYTHON=/abs/path/repo/align/.venv/bin/python
#   ALIGN_SOUNDFONT=/abs/path/GeneralUser-GS.sf2

# standalone alignment
node align/gp-to-midi.mjs song.gp /tmp/al
python align/align.py --recording song.mp3 --midi /tmp/al/score.mid --bars /tmp/al/bars.json --out /tmp/al/sync.json

# via the app: player → Sync diagnostics (dev) → Run DTW alignment
```

## 8. Data format (`sync.json` / `StoredSyncMap`)

```json
{
  "status": "ok",
  "method": "dtw:mrmsdtw",
  "message": "128 points; RMS 46.2 ms from linear fit.",
  "featureRate": 50,
  "referenceDurationSec": 203.1,
  "recordingDurationSec": 204.9,
  "scoreDurationSec": 203.29,
  "points": [
    { "scoreTime": 0.0,  "audioTime": 1.284 },
    { "scoreTime": 1.0,  "audioTime": 2.301 },
    { "scoreTime": 2.0,  "audioTime": 3.328 },
    { "scoreTime": 3.0,  "audioTime": 4.322 }
  ],
  "alphaTabFlatSyncPoints": [
    { "barIndex": 0, "barPosition": 0.0,  "barOccurence": 0, "millisecondOffset": 1284.0 },
    { "barIndex": 0, "barPosition": 0.71, "barOccurence": 0, "millisecondOffset": 2301.0 }
  ],
  "diagnostics": {
    "globalTempoRatio": 1.019,
    "globalOffsetSec": 1.28,
    "residualRmsMs": 46.2,
    "residualMaxMs": 173.0,
    "pathStability": 0.88,
    "pathCoverageScoreSec": 203.1,
    "suspectRegions": [
      { "scoreStart": 118.0, "scoreEnd": 131.0, "reason": "173 ms from global linear fit" }
    ]
  }
}
```

`residualRmsMs` is the headline number: it's how far the true mapping bends away from what the current offset method can represent — i.e. the current method's expected error.

## 9. Integration path to alphaTab

`DtwSyncGenerator.generate()` → `SyncResult` → `AlphaTabPlayer` stores it as `AudioSyncSettings.syncMap` and passes `syncMap` + `flatSyncPoints` to `useBackingSync`. `applySync()` calls `score.applyFlatSyncPoints(flatSyncPoints)` then `api.updateSyncPoints()`. Nothing else in the transport changes. If the stored map fails to validate, `useMemo` falls back to `SyncMap.fromOffset` and playback continues.

## 10. Validation — old vs new on one song

1. Run `align/align.py` on the song → note `diagnostics.residualRmsMs` (predicted offset-method error) and `suspectRegions`.
2. In the player: **Sync diagnostics → reset** (offset method). Play; at 30 / 60 / 120 s / end read `window.__syncDebug().errorSec`.
3. **Sync diagnostics → Run DTW alignment**. Repeat the readings.
4. Expect: offset-method `|errorSec|` grows through the song toward ~`residualRmsMs`/1000; DTW-method `|errorSec|` stays within a few tens of ms except inside `suspectRegions`.
5. The warping-curve panel: offset method = straight line; DTW = mostly-diagonal with visible slope changes at real tempo moves.

## 11. Scope kept narrow (per brief §19)

No Demucs / source separation, no mic pitch detection, no note scoring, no AI transcription, no cloud jobs. Just: GP + MP3 → accurate `SyncMap` → alphaTab `FlatSyncPoint`s → `useBackingSync`. Manual-anchor UI and `barOccurence`-aware repeat expansion are designed-for but not built.
