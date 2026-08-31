import { getSongsterrJson } from "./http";
import {
  SONGSTERR_ORIGIN,
  SongsterrError,
  type SongsterrSong,
  type SongsterrTrack,
  type SongsterrTrackFamily,
} from "./types";
import { parseSongsterrUrl, type SongsterrRef } from "./url";

const MAX_QUERY_LENGTH = 200;
const MAX_LINKED_VIDEOS = 8;

interface RawTrack {
  instrumentId?: number;
  instrument?: string;
  name?: string;
  tuning?: number[];
  difficulty?: number;
  views?: number;
}

interface RawSong {
  songId?: number;
  artistId?: number;
  artist?: string;
  title?: string;
  revisionId?: number;
  tracks?: RawTrack[];
  defaultTrack?: number;
  popularTrack?: number;
  popularTrackGuitar?: number;
  popularTrackBass?: number;
  popularTrackDrum?: number;
  tags?: string[];
  videos?: Array<{ videoId?: string; status?: string }>;
}

/**
 * Songsterr reuses General MIDI program numbers, so the family is derived from
 * the GM ranges rather than the display name (which is often the *sampled*
 * instrument — vocal tracks come through as saxophones, for example).
 */
function trackFamily(instrumentId: number | undefined, name: string): SongsterrTrackFamily {
  if (instrumentId === undefined) return "other";
  if (instrumentId >= 1024) return "drums";
  // Songsterr labels vocal tracks with sax programs; the track name is the tell.
  if (/\bvocal|\bvox\b/i.test(name)) return "vocals";
  if (instrumentId >= 32 && instrumentId <= 39) return "bass";
  if (instrumentId >= 24 && instrumentId <= 31) return "guitar";
  return "other";
}

/** A ref without a pinned revision resolves to whatever Songsterr serves today. */
export function metaPath(ref: SongsterrRef): string {
  return ref.revisionId
    ? `/api/meta/${ref.songId}/${ref.revisionId}`
    : `/api/meta/${ref.songId}`;
}

export function songsterrSongUrl(songId: number, trackIndex?: number): string {
  const suffix = trackIndex === undefined ? "" : `t${trackIndex}`;
  return `${SONGSTERR_ORIGIN}/a/wa/song?id=${songId}${suffix ? `&track=${trackIndex}` : ""}`;
}

function toTrack(raw: RawTrack, index: number): SongsterrTrack {
  const name = raw.name?.trim() || raw.instrument || `Track ${index + 1}`;
  return {
    index,
    name,
    instrument: raw.instrument ?? "Unknown",
    instrumentId: raw.instrumentId ?? -1,
    family: trackFamily(raw.instrumentId, name),
    tuning: Array.isArray(raw.tuning) && raw.tuning.length ? raw.tuning : undefined,
    difficulty: typeof raw.difficulty === "number" ? raw.difficulty : undefined,
    views: Number(raw.views) || 0,
  };
}

function toSong(raw: RawSong): SongsterrSong | null {
  if (!raw.songId || !raw.title) return null;
  return {
    songId: raw.songId,
    title: raw.title,
    artist: raw.artist ?? "Unknown artist",
    artistId: raw.artistId,
    revisionId: raw.revisionId,
    tracks: (raw.tracks ?? []).map(toTrack),
    defaultTrack: raw.defaultTrack,
    popularTrack: raw.popularTrack,
    popularTrackGuitar: raw.popularTrackGuitar,
    popularTrackBass: raw.popularTrackBass,
    popularTrackDrum: raw.popularTrackDrum,
    tags: raw.tags,
    // Songsterr links dozens of covers/lessons per song, with repeats; the
    // first few unique ones are the useful bridge to the YouTube audio import.
    videoIds: raw.videos
      ? Array.from(
          new Set(
            raw.videos
              .filter((video) => video.videoId && video.status === "done")
              .map((video) => video.videoId as string),
          ),
        ).slice(0, MAX_LINKED_VIDEOS)
      : undefined,
    url: songsterrSongUrl(raw.songId),
  };
}

/** Search Songsterr's public catalogue for songs matching a free-text query. */
export async function searchSongsterr(
  query: string,
  options: { maxResults?: number } = {},
): Promise<SongsterrSong[]> {
  const q = query.trim();
  if (!q) {
    throw new SongsterrError("VALIDATION", "Search query is required.");
  }
  if (q.length > MAX_QUERY_LENGTH) {
    throw new SongsterrError(
      "VALIDATION",
      `Search query must be ${MAX_QUERY_LENGTH} characters or fewer.`,
    );
  }

  const size = Math.min(Math.max(options.maxResults ?? 10, 1), 25);
  const raw = await getSongsterrJson<RawSong[]>(
    `/api/songs?pattern=${encodeURIComponent(q)}&size=${size}`,
  );

  return (Array.isArray(raw) ? raw : [])
    .map(toSong)
    .filter((song): song is SongsterrSong => Boolean(song))
    .slice(0, size);
}

/** Resolve a Songsterr link or song ID to its current revision + track list. */
export async function resolveSongsterrSong(
  input: string,
): Promise<{ song: SongsterrSong; ref: SongsterrRef }> {
  const ref = parseSongsterrUrl(input);
  const song = toSong(await getSongsterrJson<RawSong>(metaPath(ref)));
  if (!song) {
    throw new SongsterrError("NOT_FOUND", "Songsterr returned no song for that link.");
  }

  return { song, ref };
}

/**
 * Pick the track a bass-learning import should default to: an explicit track in
 * the link wins, then Songsterr's own popular-bass ranking, then the first bass
 * track, then whatever Songsterr defaults to.
 */
export function pickBassTrack(song: SongsterrSong, ref?: SongsterrRef): SongsterrTrack | undefined {
  const byIndex = (index?: number) =>
    index === undefined ? undefined : song.tracks.find((track) => track.index === index);

  return (
    byIndex(ref?.trackIndex) ??
    byIndex(song.popularTrackBass) ??
    song.tracks.find((track) => track.family === "bass") ??
    byIndex(song.defaultTrack) ??
    song.tracks[0]
  );
}
