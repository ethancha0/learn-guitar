# yt-dlp worker

A small container that owns `yt-dlp` and `ffmpeg` for the Next app. Deploy it
once, point `YOUTUBE_WORKER_URL` at it, and `/api/youtube/search` and
`/api/youtube/download` work in production.

## Why this exists

The Next app cannot run `yt-dlp` itself on Vercel:

1. The `youtube-dl-exec` npm binary is a `#!/usr/bin/env python3` zipapp. It
   runs on a Mac with Homebrew Python; Vercel's Node lambda has no `python3`,
   so `spawn` fails there. This is why the feature works locally but not on
   production.
2. Even with a standalone binary, YouTube blocks datacenter IP ranges with
   "Sign in to confirm you're not a bot." A long-lived container gives you
   somewhere to attach cookies or a proxy; a lambda does not.

## API

All routes except `/health` require `Authorization: Bearer $YT_WORKER_TOKEN`.

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness plus resolved `yt-dlp`/`ffmpeg` versions. Unauthenticated. |
| `GET /search?q=&maxResults=&maxDurationSec=` | `{ results: YouTubeSearchResult[] }` |
| `POST /download` `{ videoId, maxDurationSec }` | Audio bytes, with metadata as base64 JSON in `X-Audio-Metadata` |

Errors are `{ error, code, details? }`. `code` is passed straight through to the
app's `YouTubeToolError`, so `BOT_CHECK` and `DURATION_TOO_LONG` reach the UI
intact.

One deliberate difference from the local dev path: `/search` uses
`--flat-playlist`, so results have no `publishedAt`. That is one YouTube request
per search instead of one per result — 4x faster and much less exposed to the
bot check. The import UI renders the date only when present.

## Run locally

```bash
cd services/yt-dlp-worker
npm run dev            # no token required, listens on :8080
curl localhost:8080/health
```

Then point the Next app at it:

```bash
# .env.local
YOUTUBE_WORKER_URL=http://127.0.0.1:8080
YOUTUBE_WORKER_TOKEN=
```

Without `YOUTUBE_WORKER_URL` the app spawns your local `yt-dlp`/`ffmpeg`
directly, which is the normal dev setup (`brew install yt-dlp ffmpeg`).

## Deploy

### Fly.io

```bash
cd services/yt-dlp-worker
fly launch --no-deploy                       # edit `app` in fly.toml
fly secrets set YT_WORKER_TOKEN="$(openssl rand -hex 32)"
fly deploy
curl https://<your-app>.fly.dev/health
```

`fly.toml` sets `auto_stop_machines = "suspend"` with `min_machines_running = 0`,
so the machine sleeps when idle and you pay for roughly the seconds you use.
Cold start is a few seconds, which lands inside the app's request timeout.

### Railway / Render

Point the service at this directory, use the `Dockerfile` builder, expose port
`8080`, and set `YT_WORKER_TOKEN`. Note that both platforms keep the service
warm and bill accordingly.

### Then, in the Vercel project

```
YOUTUBE_WORKER_URL   = https://<your-app>.fly.dev
YOUTUBE_WORKER_TOKEN = <the same value as YT_WORKER_TOKEN>
```

Redeploy so the functions pick up the new env vars.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `YT_WORKER_TOKEN` | — | Shared secret. Required unless `YT_WORKER_ALLOW_ANONYMOUS=1`. |
| `PORT` | `8080` | Listen port. |
| `MAX_DURATION_SEC` | `900` | Longest video the worker will fetch. |
| `YT_DLP_COOKIES` | — | Netscape `cookies.txt` contents, raw or base64. |
| `YT_DLP_COOKIES_FILE` | — | Path to a cookie file, if you mount one instead. |
| `YT_DLP_PROXY` | — | Outbound proxy, e.g. `http://user:pass@host:port`. |
| `YT_DLP_EXTRACTOR_ARGS` | — | e.g. `youtube:player_client=android,web_safari`. |
| `YT_DLP_PATH` / `FFMPEG_PATH` / `FFPROBE_PATH` | on `PATH` | Binary overrides. |

## When YouTube blocks the worker

A `BOT_CHECK` error means YouTube rejected the container's IP. In rough order of
effort:

1. **Try a different extractor client** — often enough on its own:
   `YT_DLP_EXTRACTOR_ARGS=youtube:player_client=android,web_safari`
2. **Add cookies.** Export `cookies.txt` from a browser signed in to YouTube
   (any "Get cookies.txt" extension), then:
   ```bash
   fly secrets set YT_DLP_COOKIES="$(base64 < cookies.txt)"
   ```
   Use a throwaway Google account — these cookies grant access to it, and
   YouTube may flag the account for datacenter access. Cookies expire; expect to
   refresh them periodically.
3. **Route through a proxy.** `YT_DLP_PROXY` with a residential proxy is the
   most reliable option and the only one that really survives at volume.
4. **Move the worker.** Some hosts' IP ranges are less burnt than others; a
   cheap VPS on a residential-adjacent network beats a big cloud.

## Keeping yt-dlp current

YouTube changes break yt-dlp regularly. The image installs the latest release at
build time, so rebuilding is the upgrade:

```bash
fly deploy --no-cache
```

To pin a known-good release instead:

```bash
fly deploy --build-arg YT_DLP_VERSION=2026.08.19
```
