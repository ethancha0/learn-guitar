# Offline score ↔ recording alignment (DTW / SyncToolbox)

Generates a **nonlinear, monotonic** score→audio time map from a Guitar Pro file
and its recording, for the player's `useBackingSync` layer. This is a
**preprocessing** step: it never runs in the browser or on the request path in
production. In dev, `POST /api/align` shells out to the two scripts here.

```
score.gp ──▶ gp-to-midi.mjs ──▶ score.mid + bars.json      (alphaTab, same parser as playback)
                                     │                     (bars + beat grid + tempo)
recording.mp3 ───────────────────────┼──▶ align.py ──▶ sync.json
                                     │      • fluidsynth: score.mid → ref.wav
                                     │      • librosa @ 22.05 kHz mono
                                     │      • SyncToolbox: quantized chroma + DLNCO onsets
                                     │      • sync_via_mrmsdtw → strictly-monotone warp path
                                     └──────• resample onto 0.25 s ∪ bars ∪ beats → {scoreTime, audioTime}
                                            │
                                            └──▶ evaluate.py ──▶ residual vs. real onsets
```

The client turns `points` into alphaTab `FlatSyncPoint`s by sampling the curve
at every bar downbeat **and every beat** (`toAlphaTabBarSyncPoints`). alphaTab
interpolates linearly between consecutive points, so beat spacing is what bounds
how far the cursor can drift inside a bar — at 170 BPM a 4/4 bar is 1.41 s.

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

## Measuring accuracy

Nothing else in the pipeline measures alignment. `diagnostics.residualRmsMs`
says how far the warp curve bends away from *its own* linear fit, and the
player's **Error** readout compares the dense map against what alphaTab does
with its resampled copy — both can read zero while the map is a subdivision
out. `evaluate.py` asks the only question that matters: map a notated attack
through the curve, and how far away is the nearest real attack in the recording?

```bash
python align/evaluate.py \
  --recording path/to/song.mp3 \
  --bars /tmp/al/bars.json \
  --sync /tmp/al/sync.json \
  --midi /tmp/al/score.mid        # restricts scoring to positions the score attacks
```

```
measured 144/144 bars @ 170 BPM (sixteenth 88.2 ms)
  constant offset (signed median) :     11.9 ms
  --- spread after removing it ---
  median |residual|               :      3.0 ms
  p90    |residual|               :      6.2 ms
  subdivision slips (>1/2 16th)   :        0
  slip histogram (16ths)          : {'0': 144}
```

Read it like this:

- **`signedMedianMs`** is a constant lead-in error. One number fixes the whole
  song, and the onset detector's own lag lives in here too, so it is not
  evidence of a bad warp. Everything else is reported *after* removing it.
- **`slipHistogram`** is the fast-song diagnostic. A healthy alignment is one
  tall bucket at `0`. A bucket at `±1` means the path locked onto the wrong
  subdivision — the failure that shows up as a ~90 ms error at 170 BPM and is
  invisible in RMS-style statistics.

### Measuring playback itself, not just the map

`evaluate.py` scores the curve in `sync.json`. It cannot see what alphaTab does
with that curve, and that turned out to be its own error source: alphaTab builds
its score clock by accumulating `MidiUtils.ticksToMillis()` once per interval
between sync points, and that helper truncates to whole milliseconds. One point
per beat at 170 BPM loses 0.941 ms every beat — a dead-straight 2.67 ms/s drift,
−541 ms by the end of a 3:23 song, four times worse than bar-level points
because there are four beats in a bar.

`probe-playback.mjs` reproduces alphaTab's playback math offline
(`MidiFileGenerator._processBarTimeWithSyncPoints` plus
`MidiFileSequencer.mainTimePositionFromBackingTrack`) and separates the layers:

```bash
node --experimental-transform-types --import ./align/ts-resolve.mjs \
  align/probe-playback.mjs \
  --gp align/fixtures/monster/monster.gp \
  --bars /tmp/al/bars.json --sync /tmp/al/sync.json \
  --out /tmp/al/drift.json          # --no-compensate / --grid bars for comparisons
```

It reports `bars.json` against alphaTab's own tick model, the raw DTW path
against the map the player builds from it, and the position alphaTab actually
reports at every beat. It also writes `sync-effective.json` — the same shape as
`sync.json`, holding the mapping playback *really* implements — so `evaluate.py`
scores real playback against real onsets. `plot-drift.py` draws all of it:
accumulating error is a ramp, a DTW path slip is a step, bad anchors oscillate.

