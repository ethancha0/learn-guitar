/**
 * Playback-related types for the player screen. These describe the shape the
 * future Web Audio + alphaTab layer will drive; nothing here is wired to real
 * audio yet.
 */
export interface PlaybackState {
  isPlaying: boolean;
  /** Current playhead position in seconds. */
  positionSec: number;
  /** 0.25–2.0 multiplier applied to tempo. */
  speed: number;
  /** Loop region in seconds, or null when looping is off. */
  loop: { startSec: number; endSec: number } | null;
  metronome: boolean;
}

export const defaultPlaybackState: PlaybackState = {
  isPlaying: false,
  positionSec: 0,
  speed: 1,
  loop: null,
  metronome: false,
};

export interface GradeSummary {
  /** 0–100 accuracy score for the last attempt. */
  accuracy: number;
  notesHit: number;
  notesTotal: number;
  /** Longest consecutive streak of correct notes. */
  bestStreak: number;
}
