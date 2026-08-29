"use client";

import { useEffect, useRef } from "react";
import type { SyncPoint } from "@/features/library/data/songStore";

/**
 * Couples an imported mp3 to alphaTab using `PlayerMode.EnabledExternalMedia`:
 * the `<audio>` element is the time source and alphaTab's cursor is driven by it,
 * so playback can't drift. alphaTab calls back into our handler to control the
 * media (play / pause / seek / rate / volume); we pump the media's current time
 * into alphaTab every animation frame while playing.
 *
 * Deliberately framework-free and untyped against alphaTab (all access via
 * `getApi()`), so `AlphaTabPlayer` stays readable and this file has no import of
 * the alphaTab module.
 */

interface BackingSyncDeps {
  getAudio: () => HTMLAudioElement | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getApi: () => any;
  /** Live read so calibration nudges take effect immediately. */
  getOffsetMs: () => number;
  /** Extra tempo-drift points beyond the bar-0 offset point. */
  getExtraSyncPoints: () => SyncPoint[];
}

export class BackingMediaSync {
  private deps: BackingSyncDeps;
  private attached = false;
  private rafId: number | null = null;
  private playing = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private output: any = null;
  private onTimeUpdate = () => this.pushPosition();

  constructor(deps: BackingSyncDeps) {
    this.deps = deps;
  }

  /** Wire our media handler into alphaTab's external-media output. Idempotent. */
  attach(): boolean {
    if (this.attached) return true;
    const api = this.deps.getApi();
    const output = api?.player?.output;
    if (!output) return false;

    output.handler = this.buildHandler();
    this.output = output;
    this.attached = true;

    const audio = this.deps.getAudio();
    audio?.addEventListener("timeupdate", this.onTimeUpdate);
    audio?.addEventListener("seeked", this.onTimeUpdate);

    this.applyOffset();
    // Prime alphaTab with the current media position.
    this.pushPosition();
    return true;
  }

  detach(): void {
    this.stopPump();
    const audio = this.deps.getAudio();
    audio?.removeEventListener("timeupdate", this.onTimeUpdate);
    audio?.removeEventListener("seeked", this.onTimeUpdate);
    if (this.output) {
      try {
        this.output.handler = undefined;
      } catch {
        /* noop */
      }
    }
    this.output = null;
    this.attached = false;
  }

  dispose(): void {
    this.detach();
  }

  /** Called from `playerStateChanged`: run the position pump only while playing. */
  onStateChanged(playing: boolean): void {
    this.playing = playing;
    if (playing) this.startPump();
    else this.stopPump();
  }

