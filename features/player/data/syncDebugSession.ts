"use client";

import { scheduleClicks } from "./clickTrack";

/**
 * Audio playback for the sync-debug page. Plays the decoded recording through an
 * `AudioBufferSourceNode` (sample-accurate position from `AudioContext.currentTime`,
 * and no dependence on the `<audio>` element) and schedules the click overlay on
 * the same graph so click vs recording can be judged by ear.
 */
export class SyncDebugSession {
  readonly ctx: AudioContext;
  readonly buffer: AudioBuffer;
  private readonly master: GainNode;
  private readonly clickBus: GainNode;

  private source: AudioBufferSourceNode | null = null;
  private startCtxTime = 0;
  private startOffsetSec = 0;
  private rate = 1;
  private clickVol = 0.5;
  private cancelClicks: (() => void) | null = null;
  private clickTimes: number[] = [];
  private clickAccents: Set<number> = new Set();
  private onEnd: (() => void) | null = null;

  playing = false;

  constructor(buffer: AudioBuffer, context?: AudioContext) {
    const Ctx: typeof AudioContext =
      window.AudioContext ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext;
    this.ctx = context ?? new Ctx();
    this.buffer = buffer;
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.clickBus = this.ctx.createGain();
    this.clickBus.gain.value = this.clickVol;
    this.clickBus.connect(this.ctx.destination);
  }

  get durationSec(): number {
    return this.buffer.duration;
  }

  positionSec(): number {
    if (!this.playing) return this.startOffsetSec;
    const pos =
      this.startOffsetSec + (this.ctx.currentTime - this.startCtxTime) * this.rate;
    return Math.max(0, Math.min(this.buffer.duration, pos));
  }

  setEndedCallback(cb: () => void): void {
    this.onEnd = cb;
  }

  async play(fromSec?: number): Promise<void> {
    await this.ctx.resume();
    if (this.playing) this.stopSource();
    if (fromSec != null) this.startOffsetSec = clamp(fromSec, 0, this.buffer.duration);

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(this.master);
    src.onended = () => {
      if (this.source === src && this.playing) {
        this.playing = false;
        this.startOffsetSec = this.buffer.duration;
        this.clearClicks();
        this.onEnd?.();
      }
    };
    src.start(0, this.startOffsetSec);
    this.source = src;
    this.startCtxTime = this.ctx.currentTime;
    this.playing = true;
    this.rescheduleClicks();
  }

  pause(): void {
    if (!this.playing) return;
    this.startOffsetSec = this.positionSec();
    this.stopSource();
    this.playing = false;
    this.clearClicks();
  }

  seek(sec: number): void {
    const target = clamp(sec, 0, this.buffer.duration);
    if (this.playing) {
      void this.play(target);
    } else {
      this.startOffsetSec = target;
    }
  }

  setRate(r: number): void {
    const wasPlaying = this.playing;
    const pos = this.positionSec();
    this.rate = r;
    if (wasPlaying) void this.play(pos);
  }

  setVolume(v: number): void {
    this.master.gain.value = clamp(v, 0, 1);
  }

  setClickVolume(v: number): void {
    this.clickVol = clamp(v, 0, 1);
    this.clickBus.gain.value = this.clickVol;
  }

  /** `times` are recording-time seconds; `accents` index into `times`. */
  setClicks(times: number[], accents: Set<number>): void {
    this.clickTimes = times;
    this.clickAccents = accents;
    this.rescheduleClicks();
  }

  clearClicks(): void {
    this.cancelClicks?.();
    this.cancelClicks = null;
  }

  private rescheduleClicks(): void {
    this.clearClicks();
    if (!this.playing || this.clickTimes.length === 0) return;
    this.cancelClicks = scheduleClicks(this.ctx, {
      timesSec: this.clickTimes,
      accentIndices: this.clickAccents,
      ctxTimeAtOrigin: this.startCtxTime,
      originSec: this.startOffsetSec,
      playbackRate: this.rate,
      volume: 1, // level handled by clickBus
      destination: this.clickBus,
    });
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  dispose(): void {
    this.clearClicks();
    this.stopSource();
    try {
      this.master.disconnect();
      this.clickBus.disconnect();
    } catch {
      /* noop */
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
