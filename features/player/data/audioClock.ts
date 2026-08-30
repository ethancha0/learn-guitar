"use client";

/**
 * High-resolution audio position clock for gameplay timing.
 *
 * alphaTab's cursor updates on an animation-frame cadence and its reported
 * position is fine for the *visual* tab. Note scoring needs a tighter,
 * monotically-advancing musical clock, so this reads `AudioContext.currentTime`
 * (sample-accurate) and only uses `<audio>.currentTime` as the anchor that gets
 * re-synced on seek / rate change / play / pause.
 *
 * It is intentionally decoupled from `useBackingSync`: give it the same
 * `<audio>` element and a `SyncMap`, and it answers "what score time are we at,
 * right now, to the millisecond" without going through alphaTab at all.
 */

import type { SyncMap } from "./syncMap";

interface Anchor {
  /** `<audio>.currentTime` (seconds) captured at `ctxTime`. */
  mediaTime: number;
  /** `AudioContext.currentTime` (seconds) at capture. */
  ctxTime: number;
  rate: number;
  running: boolean;
}

/** Pure: project the anchored media time forward by the elapsed context time. */
export function projectMediaTime(
  anchor: Anchor,
  ctxNow: number,
): number {
  if (!anchor.running) return anchor.mediaTime;
  const elapsed = Math.max(0, ctxNow - anchor.ctxTime);
  return anchor.mediaTime + elapsed * anchor.rate;
}

export class AudioClock {
  private ctx: AudioContext;
  private el: HTMLAudioElement;
  private anchor: Anchor;
  private gain: GainNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private readonly onSync = () => this.resync();

  constructor(
    el: HTMLAudioElement,
    opts: { webAudio?: boolean; context?: AudioContext } = {},
  ) {
    this.el = el;
    this.ctx =
      opts.context ??
      new (window.AudioContext ??
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitAudioContext)();

    if (opts.webAudio) {
      // Routing the element through the graph makes the clock rock-solid and
      // gives future scoring a place to hang analysers. Volume then belongs on
      // `this.gain` rather than `el.volume`.
      try {
        this.source = this.ctx.createMediaElementSource(el);
        this.gain = this.ctx.createGain();
        this.source.connect(this.gain).connect(this.ctx.destination);
      } catch {
        this.source = null;
        this.gain = null;
      }
    }

    this.anchor = {
      mediaTime: el.currentTime,
      ctxTime: this.ctx.currentTime,
      rate: el.playbackRate,
      running: !el.paused,
    };

    for (const ev of ["seeked", "ratechange", "play", "playing", "pause"]) {
      el.addEventListener(ev, this.onSync);
    }
  }

  /** Re-anchor to the element's authoritative state. Called on transport events. */
  resync(): void {
    void this.ctx.resume();
    this.anchor = {
      mediaTime: this.el.currentTime,
      ctxTime: this.ctx.currentTime,
      rate: this.el.playbackRate,
      running: !this.el.paused,
    };
  }

  /** Best estimate of the recording position right now, in seconds. */
  now(): number {
    const projected = projectMediaTime(this.anchor, this.ctx.currentTime);
    // Never run past what the element reports it has actually played, and never
    // move backward between resyncs.
    const cap = this.el.currentTime + 0.05 * this.anchor.rate + 0.25;
    return Math.max(this.anchor.mediaTime, Math.min(projected, cap));
  }

  /** Score time right now, via the mapping. Monotone as long as `map` is. */
  scoreNow(map: SyncMap): number {
    return map.audioTimeToScoreTime(this.now());
  }

  /** When (recording seconds) a given score position is expected to sound. */
  expectedAudioTime(scoreTime: number, map: SyncMap): number {
    return map.scoreTimeToAudioTime(scoreTime);
  }

  get gainNode(): GainNode | null {
    return this.gain;
  }
  get audioContext(): AudioContext {
    return this.ctx;
  }

  dispose(): void {
    for (const ev of ["seeked", "ratechange", "play", "playing", "pause"]) {
      this.el.removeEventListener(ev, this.onSync);
    }
    try {
      this.source?.disconnect();
      this.gain?.disconnect();
    } catch {
      /* noop */
    }
  }
}