`SyncMap`'s `compensateFlatSyncPoints` cancels the truncation (a point's
`synthTime` depends only on ticks and tempo, so it is read back after
`applyFlatSyncPoints` and the offsets re-derived against it). On the 170 BPM
fixture that takes playback from median 38.9 ms / p90 97.7 ms / 200 subdivision
slips to 7.0 / 51.6 / 77 — indistinguishable from the map's own quality.

### Fixtures and parameter sweeps

Put a song on disk so tuning does not have to go through the browser:

```
align/fixtures/<name>/score.gp        (or .gp3 .gp4 .gp5 .gp7 .gpx …)
align/fixtures/<name>/recording.mp3   (or .m4a .flac .wav)
```

`align/fixtures/` is gitignored. Then:

```bash
python align/sweep.py --fixture align/fixtures/monster --work /tmp/al
```

`sweep.py` renders the reference and extracts features **once** and reuses them
across every configuration, so a full grid costs about one alignment plus a
fraction of a second per row. It always includes two reference rows — `legacy`
(the pre-tuning configuration) and `default` (what `align.py` ships today) — so
every sweep says whether the shipped defaults are still the ones to beat.

Snapped rows are scored with **hold-out**: the snapper moves points onto peaks
of the same onset envelope `evaluate.py` measures against, so grading it at the
positions it fitted would report a residual of zero and win on arithmetic. The
sweep therefore scores every row at beats *excluding* the bar downbeats the
snapper may touch, which turns the score back into a generalisation question.

## Why the soundfont matters

Not a nicety. Holding the recording, the DTW configuration and every downstream
stage constant, and changing only the reference render:

| reference | median \|residual\| | p90 | subdivision slips |
| --- | --- | --- | --- |
| `pretty_midi` sine fallback | 25.3 ms | 53.1 ms | 5 |
| percussive (soundfont-like) | 6.2 ms | 15.3 ms | 1 |

`PrettyMIDI.synthesize` returns **silence for every drum track** and pure sines
with no attack transient for everything else, so DTW is matching a smooth,
drumless render against a full-band mix. It is the single largest source of
error in the pipeline. Use `--require-soundfont` in any measurement run so a
missing soundfont fails loudly instead of quietly halving your accuracy.

## Tuning notes (measured, not assumed)

Two changes away from SyncToolbox's library defaults earned their place:

- **`--feature-rate 100`** on songs above 140 BPM (applied automatically by
  `--fast-profile auto`). 10 ms frames instead of 20; halved the residual spread
  on a 170 BPM fixture at no measured runtime cost, because the pitch
  filterbank dominates extraction and runs at the sample rate either way.
- **`step_weights=[1.5, 1.5, 2.0]`, `threshold_rec=1e6`** — SyncToolbox's own
  `sync_audio_audio` recommendation. Measured neutral on a clean fixture, kept
  because it is the upstream advice and cannot hurt.

Two changes that sound right for fast music but measured worse, and are
therefore *not* applied by default (both remain flags for `sweep.py`):

- Shortening the **DLNCO decay** to about one subdivision.
- Lowering **`alpha`** to weight onsets over chroma — the most harmful single
  change measured (0 → 5 subdivision slips on a weak reference).

The case those two were meant for is dense polyphony, which a sparse fixture
does not exercise. Re-run the sweep on real material before ruling them out.

**`--snap` defaults to `off`.** The onset snapper now only de-jitters notated
bar/beat positions, within a tempo-derived window, and only when a shift agrees
with its neighbours — but under hold-out scoring it showed no generalisation
benefit, so it stays off until a real song says otherwise.

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
| `points` | `[{ scoreTime, audioTime }]` seconds, strictly monotone, on a 0.25 s grid unioned with every bar downbeat and beat. The **single source of truth** — the client derives alphaTab `FlatSyncPoint`s from it |
| `diagnostics.residualRmsMs` | how far the warp path bends away from a single-offset line. *Not* an accuracy measure — use `evaluate.py` |
| `diagnostics.pathStability` | 1.0 = rock-steady local tempo; low = suspicious. Computed on a 1 s resampling so it stays comparable across `--grid-sec` settings |
| `diagnostics.referenceRender` | `soundfont` or `sine-fallback` — check this first when accuracy is poor |
| `diagnostics.snap*` | what the onset snapper did: candidates, measured, applied, rejected |
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
