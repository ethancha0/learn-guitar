"use client";

import type {
  StoredSyncMap,
  SyncAnchor,
} from "@/features/library/data/songStore";
import { SyncMap, type SyncMapDiagnostics } from "./syncMap";

export type SyncSource = "dtw" | "offset" | "none";

export interface BuildSyncMapOptions {
  stored: StoredSyncMap | null;
  offsetMs: number;
  scoreEndSec: number;
  audioDurationSec: number;
}

export interface BuildSyncMapResult {
  syncMap: SyncMap | null;
  syncSource: SyncSource;
  syncWarning?: string;
  repairs: string[];
  anchors: SyncAnchor[];
}

/**
 * Single entry point for turning persisted sync settings into the playback map.
 * Applies anchors, sanitizes DTW tails, and extends to the score end — the same
 * pipeline in the player and on the sync-debug page.
 */
export function buildPlaybackSyncMap(
  opts: BuildSyncMapOptions,
): BuildSyncMapResult {
  const { stored, offsetMs, scoreEndSec, audioDurationSec } = opts;
  const anchors = stored?.anchors ?? [];
  let warning: string | undefined;
  const repairs: string[] = [];

  if (stored && stored.points.length >= 2) {
    try {
      const diagnostics: SyncMapDiagnostics = {
        method: stored.method,
        ...(stored.diagnostics ?? {}),
      };
      let map = SyncMap.fromPoints(stored.points, diagnostics);
      if (anchors.length) {
        map = map.withAnchors(anchors);
      }
      const sanitized = map.sanitize({
        scoreEndSec: scoreEndSec || undefined,
        audioDurationSec: audioDurationSec || undefined,
      });
      repairs.push(...sanitized.repairs);
      const syncWarning = repairs.length
        ? `Sync map repaired: ${repairs.join("; ")}.`
        : undefined;
      return {
        syncMap: sanitized.map,
        syncSource: "dtw",
        syncWarning,
        repairs,
        anchors,
      };
    } catch (err) {
      warning = `Stored sync map was rejected (${(err as Error).message}); using the linear offset fallback.`;
    }
  }

  if (scoreEndSec > 0 || audioDurationSec > 0) {
    let map = SyncMap.fromOffset(
      offsetMs / 1000,
      scoreEndSec || Math.max(audioDurationSec - offsetMs / 1000, 1),
      audioDurationSec,
    );
    if (anchors.length) {
      map = map.withAnchors(anchors);
    }
    return {
      syncMap: map,
      syncSource: "offset",
      syncWarning: warning,
      repairs,
      anchors,
    };
  }

  return { syncMap: null, syncSource: "none", syncWarning: warning, repairs, anchors };
}
