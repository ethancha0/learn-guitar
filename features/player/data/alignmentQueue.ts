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

/**
 * `/api/align` is disabled in production, so there is nothing to queue there.
 * Exported because the UI has to hide the controls that would call it — the
 * diagnostics panel is reachable in production now (see
 * `syncDiagnosticsFlag.ts`), and a button that can only 404 is worse than no
 * button.
 */
export const ALIGNMENT_ENABLED = process.env.NODE_ENV !== "production";

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
  if (!ALIGNMENT_ENABLED || typeof window === "undefined") {
    return Promise.resolve(null);
  }

  const active = jobs.get(req.songId);
  if (active?.state === "queued" || active?.state === "running") {
    return Promise.resolve(null);
  }
  if (!req.force && hasUsableMap(req.songId)) return Promise.resolve(null);

  if (!req.force) patchAudioSync(req.songId, { dtwStatus: "pending" });
  setJob(req.songId, { state: "queued", message: "Alignment queued…" });
  const run = chain.then(() => align(req));
  // Keep the chain alive: one failed run must not cancel everything behind it.
  chain = run.catch(() => undefined);
  return run;
}

async function align(req: AlignmentRequest): Promise<AlignmentJob> {
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
