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

    const accent = accentIndices?.has(i) ?? false;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = accent ? 1600 : 1000;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(accent ? 1 : 0.6, when + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    osc.connect(env).connect(gain);
    osc.start(when);
    osc.stop(when + 0.06);
    nodes.push(osc);
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
