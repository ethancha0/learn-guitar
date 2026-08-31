# Learn Bass

UI foundation for a bass-guitar learning app (synced tabs + rhythm-game feedback).

Songs imported through the **Import song** dialog (tab file + audio) open the
player, where their Guitar Pro / PowerTab file is rendered and played back with
[alphaTab](https://alphatab.net). Seed songs in `features/library/data` are still
mock-only and show a placeholder score.

## Run

```bash
npm install
npm run dev     # http://localhost:3000  (/ redirects to /library)
npm run build   # production build + type check
npm test        # vitest — sync-map / audio-clock unit tests
```

## Structure

- `app/` — App Router routes (`/` → redirect, `/library`, `/player/[songId]`)
- `components/ui/` — shadcn/ui-style primitives (Button, Dialog, Input, Select, Card, PageHeader)
- `components/layout/` — app shell + sidebar nav
- `features/library/` — song list + import dialog (components / data / types)
- `features/player/` — player screen incl. `AlphaTabPlayer` (components / data / types)
- `lib/` — tiny shared helpers

Imported songs (tab bytes as base64 + audio file names + chosen instrument) are
persisted to `localStorage` (`features/library/data/songStore.ts`); the backing
mp3 is too large for `localStorage` so it goes to IndexedDB
(`features/player/data/audioStore.ts`).

The player renders one score track at a time — pick the instrument from the
transport dropdown or the mixer's eye toggles; the choice is remembered per song.

### mp3 ↔ tab sync

alphaTab runs in **`PlayerMode.EnabledExternalMedia`**: the imported mp3 is the
time source and alphaTab's cursor is driven by it (`features/player/data/backingSync.ts`
supplies the media handler and pumps `output.updatePosition(...)` each frame),
so playback can't drift. alphaTab's own synthesizer is silent in this mode —
the audio you hear is the recording, and the mixer's per-instrument volume/solo
controls do not apply.

The score↔audio mapping is a **`SyncMap`** (`features/player/data/syncMap.ts`):
a monotonic, piecewise-linear `scoreTime ↔ audioTime` function, unit-tested,
with `scoreTimeToAudioTime` / `audioTimeToScoreTime`, isotonic smoothing and
`withAnchor()` for manual correction. Every strategy produces one:

- **`OffsetSyncGenerator`** (default, in-browser) — first-onset estimate
  (`autoAlign.ts`, `decodeAudioData`) + manual **± nudge**, expressed as a
  2-point offset + global-tempo-fit map. Instant; no drift resistance.
- **`DtwSyncGenerator`** → `POST /api/align` (dev only) → the offline
  **SyncToolbox MrMsDTW** pipeline in `align/` → a dense nonlinear map that
  tracks local tempo. See `align/README.md`.

Importing a song **queues DTW automatically** (`features/player/data/alignmentQueue.ts`).
The run is serialized and off the import path — the song opens immediately on the
linear offset map, and the player swaps in the DTW map through the sync store's
change event when the job lands, no reload needed. Re-running it from the
diagnostics panel goes through the same queue, so two runs can never overlap.

The map is pushed to alphaTab as `FlatSyncPoint`s, sampled at every bar downbeat
**and every beat** — alphaTab interpolates linearly between consecutive points,
so beat spacing is what bounds cursor drift inside a bar (at 170 BPM a 4/4 bar
is 1.41 s, which is a long time to assume constant tempo). `useBackingSync` is
unchanged.
Persisted per song in `learn-bass.audio-sync` (`AudioSyncSettings.syncMap`).
Speed changes keep pitch (`audio.preservesPitch`) and never touch the map.

**Gameplay timing** is kept separate from the visual cursor:
`features/player/data/audioClock.ts` (`AudioClock`) reads
`AudioContext.currentTime` and answers "what score time, right now" through the
same `SyncMap` — for future note scoring, independent of alphaTab's UI cadence.

**Measuring alignment** is done offline by `align/evaluate.py`, which maps each
notated attack through the curve and reports how far the nearest real onset in
the recording is — plus a slip histogram in sixteenth notes, which is what
catches a fast song whose alignment has locked onto the wrong subdivision.
`align/sweep.py` scores a grid of DTW configurations against one song. Neither
the panel's "Error" readout nor `residualRmsMs` measures accuracy; see
`align/README.md`.

**Diagnostics** (dev builds): the transport's activity icon opens a panel with
the score→audio warping curve, live alignment error, and a **Run DTW alignment**
button; `window.__syncDebug()` returns the same numbers in the console. The
**`/sync-debug/[songId]`** page (`SyncDebugView`) draws the recording as a
waveform with GP bar/beat markers overlaid at their mapped times, an optional
scheduled **click overlay**, and a **Measure onsets** pass that reports per-bar
residual (detected onset − predicted marker) with a scatter and worst-bars
table — the numeric way to compare offset vs DTW on one song.

Full audit + rationale: [`docs/sync-audit.md`](docs/sync-audit.md).

## alphaTab assets

alphaTab's worker/worklet scripts must be served same-origin, so a trimmed copy
of its runtime lives in `public/alphatab/` (script + worker + worklet and the
Bravura music font). The soundfont is not needed — external-media mode doesn't
synthesize. To refresh after upgrading the `@coderline/alphatab` dependency:

```bash
rm -rf public/alphatab && mkdir -p public/alphatab
cp -R node_modules/@coderline/alphatab/dist/. public/alphatab/
# keep: alphaTab{,.core,.worker,.worklet}.mjs, font/Bravura.woff2, font/Bravura.woff
```

`AlphaTabPlayer` forces alphaTab's module-worker code path (Turbopack mangles the
`import.meta.url` it uses to self-detect) and points its worker/worklet lookups
at `public/alphatab`.
