"use client";

/**
 * Background DTW alignment jobs.
 *
 * A newly imported song has no score↔audio mapping, so the player falls back to
 * a straight line until someone opens the dev diagnostics panel and asks for
 * DTW. Instead, an import enqueues the alignment here: the run happens off the
 * import path (it takes tens of seconds to minutes), and the result is written
 * with `patchAudioSync`, whose change event an already-open player picks up —
 * so the cursor snaps into place mid-session without a reload.
 *
 * Runs are serialized: `/api/align` spawns fluidsynth + Python per request, and
 * two of those competing for the dev machine is slower than doing them in turn.
 */

import { useSyncExternalStore } from "react";
import {
  getAudioSync,
  patchAudioSync,
  type StoredSyncMap,
  type SyncAnchor,
} from "@/features/library/data/songStore";
import { DtwSyncGenerator } from "./syncGenerator";
import { alignCapability } from "./alignCapability";
import { fetchSyncMapFromAccount } from "@/features/library/data/supabaseSongStore";
import { applyRemoteSyncMap } from "@/features/library/data/songStore";

/**
 * How long to watch the account row for a map CI is solving, and how often.
 * A cold runner spends a couple of minutes installing before it aligns at all.
 * Giving up only stops the watching — the run continues, and the map is picked
 * up on the next open either way.
 */
const DISPATCH_POLL_MS = 10_000;
const DISPATCH_TIMEOUT_MS = 10 * 60_000;

export interface AlignmentJob {
  songId: string;
  state: "queued" | "running" | "done" | "failed";
  message?: string;
}

export interface AlignmentRequest {
  songId: string;
  /** Raw Guitar Pro file bytes. */
  gpBytes: Uint8Array;
  audioBlob: Blob;
  /**
   * Score length in seconds. Unknown at import time (only alphaTab knows it);
   * the aligner then falls back to the bar timeline it derives from the GP file.
   */
  scoreDurationSec?: number;
  audioDurationSec?: number;
  /** Manual corrections to solve between, if the song already has any. */
  anchors?: SyncAnchor[];
  /** Align even when the song already has a stored map. */
  force?: boolean;
}

const jobs = new Map<string, AlignmentJob>();
const listeners = new Set<() => void>();

function setJob(songId: string, job: Omit<AlignmentJob, "songId">): AlignmentJob {
  const next = { songId, ...job };
  jobs.set(songId, next);
  listeners.forEach((l) => l());
  return next;
}

function hasUsableMap(songId: string): boolean {
  return (getAudioSync(songId)?.syncMap?.points.length ?? 0) >= 2;
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Schedules DTW alignment for a song. Resolves once that song's run has
 * finished — or immediately with `null` when there is nothing to do (already
 * aligned, already queued, or alignment unavailable in this build).
 */
export function queueAlignment(
  req: AlignmentRequest,
): Promise<AlignmentJob | null> {
  // Whether alignment is possible is the server's answer, not a build flag;
  // `align` asks and reports the reason if it is not. See `alignCapability`.
  if (typeof window === "undefined") return Promise.resolve(null);

  const active = jobs.get(req.songId);
  if (active?.state === "queued" || active?.state === "running") {
    return Promise.resolve(null);
  }
  if (!req.force && hasUsableMap(req.songId)) return Promise.resolve(null);

  // Hold the player only when there is nothing usable to fall back on. That is
  // the real question, and it is not the same as `force`: a fresh import has no
  // mapping and must wait for one, while a manual re-align of an already-synced
  // song should keep playing on the map it has until the better one arrives.
  if (!hasUsableMap(req.songId)) {
    patchAudioSync(req.songId, { dtwStatus: "pending" });
  }
  setJob(req.songId, { state: "queued", message: "Alignment queued…" });
  const run = chain.then(() => align(req));
  // Keep the chain alive: one failed run must not cancel everything behind it.
  chain = run.catch(() => undefined);
  return run;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Alignment by GitHub Action: ask the server to fire the run, then watch the
 * song's account row for the map the workflow writes.
 *
 * Nothing is uploaded — the workflow pulls the files from storage itself — so
 * the recording never has to fit through a serverless request body.
 */
async function alignByDispatch(req: AlignmentRequest): Promise<AlignmentJob> {
  const res = await fetch("/api/align/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ songId: req.songId }),
  }).catch((err: Error) => err);

  if (res instanceof Error) {
    patchAudioSync(req.songId, { dtwStatus: "failed" });
    return setJob(req.songId, {
      state: "failed",
      message: `Could not queue alignment: ${res.message}`,
    });
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: { message?: string }) => d.message)
      .catch(() => undefined);
    patchAudioSync(req.songId, { dtwStatus: "failed" });
    return setJob(req.songId, {
      state: "failed",
      message: detail ?? `Could not queue alignment (${res.status}).`,
    });
  }

  // Handed off. `queued` blocks the player exactly as `pending` does — an
  // unaligned song is not worth practising against — but says the wait is on
  // CI, which the overlay reports so a multi-minute run does not read as a
  // stall. A song that already has a usable map keeps playing on it.
  if (!hasUsableMap(req.songId)) {
    patchAudioSync(req.songId, { dtwStatus: "queued" });
  }
  setJob(req.songId, {
    state: "running",
    message: "Aligning on CI… the map will appear when the run finishes.",
  });

  return pollForDispatchedMap(req.songId);
}

