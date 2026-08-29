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

Recordings start with lead-in silence, so each song stores an **alignment
offset** (`learn-bass.audio-sync` in `localStorage`, via `getAudioSync` /
`patchAudioSync`). It is applied as a single bar-0 alphaTab sync point, which
also linearly time-fits the whole tab across the recording — absorbing a
constant tempo difference between the GP file and the record. Set it with the
transport bar's **Auto-align** (first-onset estimate via `decodeAudioData`,
`features/player/data/autoAlign.ts`) plus **± nudge** buttons; adjust while
playing until the strums line up.

Speed changes keep pitch (`audio.preservesPitch`). The recording's level lives
in the transport bar (`BackingVolumeControl`) and the mixer.

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
