/**
 * Songsterr stores the actual tablature as one JSON payload per track ("part"),
 * on a CloudFront bucket keyed by song, revision and a per-revision image hash.
 * Fetching every part gives us the whole score, which `gp7.ts` turns into a
 * Guitar Pro file.
 */

import { metaPath } from "./api";
import { getSongsterrJson, isTimeoutError, songsterrFetch } from "./http";
import { SongsterrError } from "./types";
import { parseSongsterrUrl, type SongsterrRef } from "./url";

const PART_TIMEOUT_MS = 8_000;
const PRIMARY_CDN = "https://dqsljvtekg760.cloudfront.net";
const FALLBACK_CDN = "https://d3d3l6a6rcgkaf.cloudfront.net";

/** Songsterr's sentinel instrument id for percussion tracks. */
export const DRUM_INSTRUMENT_ID = 1024;

/** Track entry as it appears in the revision metadata. */
export interface SongsterrPartMeta {
  /** Position of this track's JSON payload in the revision, i.e. `<partId>.json`. */
  partId: number;
  instrumentId?: number;
  name?: string;
  title?: string;
  tuning?: number[];
  isDrums?: boolean;
}

/** Everything needed to address a revision's part payloads on the CDN. */
export interface SongsterrRevisionMeta {
  songId: number;
  revisionId: number;
  /** Per-revision content hash; the CDN path is invalid without it. */
  image: string;
  title: string;
  artist: string;
  tracks: SongsterrPartMeta[];
}

export interface SongsterrRevisionAutomationTempoPoint {
  measure: number;
  position: number;
  bpm: number;
  /** Denominator the `position` fraction is measured in. */
  type: number;
}

export interface SongsterrBendPoint {
  position: number;
  tone: number;
}

export interface SongsterrNotePayload {
  fret?: number;
  /** 0 is the highest-pitched string — the reverse of alphaTab's numbering. */
  string?: number;
  tie?: boolean;
  slide?: string;
  rest?: boolean;
  dead?: boolean;
  ghost?: boolean;
  /** Hammer-on or pull-off origin. */
  hp?: boolean;
  staccato?: boolean;
  accentuated?: boolean;
  vibrato?: boolean;
  wideVibrato?: boolean;
  harmonic?: string;
  harmonicFret?: number;
  bend?: { tone: number; points: SongsterrBendPoint[] };
}

export interface SongsterrBeatPayload {
  notes?: SongsterrNotePayload[];
  /** Denominator of the beat's base duration, used for tuplets. */
  type?: number;
  duration?: [number, number];
  dots?: number;
  text?: string | { text: string; width?: number };
  velocity?: string;
  rest?: boolean;
  palmMute?: boolean;
  vibrato?: boolean;
  wideVibrato?: boolean;
  vibratoWithTremoloBar?: string;
  pickStroke?: string;
  tuplet?: number;
}

export interface SongsterrVoicePayload {
  beats?: SongsterrBeatPayload[];
  rest?: boolean;
}

export interface SongsterrMeasurePayload {
  voices?: SongsterrVoicePayload[];
  signature?: [number, number];
  marker?: string | { text: string; width?: number };
  repeatStart?: boolean;
  repeatCount?: number;
  alternateEnding?: number;
  rest?: boolean;
}

export interface SongsterrPartPayload {
  name?: string;
  instrumentId?: number;
  tuning?: number[];
  strings?: number;
  measures?: SongsterrMeasurePayload[];
  automations?: { tempo?: SongsterrRevisionAutomationTempoPoint[] };
  partId?: number;
}

export interface SongsterrPart {
  trackMeta: SongsterrPartMeta;
  payload: SongsterrPartPayload;
}

/** Non-fatal problems worth surfacing without failing the whole conversion. */
export interface ConversionWarning {
  code: string;
  message: string;
  location?: string;
}

/**
 * A `status` failure means the CDN answered and refused us, so a different CDN
 * host may still have the file. `timeout` and `error` mean we never got an
 * answer at all, and a second full fan-out would most likely stall the same way.
 */
interface PartFetchFailure {
  partId: number;
  kind: "status" | "timeout" | "error";
  status?: number;
}

export interface FetchPartsResult {
  parts: SongsterrPart[];
  warnings: ConversionWarning[];
}

interface RawRevisionMeta {
  songId?: number;
  revisionId?: number;
  image?: string;
  title?: string;
  artist?: string;
  tracks?: Array<{
    instrumentId?: number;
    instrument?: string;
    name?: string;
    tuning?: number[];
  }>;
}

/**
 * Resolve a Songsterr link or song ID to the revision metadata the CDN paths
 * are built from.
 *
 * Songsterr's own page embeds this as a `#state` script tag and the community
 * downloaders scrape it, but `/api/meta` returns the same `revisionId` and
 * `image` without parsing HTML. The one field the JSON API omits is each
 * track's `partId`, which is simply its position in the list.
 */
