"use client";

/**
 * Count-in: a bar of metronome clicks before playback starts, so you can join
 * in on beat 1 instead of guessing where the recording is.
 *
 * alphaTab has a built-in count-in (`api.countInVolume`) but it is unusable
 * here: it renders the clicks through alphaTab's own synthesizer, which is
 * silent in `EnabledExternalMedia` mode, and it starts the external media
 * immediately anyway. So the clicks are scheduled on our own Web Audio graph
 * and playback is started when the count-in has run out.
 *
 * The click *tempo* comes from the recording, not the score: the beats leading
 * into the start point are mapped through the sync map, so a count-in into a
 * song that was recorded slightly slow counts at the speed you are about to
 * hear. See `buildCountInPlan`.
 */

/** One count-in click, positioned relative to the moment playback starts. */
export interface CountInClick {
  /** Seconds *before* playback starts that this click sounds. */
  leadSec: number;
  /** Bar downbeats are accented, like a metronome's "1". */
  accent: boolean;
}

export interface CountInPlan {
  clicks: CountInClick[];
  /** Wall-clock length of the whole count-in, seconds. */
  durationSec: number;
}

export interface CountInPlanInput {
  /** Score-time of every beat in the song, seconds (`BarTimeline.beatSec`). */
  beatSec: readonly number[];
  /** Score-time of every bar start, seconds — used to accent downbeats. */
  barStartSec?: readonly number[];
  /** Where playback is about to start, in score time (seconds). */
  startScoreSec: number;
  /** Number of clicks, normally the time-signature numerator of the start bar. */
  beats: number;
  /** Score time → recording time. Identity when there is no recording. */
  toAudioTime?: (scoreSec: number) => number;
  /** `<audio>.playbackRate`; a half-speed count-in must count at half speed. */
  playbackRate?: number;
}

/** Beats closer together than this are treated as the same beat. */
const EPS = 1e-3;
/** A count-in longer than this is a sign of a broken tempo/sync map. */
const MAX_COUNT_IN_SEC = 12;

/**
 * Pick the `beats` beats that lead into `startScoreSec` and turn them into
 * lead times.
 *
 * Beats before the start of the song don't exist in the grid, so near bar 1 the
 * missing ones are extrapolated backwards at the tempo of the first real beat —
 * which is the case that matters most, since a count-in is normally used from
 * the top.
 */
export function buildCountInPlan({
  beatSec,
  barStartSec,
  startScoreSec,
  beats,
  toAudioTime = (t) => t,
  playbackRate = 1,
}: CountInPlanInput): CountInPlan | null {
  const count = Math.max(1, Math.min(16, Math.round(beats)));
  const rate = playbackRate > 0 ? playbackRate : 1;
  if (!beatSec.length) return null;

  // Beats strictly before the start point, nearest first.
  const earlier: number[] = [];
  for (let i = beatSec.length - 1; i >= 0 && earlier.length < count; i--) {
    if (beatSec[i] < startScoreSec - EPS) earlier.push(beatSec[i]);
  }

  // Fill from before the score with the spacing we do know.
  const spacing =
    earlier.length >= 2
      ? earlier[0] - earlier[1]
      : beatSec.length >= 2
        ? beatSec[1] - beatSec[0]
        : 0;
  if (earlier.length < count && spacing <= 0) return null;
  let previous = earlier.length ? earlier[earlier.length - 1] : startScoreSec;
  while (earlier.length < count) {
    previous -= spacing;
    earlier.push(previous);
  }

  // Back to chronological order.
  const scoreTimes = earlier.reverse();
  const downbeats = new Set((barStartSec ?? []).map((t) => t.toFixed(3)));

  const startAudio = toAudioTime(startScoreSec);
  const clicks: CountInClick[] = [];
  for (const t of scoreTimes) {
    // Extrapolated beats sit before the score, where the sync map is only
    // defined by its first segment; measuring the gap in score time and
    // converting it with the local slope keeps them evenly spaced.
    const audio =
      t >= beatSec[0] - EPS
        ? toAudioTime(t)
        : startAudio - (startScoreSec - t) * localSlope(toAudioTime, beatSec);
    const leadSec = (startAudio - audio) / rate;
    if (!Number.isFinite(leadSec) || leadSec <= 0) continue;
    clicks.push({
      leadSec,
      accent: downbeats.has(t.toFixed(3)),
    });
  }
  if (!clicks.length) return null;

  const durationSec = clicks[0].leadSec;
  if (durationSec > MAX_COUNT_IN_SEC) return null;
  // With no downbeat in range (a start mid-bar), the first click stands in for
  // it so the count still has an audible "1".
  if (!clicks.some((c) => c.accent)) clicks[0].accent = true;
  return { clicks, durationSec };
}

/** Recording-seconds per score-second at the top of the song. */
function localSlope(
  toAudioTime: (t: number) => number,
  beatSec: readonly number[],
): number {
  if (beatSec.length < 2) return 1;
  const span = beatSec[1] - beatSec[0];
  if (span <= 0) return 1;
  const slope = (toAudioTime(beatSec[1]) - toAudioTime(beatSec[0])) / span;
  return Number.isFinite(slope) && slope > 0 ? slope : 1;
}
