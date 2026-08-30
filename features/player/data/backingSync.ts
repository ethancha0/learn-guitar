"use client";

import { useEffect, useRef } from "react";
import type { SyncMap, AlphaTabFlatSyncPoint } from "./syncMap";

/**
 * Couples an imported mp3 to alphaTab using `PlayerMode.EnabledExternalMedia`:
 * the `<audio>` element is the time source and alphaTab's cursor is driven by it,
 * so playback can't drift. alphaTab calls back into our handler to control the
 * media (play / pause / seek / rate / volume); we pump the media's current time
 * into alphaTab every animation frame while playing.
 *
 * The score↔audio *mapping* lives in a `SyncMap`. It is pushed into alphaTab as
 * `FlatSyncPoint`s: a single bar-0 point for the offset strategy (alphaTab's
 * implicit end anchor then does the global linear fit), or the dense points the
 * offline DTW pipeline precomputed for a nonlinear mapping.
 *
 * Deliberately framework-free and untyped against alphaTab (all access via
 * `getApi()`), so `AlphaTabPlayer` stays readable.
 */

interface BackingSyncDeps {
  getAudio: () => HTMLAudioElement | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getApi: () => any;
  /** Canonical score↔audio mapping (always present). */
  getSyncMap: () => SyncMap | null;
  /** alphaTab points derived from the map by the caller. */
  getFlatSyncPoints: () => AlphaTabFlatSyncPoint[] | null;
  /**
   * Recording length in seconds that alphaTab should anchor its final segment
   * to. `<audio>.duration` is unreliable for VBR MP3s served from blob URLs
   * (Chrome over-reports from the bitrate header), and alphaTab divides by it,
   * so a decoded/known-good duration is passed in when available.
   */
  getTrustedAudioDurationSec: () => number | null;
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

    this.applySync();
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
   * Push the current mapping into alphaTab's sync-point model.
   *
   * The `SyncMap` is the single source of truth: points are derived from it here
   * rather than trusting a precomputed array, so the curve alphaTab follows is
   * provably the same one `AudioClock` / scoring use.
   */
  applySync(): AlphaTabFlatSyncPoint[] {
    const api = this.deps.getApi();
    const score = api?.score;
    if (!score?.applyFlatSyncPoints) return [];

    const points = this.deps.getFlatSyncPoints() ?? [];
    if (points.length === 0) return [];

    try {
      score.applyFlatSyncPoints(points);
      api.updateSyncPoints();
      this.appliedPoints = points;
    } catch (err) {
      console.error("[backingSync] applySync failed", err);
      return [];
    }
    return points;
  }

  /** What was last handed to alphaTab — for the diagnostics view. */
  appliedPoints: AlphaTabFlatSyncPoint[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildHandler(): any {
    const getAudio = this.deps.getAudio;
    const getTrusted = this.deps.getTrustedAudioDurationSec;
    return {
      get backingTrackDuration(): number {
        const trusted = getTrusted();
        if (trusted != null && Number.isFinite(trusted) && trusted > 0) {
          return trusted * 1000;
        }
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
  syncMap: SyncMap | null;
  flatSyncPoints: AlphaTabFlatSyncPoint[] | null;
  trustedAudioDurationSec: number | null;
  playerReady: boolean;
  audioMetaReady: boolean;
}

/**
 * Owns a `BackingMediaSync` for the current song. `attach()` runs once both the
 * alphaTab player and the audio metadata are ready; `applySync()` re-runs when
 * the mapping changes.
 */
export function useBackingSync({
  songId,
  apiRef,
  audioRef,
  syncMap,
  flatSyncPoints,
  trustedAudioDurationSec,
  playerReady,
  audioMetaReady,
}: UseBackingSyncArgs) {
  const controllerRef = useRef<BackingMediaSync | null>(null);
  const mapRef = useRef(syncMap);
  const flatRef = useRef(flatSyncPoints);
  const durRef = useRef(trustedAudioDurationSec);
  mapRef.current = syncMap;
  flatRef.current = flatSyncPoints;
  durRef.current = trustedAudioDurationSec;

  // One controller per song.
  useEffect(() => {
    const controller = new BackingMediaSync({
      getAudio: () => audioRef.current,
      getApi: () => apiRef.current,
      getSyncMap: () => mapRef.current,
      getFlatSyncPoints: () => flatRef.current,
      getTrustedAudioDurationSec: () => durRef.current,
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
      let tries = 0;
      const id = setInterval(() => {
        if (controller.attach() || ++tries > 30) clearInterval(id);
      }, 100);
      return () => clearInterval(id);
    }
  }, [playerReady, audioMetaReady, songId]);

  // Re-apply when the mapping changes.
  useEffect(() => {
    if (playerReady && audioMetaReady) controllerRef.current?.applySync();
  }, [syncMap, flatSyncPoints, trustedAudioDurationSec, playerReady, audioMetaReady]);

  return {
    controllerRef,
    onStateChanged: (playing: boolean) =>
      controllerRef.current?.onStateChanged(playing),
    applySync: () => controllerRef.current?.applySync(),
  };
}