export async function resolveRevisionMeta(
  input: string,
): Promise<{ meta: SongsterrRevisionMeta; ref: SongsterrRef }> {
  const ref = parseSongsterrUrl(input);
  const raw = await getSongsterrJson<RawRevisionMeta>(metaPath(ref));

  if (!raw?.songId || !raw.revisionId || !raw.image) {
    throw new SongsterrError(
      "NOT_FOUND",
      "Songsterr has no downloadable revision for that song.",
    );
  }

  const tracks: SongsterrPartMeta[] = (raw.tracks ?? []).map((track, partId) => ({
    partId,
    instrumentId: track.instrumentId,
    name: track.name || track.instrument,
    tuning: track.tuning,
    isDrums: track.instrumentId === DRUM_INSTRUMENT_ID,
  }));

  if (tracks.length === 0) {
    throw new SongsterrError("NOT_FOUND", "That Songsterr revision has no tracks.");
  }

  return {
    meta: {
      songId: raw.songId,
      revisionId: raw.revisionId,
      image: raw.image,
      title: raw.title || "Song",
      artist: raw.artist || "Unknown Artist",
      tracks,
    },
    ref,
  };
}

export function partPayloadUrl({
  songId,
  revisionId,
  image,
  partId,
  cdnBaseUrl = PRIMARY_CDN,
}: {
  songId: number;
  revisionId: number;
  image: string;
  partId: number;
  cdnBaseUrl?: string;
}): string {
  return `${cdnBaseUrl}/${songId}/${revisionId}/${image}/${partId}.json`;
}

async function fetchPartsFrom(
  meta: SongsterrRevisionMeta,
  cdnBaseUrl: string,
): Promise<FetchPartsResult & { failures: PartFetchFailure[] }> {
  const warnings: ConversionWarning[] = [];
  const failures: PartFetchFailure[] = [];

  const settled = await Promise.all(
    meta.tracks.map(async (trackMeta) => {
      const url = partPayloadUrl({
        songId: meta.songId,
        revisionId: meta.revisionId,
        image: meta.image,
        partId: trackMeta.partId,
        cdnBaseUrl,
      });

      try {
        const response = await songsterrFetch(url, { timeoutMs: PART_TIMEOUT_MS });
        if (!response.ok) {
          warnings.push({
            code: "part_fetch_failed",
            message: `Failed to fetch part ${trackMeta.partId} (${response.status}).`,
            location: `part:${trackMeta.partId}`,
          });
          failures.push({
            partId: trackMeta.partId,
            kind: "status",
            status: response.status,
          });
          return null;
        }

        const payload = (await response.json()) as SongsterrPartPayload;
        return { trackMeta, payload };
      } catch (err) {
        const timedOut = isTimeoutError(err);
        warnings.push({
          code: timedOut ? "part_fetch_timeout" : "part_fetch_error",
          message: timedOut
            ? `Timed out fetching part ${trackMeta.partId} after ${PART_TIMEOUT_MS}ms.`
            : `Error fetching part ${trackMeta.partId}: ${String(err)}`,
          location: `part:${trackMeta.partId}`,
        });
        failures.push({
          partId: trackMeta.partId,
          kind: timedOut ? "timeout" : "error",
        });
        return null;
      }
    }),
  );

  return {
    parts: settled.filter((part): part is SongsterrPart => part !== null),
    warnings,
    failures,
  };
}

/** Fetch every track's payload, retrying on the alternate CDN when it can help. */
export async function fetchRevisionParts(
  meta: SongsterrRevisionMeta,
): Promise<FetchPartsResult> {
  const primary = await fetchPartsFrom(meta, PRIMARY_CDN);
  if (primary.parts.length > 0) {
    return { parts: primary.parts, warnings: primary.warnings };
  }

  // Only worth a second fan-out when the primary CDN actually answered. If the
  // parts timed out, retrying spends another full round of the request budget
  // on a path that is already not responding.
  const everyFailureWasAStatus =
    primary.failures.length > 0 &&
    primary.failures.every((failure) => failure.kind === "status");

  if (!everyFailureWasAStatus) {
    throw new SongsterrError(
      "UPSTREAM_FAILED",
      "Songsterr's tab server did not respond.",
      primary.warnings[0]?.message,
    );
  }

  const fallback = await fetchPartsFrom(meta, FALLBACK_CDN);
  if (fallback.parts.length === 0) {
    throw new SongsterrError(
      "NOT_FOUND",
      "Songsterr has no tab data for that revision.",
      fallback.warnings[0]?.message,
    );
  }

  return {
    parts: fallback.parts,
    warnings: [...primary.warnings, ...fallback.warnings],
  };
}
