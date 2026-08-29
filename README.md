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
The mixer (`features/player/components/Mixer.tsx`) drives alphaTab's master /
metronome / per-track volume, mute and solo, plus a plain `<audio>` element for
the backing mp3 that is kept roughly in sync with alphaTab's playhead (no
time-stretching, so speed changes pitch-shift the backing track).

## alphaTab assets

alphaTab's worker/worklet scripts must be served same-origin, so a trimmed copy
of its runtime lives in `public/alphatab/` (script + worker + worklet, the
Bravura music font, and the sonivox soundfont). To refresh after upgrading the
`@coderline/alphatab` dependency:

```bash
rm -rf public/alphatab && mkdir -p public/alphatab
cp -R node_modules/@coderline/alphatab/dist/. public/alphatab/
# keep: alphaTab{,.core,.worker,.worklet}.mjs, font/Bravura.woff2, font/Bravura.woff, soundfont/sonivox.sf3
```

`AlphaTabPlayer` forces alphaTab's module-worker code path (Turbopack mangles the
`import.meta.url` it uses to self-detect) and points its worker/worklet lookups
at `public/alphatab`.
