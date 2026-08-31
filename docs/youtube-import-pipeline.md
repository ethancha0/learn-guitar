# YouTube Import Pipeline

This note captures the implementation decisions from the YouTube import work and
the current flow from search to download to alignment.

## Recap

The goal was to let users search YouTube as an alternative to manually importing
an audio file, then pair that selected recording with an imported Guitar Pro /
PowerTab file. The implementation avoids the YouTube Data API key path and uses
local server-side tools instead:

- `yt-dlp` for YouTube search and audio retrieval.
- `ffmpeg` for remuxing/conversion.
- `ffprobe` for media inspection.

All YouTube search/download logic is server-side. The browser only calls local
API routes and receives normalized metadata or a downloaded compressed audio
file.

## Code Layout

```text
lib/youtube/
├── search.ts      # searchYouTube(query)
├── download.ts    # downloadYouTubeAudio(videoId)
├── metadata.ts    # validation, ffprobe, FFmpeg WAV prep
└── types.ts       # shared result/metadata/error types
```

Thin API adapters expose the library to the client:

```text
app/api/youtube/search/route.ts
app/api/youtube/download/route.ts
```

Alignment normalization happens in:

```text
app/api/align/route.ts
```

The import UI is wired through:

```text
features/library/components/ImportSongDialog.tsx
```

## Pipeline

```text
User searches for song
        |
        v
ImportSongDialog calls GET /api/youtube/search?q=...
        |
        v
searchYouTube(query)
        |
        v
yt-dlp --dump-single-json --skip-download ytsearch8:<query>
        |
        v
Normalized search results:
  - videoId
  - title
  - channel/uploader
  - thumbnail
  - durationSec
  - url
        |
        v
User selects a result
        |
        v
ImportSongDialog calls POST /api/youtube/download
        |
        v
downloadYouTubeAudio(videoId)
        |
        v
Validate video ID/URL and reject playlists
        |
        v
yt-dlp reads video metadata and checks max duration
        |
        v
yt-dlp downloads best audio:
  ba[ext=m4a][acodec^=mp4a] /
  ba[ext=m4a] /
  ba[acodec^=mp4a] /
  ba[ext=webm] /
  ba
        |
        v
ffprobe inspects downloaded audio
        |
        v
If AAC/M4A-compatible:
  ffmpeg remuxes to clean .m4a with -c:a copy
  This rewrites container/timestamps without lossy transcoding.

If not AAC:
  Keep original compressed audio for now.
        |
        v
Browser receives compressed audio file
        |
        v
Existing import flow treats it like an uploaded audio file
```

## Playback And Storage

The compressed audio file is the playback/storage source of truth. It is not
stored directly in Postgres.

For signed-in users:

```text
compressed audio file -> Supabase Storage
tab file              -> Supabase Storage
metadata/paths        -> public.songs row
```

The `songs` row stores paths such as `audio_path` and `tab_path`, plus optional
`youtube_source` JSON metadata. LocalStorage is only a local-only fallback and a
UI preference store; account-backed songs should live in Supabase.

For immediate playback after import, the compressed audio is also cached in
IndexedDB under the song ID.

## Alignment

DTW alignment should not run directly on arbitrary compressed/container audio.
Before calling the existing Python alignment pipeline, `/api/align` uses:

```ts
prepareAudioForAlignment(file)
```

That function:

1. Writes the uploaded/downloaded audio to a temp directory when needed.
2. Uses `ffprobe` to inspect the source.
3. Uses `ffmpeg` to create a temporary mono PCM WAV:

```text
22050 Hz
mono
pcm_s16le
```

4. Passes that WAV path to `align/align.py`.
5. Cleans up temporary files after the request.

The original compressed file remains the playback/storage file. The WAV is only
temporary DSP input.

## Important Alignment Fix

The first YouTube implementation could download a YouTube DASH audio container
and play that exact compressed file in the browser while DTW analyzed a decoded
temporary WAV. Some YouTube containers can have timestamp/priming behavior that
causes the browser playback time origin to differ from the WAV decode used by
FFmpeg/librosa.

To reduce that mismatch, AAC/M4A downloads are now remuxed into a clean `.m4a`
using stream copy:

```text
ffmpeg ... -c:a copy -movflags +faststart -avoid_negative_ts make_zero
```

This avoids unnecessary lossy transcoding while making the playback file more
stable for browser playback and alignment.

If a YouTube result only provides WebM/Opus, the current MVP keeps it compressed
instead of silently transcoding. If WebM/Opus results still misalign, the next
pragmatic option is an explicit compatibility mode that transcodes those sources
to an AAC/M4A playback file.

## Validation And Errors