/**
 * Watches the song's account row for the map a CI run is producing.
 *
 * Split out because it has to be resumable: the player blocks on a `queued`
 * song, and a reload loses the in-memory job while the run carries on. Without
 * a way to pick the watch back up, that reload would leave the song blocked
 * with nobody looking for its map.
 */
async function pollForDispatchedMap(songId: string): Promise<AlignmentJob> {
  const deadline = Date.now() + DISPATCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(DISPATCH_POLL_MS);
    const map = await fetchSyncMapFromAccount(songId).catch(() => null);
    if (map) {
      applyRemoteSyncMap(songId, map);
      return setJob(songId, {
        state: "done",
        message: `Aligned on CI: ${map.points.length} points via ${map.method}.`,
      });
    }
  }

  // The run may yet succeed; this only stops watching. Marking it `failed`
  // releases the player rather than blocking it forever, and the next open
  // checks the account first, so a late map is still picked up.
  patchAudioSync(songId, { dtwStatus: "failed" });
  return setJob(songId, {
    state: "failed",
    message:
      "Alignment is taking longer than expected. If the CI run succeeds the " +
      "map will be there next time you open this song.",
  });
}

/**
 * Re-attaches to a run that was already dispatched — after a reload, or when
 * the song is opened in another tab. Does not dispatch anything: the run is
 * already out there, and starting a second one would supersede it.
 */
export function resumeDispatchedAlignment(
  songId: string,
): Promise<AlignmentJob | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const active = jobs.get(songId);
  if (active?.state === "queued" || active?.state === "running") {
    return Promise.resolve(null);
  }
  setJob(songId, {
    state: "running",
    message: "Waiting for the alignment run to finish…",
  });
  // Deliberately off `chain`: this is waiting, not working, and must not hold
  // up a local alignment queued behind it.
  return pollForDispatchedMap(songId);
}

async function align(req: AlignmentRequest): Promise<AlignmentJob> {
  const capability = await alignCapability();
  if (capability.mode === "unavailable") {
    patchAudioSync(req.songId, { dtwStatus: "failed" });
    return setJob(req.songId, {
      state: "failed",
      message: capability.message ?? "Alignment is not available here.",
    });
  }
  if (capability.mode === "dispatch") return alignByDispatch(req);

  setJob(req.songId, {
    state: "running",
    message: "Running DTW alignment… (this can take a minute)",
  });

  const existing = getAudioSync(req.songId)?.syncMap;
  const anchors = req.anchors ?? existing?.anchors ?? [];

  try {
    const result = await new DtwSyncGenerator().generate({
      songId: req.songId,
      gpBytes: req.gpBytes,
      audioBlob: req.audioBlob,
      scoreDurationSec: req.scoreDurationSec ?? 0,
      audioDurationSec: req.audioDurationSec ?? 0,
      anchors,
    });

    if (result.status === "failed" || result.points.length < 2) {
      patchAudioSync(req.songId, { dtwStatus: "failed" });
      return setJob(req.songId, {
        state: "failed",
        message: result.message ?? "DTW alignment failed.",
      });
    }

    const stored: StoredSyncMap = {
      points: result.points,
      // Manual corrections survive a re-run.
      anchors,
      method: result.method,
      status: result.status === "low-confidence" ? "low-confidence" : "ok",
      scoreEndSec: result.scoreDurationSec ?? req.scoreDurationSec ?? undefined,
      audioDurationSec: result.audioDurationSec ?? req.audioDurationSec ?? undefined,
      diagnostics: result.diagnostics as Record<string, unknown> | undefined,
      createdAt: Date.now(),
    };
    // The map replaces the linear offset entirely, so clear the manual nudge.
    patchAudioSync(req.songId, {
      syncMap: stored,
      offsetMs: 0,
      dtwStatus: "ready",
    });

    return setJob(req.songId, {
      state: "done",
      message:
        result.status === "low-confidence"
          ? `Aligned with low confidence — review suspicious sections. ${result.message ?? ""}`
          : `Aligned: ${result.points.length} points via ${result.method}.`,
    });
  } catch (err) {
    patchAudioSync(req.songId, { dtwStatus: "failed" });
    return setJob(req.songId, {
      state: "failed",
      message: `DTW alignment error: ${(err as Error).message}`,
    });
  }
}

// --- React binding -------------------------------------------------------------

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The latest alignment job for a song, if one has been scheduled this session. */
export function useAlignmentJob(songId: string): AlignmentJob | undefined {
  return useSyncExternalStore(
    subscribe,
    () => jobs.get(songId),
    () => undefined,
  );
}
