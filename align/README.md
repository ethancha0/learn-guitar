# Offline score ↔ recording alignment (DTW / SyncToolbox)

Generates a **nonlinear, monotonic** score→audio time map from a Guitar Pro file
and its recording, for the player's `useBackingSync` layer. This is a
**preprocessing** step: it never runs in the browser or on the request path in
production. In dev, `POST /api/align` shells out to the two scripts here.

```
score.gp ──▶ gp-to-midi.mjs ──▶ score.mid + bars.json      (alphaTab, same parser as playback)
                                     │
recording.mp3 ───────────────────────┼──▶ align.py ──▶ sync.json
                                     │      • fluidsynth: score.mid → ref.wav
                                     │      • librosa @ 22.05 kHz mono
                                     │      • SyncToolbox: quantized chroma + DLNCO onsets
                                     │      • sync_via_mrmsdtw → strictly-monotone warp path
                                     └──────• resample → {scoreTime, audioTime} + alphaTab FlatSyncPoints
```

## One-time setup

Node deps are already installed with the app. For Python:

```bash
# from the repo root
python3 -m venv align/.venv
source align/.venv/bin/activate           # Windows: align\.venv\Scripts\activate
pip install -r align/requirements.txt

# reference render (strongly recommended — without it align.py falls back to a
# thin sine synth that aligns worse):
#   macOS:   brew install fluid-synth
#   Debian:  sudo apt-get install fluidsynth
# then grab any General MIDI soundfont, e.g. FluidR3_GM.sf2 / GeneralUser-GS.sf2:
export ALIGN_SOUNDFONT="/absolute/path/to/GeneralUser-GS.sf2"
```

Point the API route at this interpreter:

```bash
# .env.local
ALIGN_PYTHON=/absolute/path/to/repo/align/.venv/bin/python
ALIGN_SOUNDFONT=/absolute/path/to/GeneralUser-GS.sf2
```

## Run standalone (no server)

```bash
node align/gp-to-midi.mjs path/to/song.gp /tmp/al
source align/.venv/bin/activate
python align/align.py \
  --recording path/to/song.mp3 \
  --midi /tmp/al/score.mid \
  --bars /tmp/al/bars.json \
  --out  /tmp/al/sync.json
cat /tmp/al/sync.json | python -m json.tool | head -40
```

## Run via the app (dev only)

`npm run dev`, open a song in the player, open the **Sync diagnostics** panel
(activity icon in the transport, dev builds only) → **Run DTW alignment**. The
result is persisted per song in `localStorage["learn-bass.audio-sync"]`.

## Manual anchors & region-wise refinement

An anchor means **"this exact score position IS this exact recording position"**:

```json
[{ "scoreTime": 82.140, "audioTime": 83.720, "label": "chorus 2 downbeat" }]
```

Anchors live in `AudioSyncSettings.syncMap.anchors` (localStorage), *separate*
from the automatic `points`, so:

- re-running DTW never discards a manual correction, and
- the refiner can be told which regions are already trusted.

Pass them to `align.py` with `--anchors '<json>'` (the `/api/align` route
forwards the `anchors` form field). When present the script switches from
`sync_via_mrmsdtw` to SyncToolbox's **`sync_via_mrmsdtw_with_anchors`**, which
solves each interval *between* consecutive anchors independently:

```
   0        anchor1        anchor2        end
   |   DTW    |     DTW      |     DTW     |
```

That is what stops one confused region (repeated chorus, transcription error,
quiet passage) from dragging the rest of the song out of alignment. SyncToolbox
requires anchors strictly inside both signals and monotonically increasing;
`parse_anchors()` filters and sorts to satisfy that.

At playback time anchors are applied on top of the automatic curve by
`SyncMap.withAnchors(...)`, which re-fits locally and keeps the result monotone —
so an anchor is honoured exactly even without re-running Python.

### How a waveform editor should consume this

1. User clicks a GP beat → `scoreTime` (from `scoreTimeline.ts`).
2. User clicks the waveform → `audioTime` (`/sync-debug/[songId]` already does
   click-to-seek, so it has this).
3. Append `{ scoreTime, audioTime }` to `syncMap.anchors`, `patchAudioSync(...)`.
   The cursor updates immediately — no Python round-trip.
4. Optionally hit **Run DTW alignment** to re-solve *between* the anchors.

## Output

`sync.json` conforms to [`schema.json`](./schema.json). Key fields:

| field | meaning |
| --- | --- |
| `status` | `ok` / `low-confidence` / `failed` — `failed` emits **no** points |
| `points` | `[{ scoreTime, audioTime }]` seconds, strictly monotone, ~1 s grid |
| `alphaTabFlatSyncPoints` | ready for `score.applyFlatSyncPoints(...)` |
| `diagnostics.residualRmsMs` | how far the warp path bends away from a single-offset line |
| `diagnostics.pathStability` | 1.0 = rock-steady local tempo; low = suspicious |
| `diagnostics.suspectRegions` | score-time spans to review manually |

`align.py` **refuses** to emit a mapping when the warp path is badly unstable
(likely a different song / very different arrangement) — it returns
`status:"failed"` and the player keeps the previous map.

## Compare against the current method

The current in-browser method (`OffsetSyncGenerator`) is `SyncMap.fromOffset(...)`
— a lead-in offset plus one global tempo ratio. Benchmark both on the same song:

```bash
python align/align.py ... --out /tmp/dtw.json
# then in the player console:
#   window.__syncDebug()            → live error for whichever map is active
#   errorSec near 0  →  aligned
```

Load the DTW map (diagnostics panel → Run DTW), scrub through the song, and read
`window.__syncDebug().errorSec` at 30 s / 60 s / 120 s / end. Repeat with the
offset method (diagnostics panel → reset). `residualRmsMs` in `sync.json` is the
expected upper bound on how much the offset method drifts.