The current reusable layer includes:

- YouTube video ID and URL validation.
- Playlist rejection.
- Max duration limit: `YOUTUBE_MAX_DURATION_SEC`, currently 15 minutes.
- Missing dependency errors for `yt-dlp`, `ffmpeg`, and `ffprobe`.
- Temp file cleanup on success/failure.
- Safe process spawning with argument arrays and `shell: false`.

## Required Local Dependencies

For macOS local development:

```bash
brew install yt-dlp ffmpeg
```

This provides:

```text
yt-dlp
ffmpeg
ffprobe
```

No YouTube API key is required. No YouTube environment variable is required
locally either — `YOUTUBE_WORKER_URL` is only needed for deployments that cannot
spawn these binaries (see Deployment Notes).

## Testing Checklist

1. Start the app:

```bash
npm run dev
```

2. Open `/library`.
3. Click `Import song`.
4. Search for a song in the YouTube search box.
5. Select a result and wait for the audio download to finish.
6. Add a matching Guitar Pro / PowerTab file.
7. Click `Finish`.
8. Confirm the song opens in the player.
9. Confirm DTW starts and eventually produces a sync map.
10. If alignment looks wrong, inspect alignment diagnostics:

```text
diagnostics.sourceAudio
diagnostics.alignmentAudio
```

These show the compressed source metadata and temporary WAV metadata used by
the alignment request.

Useful automated checks:

```bash
npx tsc --noEmit
npm test
npx next build --webpack
```

`next build` with Turbopack has shown a local environment panic unrelated to the
YouTube code, so webpack is the current reliable production-build check.

## Deployment Notes

Hosting this feature requires a Node runtime that can execute local binaries and
write temporary files. That rules out Vercel's Node lambda, for two reasons:

1. The `youtube-dl-exec` npm binary is a `#!/usr/bin/env python3` zipapp. It
   works on a Mac with Homebrew Python; the Vercel image ships no `python3`, so
   `spawn` fails. The feature therefore works locally and fails on production.
2. Even with a standalone binary, YouTube blocks datacenter IP ranges with
   "Sign in to confirm you're not a bot."

So production runs yt-dlp in a container instead: `services/yt-dlp-worker`.

### Provider selection

`lib/youtube/provider.ts` decides at request time:

```text
YOUTUBE_WORKER_URL set   -> worker  (HTTP call to services/yt-dlp-worker)
nothing set, local dev   -> local   (spawn yt-dlp/ffmpeg on this machine)
nothing set, on Vercel   -> MISSING_DEPENDENCY with a configuration message
```

`YOUTUBE_PROVIDER=local|worker` forces one explicitly.

```text
                 dev                             production
                 ---                             ----------
searchYouTube    spawn yt-dlp                    GET  worker /search
downloadYouTube  spawn yt-dlp + ffmpeg           POST worker /download
                                                   -> bytes + X-Audio-Metadata
```

Both paths return the same `YouTubeSearchResult[]` / `DownloadedYouTubeAudio`
shapes, so the API routes and `ImportSongDialog` are unchanged. The worker owns
the duration check, the AAC faststart remux, and the ffprobe inspection, so the
Vercel function never needs `yt-dlp`, `ffmpeg`, or `ffprobe` — only the
`DownloadedYouTubeAudio` it gets back. `bytes` is set on the worker path and
`path` on the local path; `readDownloadedAudio` handles both.

Environment variables:

```text
YOUTUBE_WORKER_URL     https://<worker-host>
YOUTUBE_WORKER_TOKEN   shared secret, matches YT_WORKER_TOKEN on the worker
```

Setup, deploy steps, and the cookie/proxy options for YouTube's bot check are in
`services/yt-dlp-worker/README.md`.

### Still worth doing

Download/conversion is still on the request path, bounded by the Vercel function
timeout (`maxDuration = 300`). Long videos or a cold worker will eventually want
a real job queue with the client polling for completion.

## Conversation Summary

The implementation started with a YouTube Data API search route, but that
required `YOUTUBE_API_KEY` and only provided metadata. The feature was then
refactored around a keyless server-side abstraction using `yt-dlp` and FFmpeg.

After that, storage behavior was corrected so account-backed songs are stored in
Supabase Storage plus Postgres metadata instead of requiring large tab/audio
data in localStorage. LocalStorage remains only a fallback for local-only
imports.

The latest alignment issue compared a YouTube-imported version against a manual
MP3 upload of the same recording. The likely cause was container/time-origin
mismatch between the compressed YouTube download and the WAV used for DTW. The
download path now remuxes AAC/M4A sources into a clean `.m4a` without
transcoding, so playback and analysis should be based on a more consistent
source.
