import { SongsterrError } from "./types";

export interface SongsterrRef {
  songId: number;
  /** Track index from a `…s14t5` style URL, when the link points at one track. */
  trackIndex?: number;
  /** Pinned revision from `?revision=`; otherwise the caller resolves the current one. */
  revisionId?: number;
}

/** `…-tab-s14`, `…-tab-s14t5` — the slug carries the ids in its final segment. */
const SLUG_IDS_RE = /-s(\d+)(?:t(\d+))?$/;

function positiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Parse a Songsterr song link (or a bare song id) into its ids.
 *
 * Handles the slug form (`/a/wsa/<artist>-<title>-tab-s14t5`) and the legacy
 * query form (`/a/wa/song?id=14`).
 */
export function parseSongsterrUrl(input: string): SongsterrRef {
  const raw = input.trim();
  if (!raw) {
    throw new SongsterrError("VALIDATION", "Enter a Songsterr link or song ID.");
  }

  if (/^\d+$/.test(raw)) {
    const songId = Number(raw);
    if (!Number.isInteger(songId) || songId <= 0) {
      throw new SongsterrError("VALIDATION", "That is not a valid Songsterr song ID.");
    }
    return { songId };
  }

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new SongsterrError("VALIDATION", "Enter a valid Songsterr URL or song ID.");
  }

  if (url.hostname.replace(/^www\./, "") !== "songsterr.com") {
    throw new SongsterrError("VALIDATION", "Only songsterr.com links are supported.");
  }

  const revisionId = positiveInt(url.searchParams.get("revision"));

  // Legacy `/a/wa/song?id=14`.
  const queryId = positiveInt(url.searchParams.get("id"));
  if (queryId) {
    return {
      songId: queryId,
      trackIndex: positiveInt(url.searchParams.get("track")),
      revisionId,
    };
  }

  const lastSegment = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const match = lastSegment.match(SLUG_IDS_RE);
  if (!match) {
    throw new SongsterrError(
      "VALIDATION",
      "That Songsterr link has no song ID in it. Copy the URL from a song page.",
    );
  }

  const songId = Number(match[1]);
  if (!Number.isInteger(songId) || songId <= 0) {
    throw new SongsterrError("VALIDATION", "That Songsterr link has an invalid song ID.");
  }

  return {
    songId,
    trackIndex: match[2] === undefined ? undefined : Number(match[2]),
    revisionId,
  };
}
