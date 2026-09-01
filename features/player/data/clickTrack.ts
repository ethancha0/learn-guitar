"use client";

/**
 * Schedules short click bursts on a Web Audio graph at given recording-time
 * positions. Used by the sync-debug page's "click overlay": if the map is right,
 * clicks land exactly on the recording's beats.
 */

export interface ClickScheduleOptions {
  /** Recording-time positions of the clicks, seconds. */
  timesSec: number[];
  /** Indices in `timesSec` that are bar downbeats (accented). */
  accentIndices?: Set<number>;
  /** `ctx.currentTime` that corresponds to recording time `originSec`. */
  ctxTimeAtOrigin: number;
  originSec: number;
  playbackRate: number;
  volume: number;
  destination: AudioNode;
}

/** One-shot scheduler; call again after a seek. Returns a cancel function. */
export function scheduleClicks(
  ctx: AudioContext,
  opts: ClickScheduleOptions,
): () => void {
  const { timesSec, accentIndices, ctxTimeAtOrigin, originSec, playbackRate } =
    opts;
  const gain = ctx.createGain();
  gain.gain.value = opts.volume;
  gain.connect(opts.destination);

  const nodes: AudioScheduledSourceNode[] = [];
  const now = ctx.currentTime;

  timesSec.forEach((t, i) => {
    const when = ctxTimeAtOrigin + (t - originSec) / playbackRate;
    if (when < now - 0.02) return; // already passed
    nodes.push(scheduleClick(ctx, when, accentIndices?.has(i) ?? false, gain));
  });

  return () => {
    for (const n of nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    try {
      gain.disconnect();
    } catch {
      /* noop */
    }
  };
}

/** One metronome tick at `when` (context time). Accents are higher and louder. */
export function scheduleClick(
  ctx: BaseAudioContext,
  when: number,
  accent: boolean,
  destination: AudioNode,
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.value = accent ? 1600 : 1000;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(accent ? 1 : 0.6, when + 0.001);
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
  osc.connect(env).connect(destination);
  osc.start(when);
  osc.stop(when + 0.06);
  return osc;
}

/**
 * Play a count-in and report when it is over.
 *
 * The finish is signalled by a silent node ending on the audio clock rather
 * than by a timer or an animation frame: both of those stop firing in a
 * background tab, which would leave the clicks playing on time and the song
 * starting seconds late (or never). `onComplete` runs once; cancelling
 * suppresses it.
 */
export function playCountIn(
  ctx: AudioContext,
  clicks: readonly { leadSec: number; accent: boolean }[],
  opts: { volume?: number; destination?: AudioNode; onComplete: () => void },
): () => void {
  const gain = ctx.createGain();
  gain.gain.value = opts.volume ?? 0.7;
  gain.connect(opts.destination ?? ctx.destination);

  // A short lead so the first click isn't scheduled in the past on a context
  // that has just been resumed.
  const startsAt = ctx.currentTime + 0.08;
  const endsAt = startsAt + (clicks[0]?.leadSec ?? 0);
  const nodes = clicks.map((c) =>
    scheduleClick(ctx, endsAt - c.leadSec, c.accent, gain),
  );

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    cleanup();
    opts.onComplete();
  };

  // Silent, disconnected from the graph: it exists only for its `ended` event.
  const marker = ctx.createConstantSource();
  marker.offset.value = 0;
  marker.onended = finish;
  marker.start(startsAt);
  marker.stop(endsAt);

  function cleanup() {
    try {
      gain.disconnect();
    } catch {
      /* noop */
    }
  }

  return () => {
    if (done) return;
    done = true;
    marker.onended = null;
    try {
      marker.stop();
    } catch {
      /* already stopped */
    }
    for (const n of nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    cleanup();
  };
}
