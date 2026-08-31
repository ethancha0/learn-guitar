# Learn Bass

Learn Bass is a web app for practicing bass parts against the original
recording. It imports a Guitar Pro/PowerTab score, pairs it with backing audio,
renders the tab in the browser, and keeps the score cursor synchronized to the
recording with an alignment pipeline built for real-song tempo drift.

## What It Does

- Imports tabs from local Guitar Pro/PowerTab files or Songsterr search/results.
- Imports backing audio from local files or YouTube search/download.
- Renders multi-track notation and tablature with alphaTab, including track
  selection, tab-only display, looping, speed control, and separate backing /
  reference-synth volume.
- Syncs alphaTab to the real recording instead of alphaTab's MIDI playback, so
  users practice against the source audio.
- Generates score-to-audio maps with either a fast onset/offset estimate or a
  dev-only DTW pipeline for nonlinear tempo alignment.
- Persists local songs in IndexedDB/localStorage, with optional Supabase Auth,
  Postgres metadata, private Storage files, and row-level security for accounts.
- Includes diagnostics for alignment quality: waveform overlays, bar/beat
  markers, manual anchors, onset residuals, and DTW retry controls.

## Architecture Flow

```text
Library / ImportSongDialog
  -> Songsterr API routes resolve metadata and convert revisions to .gp files
  -> YouTube API routes use yt-dlp + ffprobe/ffmpeg for search and audio import
  -> tab bytes are stored as song metadata; audio Blob is cached in IndexedDB
  -> signed-in users also upload tab/audio files to Supabase Storage and metadata to Postgres
  -> player route opens immediately and queues background alignment

Player / AlphaTabPlayer
  -> alphaTab loads the Guitar Pro/PowerTab bytes and renders the selected track
  -> imported audio is the playback clock via EnabledExternalMedia mode
  -> SyncMap maps score time <-> audio time for cursor movement and future scoring
  -> DTW jobs can replace the initial offset map without reloading the player

Alignment / align/
  -> alphaTab converts the GP score to MIDI + bar/beat timing data
  -> ffmpeg prepares the recording as 22.05 kHz mono PCM WAV for analysis
  -> Python + librosa + SyncToolbox MrMsDTW produce a monotonic nonlinear warp path
  -> the client resamples that path into alphaTab sync points and stores it per song
```

## Tech Stack

- **Frontend:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS.
- **UI:** Radix Dialog primitives, lucide-react icons, class-variance-authority,
  clsx, and tailwind-merge.
- **Music rendering:** `@coderline/alphatab` served from same-origin assets in
  `public/alphatab` for worker/worklet compatibility.
- **Media import:** Node.js route handlers wrap `yt-dlp`, `ffmpeg`, and
  `ffprobe` for YouTube search, download, validation, duration checks, and audio
  normalization.
- **Tab import:** Songsterr lookup/download helpers resolve current revisions
  and convert fetched parts into Guitar Pro data for alphaTab.
- **Persistence:** IndexedDB for large local audio Blobs, localStorage for small
  preferences/sync metadata, and optional Supabase Auth + Postgres + private
  Storage for account-backed imports.
- **Alignment:** TypeScript `SyncMap` utilities plus a Python offline pipeline
  using librosa, fluidsynth, and SyncToolbox MrMsDTW.
- **Testing:** Vitest unit tests cover sync maps, audio clocks, alignment queue
  behavior, waveform/onset logic, Songsterr parsing, and YouTube media helpers.

## Run Locally

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build + type check
npm test         # Vitest
```

For YouTube import and alignment audio preparation on macOS:

```bash
brew install yt-dlp ffmpeg
```

For account-backed imports, create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Then run `supabase/schema.sql` in Supabase, enable Google Auth, and configure
the OAuth callback for `/auth/callback`.

For DTW alignment, set up the Python environment in `align/README.md` and point
`ALIGN_PYTHON` at that interpreter. The `/api/align` route is intentionally
disabled in production because alignment is treated as an offline preprocessing
step.

## Project Layout

```text
app/                         Next.js pages and API route handlers
features/library/            import dialog, song grid, local/Supabase song stores
features/player/components/  alphaTab player, transport, mixer, diagnostics UI
features/player/data/        sync maps, audio clock, DTW queue, waveform/onset logic
lib/songsterr/               Songsterr lookup, revision parsing, GP conversion
lib/youtube/                 yt-dlp/ffmpeg wrappers and media validation
lib/supabase/                browser/server Supabase clients
align/                       offline score-to-recording DTW alignment tools
docs/                        implementation notes and sync audits
supabase/schema.sql          account storage schema, bucket, and RLS policies
```

## Deeper Notes

- [YouTube import pipeline](docs/youtube-import-pipeline.md)
- [Alignment pipeline](align/README.md)
- [Sync audit](docs/sync-audit.md)
- [End-of-song drift and anchors](docs/sync-audit-2.md)
- [alphaTab timing drift audit](docs/sync-audit-3.md)
