/** Public Songsterr metadata. No tablature content is fetched or stored. */

export const SONGSTERR_ORIGIN = "https://www.songsterr.com";

/** Songsterr's `instrumentId` buckets, coarse enough to pick a track by family. */
export type SongsterrTrackFamily = "guitar" | "bass" | "drums" | "vocals" | "other";

export interface SongsterrTrack {
  /** Index into the revision's track list — this is the `t` in a Songsterr URL. */
  index: number;
  name: string;
  instrument: string;
  instrumentId: number;
  family: SongsterrTrackFamily;
  /** MIDI note numbers, high string first; absent for drum tracks. */
  tuning?: number[];
  /** Songsterr's 1-5 scale; absent when the tab has not been rated. */
  difficulty?: number;
  views: number;
}

export interface SongsterrSong {
  songId: number;
  title: string;
  artist: string;
  artistId?: number;
  /** Present on `/api/meta` lookups; absent on search hits. */
  revisionId?: number;
  tracks: SongsterrTrack[];
  /** Index of the track Songsterr defaults to. */
  defaultTrack?: number;
  /** Best track per family, by Songsterr's own popularity ranking. */
  popularTrack?: number;
  popularTrackGuitar?: number;
  popularTrackBass?: number;
  popularTrackDrum?: number;
  tags?: string[];
  /** YouTube video IDs Songsterr has linked to this song. */
  videoIds?: string[];
  url: string;
}

export type SongsterrErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "UPSTREAM_FAILED";

export class SongsterrError extends Error {
  constructor(
    readonly code: SongsterrErrorCode,
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = "SongsterrError";
  }
}

/** Compact Songsterr reference persisted alongside an imported song. */
export interface SongsterrSource {
  songId: number;
  revisionId?: number;
  /** Track the import was matched to, when one was picked. */
  trackIndex?: number;
  trackName?: string;
  title: string;
  artist: string;
  tuning?: number[];
  url: string;
}
