# Learn Bass

UI foundation for a bass-guitar learning app (synced tabs + rhythm-game feedback).
UI only right now — no audio, no alphaTab, no backend, no auth, no DB.

## Run

```bash
npm install
npm run dev     # http://localhost:3000  (/ redirects to /library)
npm run build   # production build + type check
```

## Structure

- `app/` — App Router routes (`/` → redirect, `/library`, `/player/[songId]`)
- `components/ui/` — generic primitives (Button, PageHeader)
- `components/layout/` — app shell + sidebar nav
- `features/library/` — song list domain (components / data / types)
- `features/player/` — player screen domain (components / data / types)
- `lib/` — tiny shared helpers

Mock data lives in `features/*/data`. Swap for real imported-file metadata later.