  /**
   * Rebuild alphaTab's sync points from the current offset. A single point at
   * bar 0 also linearly time-fits the whole tab across `[offsetMs, audioDuration]`,
   * which absorbs a constant tempo difference between the GP file and the record.
   */
  applyOffset(): void {
    const api = this.deps.getApi();
    const score = api?.score;
    if (!score?.applyFlatSyncPoints) return;

    const base: SyncPoint = {
      barIndex: 0,
      barPosition: 0,
      barOccurence: 0,
      millisecondOffset: Math.round(this.deps.getOffsetMs()),
    };
    const extra = this.deps
      .getExtraSyncPoints()
      .filter((p) => !(p.barIndex === 0 && p.barPosition === 0));

    try {
      score.applyFlatSyncPoints([base, ...extra]);
      api.updateSyncPoints();
    } catch (err) {
      console.error("[backingSync] applyOffset failed", err);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildHandler(): any {
    const getAudio = this.deps.getAudio;
    return {
      get backingTrackDuration(): number {
        const a = getAudio();
        return a && Number.isFinite(a.duration) ? a.duration * 1000 : 0;
      },
      get playbackRate(): number {
        return getAudio()?.playbackRate ?? 1;
      },
      set playbackRate(value: number) {
        const a = getAudio();
        if (!a) return;
        a.playbackRate = value;
        setPreservesPitch(a);
      },
      get masterVolume(): number {
        return getAudio()?.volume ?? 1;
      },
      set masterVolume(value: number) {
        const a = getAudio();
        if (a) a.volume = Math.max(0, Math.min(1, value));
      },
      seekTo(timeMs: number) {
        const a = getAudio();
        if (a && a.readyState >= 1) {
          a.currentTime = Math.max(0, timeMs / 1000);
        }
      },
      play() {
        const a = getAudio();
        if (!a) return;
        void playWithRetry(a);
      },
      pause() {
        getAudio()?.pause();
      },
    };
  }

  private startPump(): void {
    if (this.rafId != null) return;
    const tick = () => {
      this.pushPosition();
      this.rafId = this.playing ? requestAnimationFrame(tick) : null;
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopPump(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private pushPosition(): void {
    const audio = this.deps.getAudio();
    if (!this.output || !audio) return;
    this.output.updatePosition(audio.currentTime * 1000);
  }
}

/** Set `preservesPitch` (+ vendor prefixes) so speed changes don't transpose. */
export function setPreservesPitch(audio: HTMLAudioElement): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = audio as any;
  a.preservesPitch = true;
  a.mozPreservesPitch = true;
  a.webkitPreservesPitch = true;
}

/** `audio.play()` that survives autoplay/not-ready rejections with one retry. */
export function playWithRetry(audio: HTMLAudioElement): Promise<void> {
  return audio.play().catch(() => {
    return new Promise<void>((resolve) => {
      const retry = () => {
        audio.removeEventListener("canplay", retry);
        setTimeout(() => {
          audio.play().catch(() => {});
          resolve();
        }, 120);
      };
      audio.addEventListener("canplay", retry, { once: true });
    });
  });
}

// --- React binding -------------------------------------------------------------

interface UseBackingSyncArgs {
  songId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiRef: React.MutableRefObject<any>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  offsetMs: number;
  extraSyncPoints: SyncPoint[];
  playerReady: boolean;
  audioMetaReady: boolean;
}

/**
 * Owns a `BackingMediaSync` for the current song. `attach()` runs once both the
 * alphaTab player and the audio metadata are ready; `applyOffset()` re-runs when
 * the calibration offset changes.
 */
export function useBackingSync({
  songId,
  apiRef,
  audioRef,
  offsetMs,
  extraSyncPoints,
  playerReady,
  audioMetaReady,
}: UseBackingSyncArgs) {
  const controllerRef = useRef<BackingMediaSync | null>(null);
  const offsetRef = useRef(offsetMs);
  const extraRef = useRef(extraSyncPoints);
  offsetRef.current = offsetMs;
  extraRef.current = extraSyncPoints;

  // One controller per song.
  useEffect(() => {
    const controller = new BackingMediaSync({
      getAudio: () => audioRef.current,
      getApi: () => apiRef.current,
      getOffsetMs: () => offsetRef.current,
      getExtraSyncPoints: () => extraRef.current,
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  // Attach once alphaTab + audio metadata are both ready.
  useEffect(() => {
    if (!playerReady || !audioMetaReady) return;
    const controller = controllerRef.current;
    if (!controller) return;
    if (!controller.attach()) {
      // player.output not up yet — retry on the next frame a few times.
      let tries = 0;
      const id = setInterval(() => {
        if (controller.attach() || ++tries > 30) clearInterval(id);
      }, 100);
      return () => clearInterval(id);
    }
  }, [playerReady, audioMetaReady, songId]);

  // Re-apply sync points when the calibration offset changes.
  useEffect(() => {
    if (playerReady && audioMetaReady) controllerRef.current?.applyOffset();
  }, [offsetMs, extraSyncPoints, playerReady, audioMetaReady]);

  return {
    controllerRef,
    onStateChanged: (playing: boolean) =>
      controllerRef.current?.onStateChanged(playing),
    applyOffset: () => controllerRef.current?.applyOffset(),
  };
}
