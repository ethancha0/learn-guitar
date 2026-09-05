/**
 * The invented content the reel plays back.
 *
 * None of it touches the song store or the network: the clip has to look the
 * same on a cold machine with an empty library, and it is a rendering of the
 * product rather than a recording of one session.
 */

export const REEL_QUERY = "hotel california";

export interface ReelResult {
  title: string;
  artist: string;
  duration: string;
  /** Songsterr carries the tab; YouTube carries the recording. */
  hasTab: boolean;
  hasAudio: boolean;
}

export const REEL_RESULTS: readonly ReelResult[] = [
  {
    title: "Hotel California",
    artist: "The Eagles",
    duration: "4:56",
    hasTab: true,
    hasAudio: true,
  },
  {
    title: "Hotel California (Live)",
    artist: "The Eagles",
    duration: "5:31",
    hasTab: true,
    hasAudio: false,
  },
  {
    title: "California",
    artist: "Beabadoobee",
    duration: "3:18",
    hasTab: true,
    hasAudio: true,
  },
];

/** The entry the reel opens in the player — the first hit, once it is picked. */
export const REEL_SONG = {
  title: "Hotel California",
  artist: "Eagles",
  tempo: "148",
  metre: "4/4",
  tuning: "EADGBE",
  durationSec: 296,
  /** Where in the song the reel picks the playback up. */
  startSec: 72,
};

/* --------------------------------------------------------------- score --- */

export interface ReelNote {
  /** 0 is the top line of the tab staff, 5 the bottom. */
  string: number;
  /** Distance across the staff, in percent of its width. */
  xPct: number;
  fret: number;
}

/** Six strings, so the staff reads as guitar tab rather than a stave. */
export const REEL_STRING_COUNT = 6;

/**
 * The four bars on screen, as `[startPct, endPct]` spans. The wash that
 * follows the playhead is drawn one rectangle per bar, and the barlines are
 * the seams between them.
 */
export const REEL_BARS_PCT: readonly (readonly [number, number])[] = [
  [4, 27],
  [27, 50.5],
  [50.5, 74],
  [74, 96],
];

/** Four bars of a riff — enough to fill the staff and read as real tab. */
export const REEL_NOTES: readonly ReelNote[] = [
  { string: 5, xPct: 7.5, fret: 0 },
  { string: 5, xPct: 13, fret: 3 },
  { string: 4, xPct: 18.5, fret: 2 },
  { string: 5, xPct: 23, fret: 0 },

  { string: 5, xPct: 30.5, fret: 3 },
  { string: 4, xPct: 36, fret: 0 },
  { string: 4, xPct: 41.5, fret: 2 },
  { string: 3, xPct: 46.5, fret: 0 },

  { string: 5, xPct: 54, fret: 5 },
  { string: 4, xPct: 59.5, fret: 7 },
  { string: 3, xPct: 65, fret: 5 },
  { string: 4, xPct: 70, fret: 7 },

  { string: 4, xPct: 77.5, fret: 2 },
  { string: 3, xPct: 83, fret: 2 },
  { string: 4, xPct: 88.5, fret: 0 },
  { string: 5, xPct: 93, fret: 3 },
];

/* --------------------------------------------------------------- mixer --- */

export interface ReelChannel {
  name: string;
  /** Fader positions, 0–100, before and after the mix step moves them. */
  from: number;
  to: number;
}

export const REEL_CHANNELS: readonly ReelChannel[] = [
  { name: "Backing track", from: 78, to: 34 },
  { name: "Synth · Guitar", from: 42, to: 88 },
];

/** The speed the mix step pulls the transport down to, as a percentage. */
export const REEL_SPEED_FROM_PCT = 100;
export const REEL_SPEED_TO_PCT = 75;
