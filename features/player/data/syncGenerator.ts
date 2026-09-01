"use client";

/**
 * Pluggable score↔audio alignment strategies. Each produces a `SyncResult`
 * (dense `{ scoreTime, audioTime }` points in seconds) that the player turns
 * into a `SyncMap` and feeds to alphaTab via `useBackingSync`.
 *
 *   - `OffsetSyncGenerator` — the current approach: first-onset estimate +
 *     manual nudge, expressed as a 2-point offset+global-fit map. Fast, in
 *     browser, no drift resistance.
 *   - `DtwSyncGenerator` — POSTs the GP + mp3 to `/api/align`, which runs
 *     SyncToolbox MrMsDTW offline and returns a nonlinear mapping.
 *
 * Keeping both behind one interface lets us benchmark them on the same song.
 */

import type {
  SyncPoint,
  SyncMapDiagnostics,
  AlphaTabFlatSyncPoint,
} from "./syncMap";
import { SyncMap } from "./syncMap";
import { estimateLeadInMs } from "./autoAlign";

export interface SyncInput {
  songId: string;
  /** Raw Guitar Pro file bytes. */
  gpBytes: Uint8Array;
  /** The imported recording. */
  audioBlob: Blob;
  /** Score length in seconds (alphaTab's `playerPositionChanged.endTime / 1000`). */
  scoreDurationSec: number;
  /** Recording length in seconds. */
  audioDurationSec: number;
  /** Existing manual offset in ms, used by `OffsetSyncGenerator`. */
  offsetMs?: number;
  /**
   * Trusted manual anchors. A generator that supports segment-wise refinement
   * solves each region *between* consecutive anchors independently, which is how
   * repeated choruses / transcription errors stop poisoning the whole song.
   */
  anchors?: Array<{ scoreTime: number; audioTime: number }>;
}

export interface SyncResult {
  points: SyncPoint[];
  /** alphaTab points precomputed by the pipeline (optional). */
  alphaTabFlatSyncPoints?: AlphaTabFlatSyncPoint[];
  method: string;
  status: "ok" | "low-confidence" | "failed";
  diagnostics?: SyncMapDiagnostics;
  message?: string;
  /**
   * Lengths the mapping was solved against, when the generator measured them
   * itself. A background run has no alphaTab instance to ask for the score
   * length and no decoded PCM for the recording, so these are what let it
   * record the durations needed for staleness detection.
   */
  scoreDurationSec?: number;
  audioDurationSec?: number;
}

export interface SyncGenerator {
  readonly id: string;
  generate(input: SyncInput): Promise<SyncResult>;
}

export function resultToSyncMap(result: SyncResult): SyncMap {
  return SyncMap.fromPoints(result.points, {
    method: result.method,
    ...(result.diagnostics ?? {}),
  });
}

// --- current approach ------------------------------------------------------

export class OffsetSyncGenerator implements SyncGenerator {
  readonly id = "offset";

  async generate(input: SyncInput): Promise<SyncResult> {
    let offsetSec = (input.offsetMs ?? 0) / 1000;
    let status: SyncResult["status"] = "ok";
    let message: string | undefined;

    // If no manual offset was given, estimate the lead-in from the first onset.
    if (!input.offsetMs) {
      try {
        const leadInMs = await estimateLeadInMs(input.audioBlob);
        offsetSec = leadInMs / 1000;
        if (leadInMs === 0) {
          status = "low-confidence";
          message = "Could not detect a clear first onset.";
        }
      } catch {
        status = "low-confidence";
        message = "Onset detection failed; using offset 0.";
      }
    }

    const map = SyncMap.fromOffset(
      offsetSec,
      input.scoreDurationSec,
      input.audioDurationSec,
    );
    return {
      points: [...map.points],
      method: "offset",
      status,
      message,
      diagnostics: { method: "offset", offsetSec },
    };
  }
}

// --- DTW via the offline pipeline ----------------------------------------------

interface AlignApiResponse {
  status: "ok" | "low-confidence" | "failed";
  method?: string;
  points?: SyncPoint[];
  alphaTabFlatSyncPoints?: AlphaTabFlatSyncPoint[];
  diagnostics?: SyncMapDiagnostics;
  message?: string;
  /** Score length used for clipping — the request's, or the GP bar timeline's. */
  scoreDurationSec?: number;
  /** Decoded length of the recording. */
  recordingDurationSec?: number;
}

async function readAlignError(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
      message?: unknown;
      details?: unknown;
    } | null;
    const message =
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : undefined;
    const details =
      typeof body?.details === "string" ? body.details : undefined;
    return [message, details].filter(Boolean).join(" ") || undefined;
  }

  const text = await response.text().catch(() => "");
  return text.trim().slice(0, 500) || undefined;
}

export class DtwSyncGenerator implements SyncGenerator {
  readonly id = "dtw";

  constructor(private endpoint = "/api/align") {}

  async generate(input: SyncInput): Promise<SyncResult> {
    const form = new FormData();
    const gpBuffer = input.gpBytes.buffer.slice(
      input.gpBytes.byteOffset,
      input.gpBytes.byteOffset + input.gpBytes.byteLength,
    ) as ArrayBuffer;
    form.append(
      "gp",
      new Blob([gpBuffer], { type: "application/octet-stream" }),
      "score.gp",
    );
    form.append("audio", input.audioBlob, "recording.audio");
    form.append("scoreDurationSec", String(input.scoreDurationSec));
    if (input.anchors?.length) {
      form.append("anchors", JSON.stringify(input.anchors));
    }

    let res: Response;
    try {
      res = await fetch(this.endpoint, { method: "POST", body: form });
    } catch (err) {
      return {
        points: [],
        method: "dtw",
        status: "failed",
        message: `Alignment service unreachable: ${(err as Error).message}`,
      };
    }

    if (!res.ok) {
      const detail = await readAlignError(res);
      return {
        points: [],
        method: "dtw",
        status: "failed",
        message: detail
          ? `Alignment service returned ${res.status}: ${detail}`
          : `Alignment service returned ${res.status}.`,
      };
    }

    const data = (await res.json()) as AlignApiResponse;
    if (data.status === "failed" || !data.points || data.points.length < 2) {
      return {
        points: [],
        method: data.method ?? "dtw",
        status: "failed",
        message: data.message ?? "Alignment produced no usable mapping.",
        diagnostics: data.diagnostics,
      };
    }

    return {
      points: data.points,
      alphaTabFlatSyncPoints: data.alphaTabFlatSyncPoints,
      method: data.method ?? "dtw:mrmsdtw",
      status: data.status,
      diagnostics: data.diagnostics,
      message: data.message,
      scoreDurationSec: data.scoreDurationSec,
      audioDurationSec: data.recordingDurationSec,
    };
  }
}
