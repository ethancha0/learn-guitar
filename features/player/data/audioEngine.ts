"use client";

import { useEffect, useState } from "react";

/**
 * The player's Web Audio context, and the two iOS workarounds it needs.
 *
 * **Unlocking.** Every browser creates an `AudioContext` suspended and wants a
 * user gesture before it will make sound, but iOS is stricter than the rest:
 * `resume()` on its own can leave the context reporting `running` while the
 * hardware stays silent. What actually starts it is *playing something* from
 * inside the gesture, so `unlockAudio` pushes a one-sample silent buffer
 * through the context as well as resuming it. iOS also parks the context in
 * `interrupted` after a phone call or a screen lock, which no amount of
 * scheduling recovers from — hence the state listener and the re-unlock on the
 * next gesture.
 *
 * **Volume.** iOS ignores writes to `HTMLMediaElement.volume` (there, playback
 * level belongs to the hardware buttons), so the recording's volume and mute
 * controls do nothing on a phone. `mediaVolumeIsSettable` feature-tests for
 * that — no user-agent sniffing — and the player responds by routing the
 * `<audio>` element through this context, where a `GainNode` *is* honoured.
 */

let context: AudioContext | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** The shared context, created on first use (suspended until unlocked). */
export function getAudioContext(): AudioContext | null {
  if (context) return context;
  if (typeof window === "undefined") return null;
  const Ctx: typeof AudioContext =
    window.AudioContext ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).webkitAudioContext;
  if (!Ctx) return null;
  context = new Ctx();
  context.addEventListener?.("statechange", notify);
  return context;
}

/**
 * Start (or restart) the audio hardware. Must be called synchronously from a
 * real user gesture; safe to call on every gesture, and a no-op once running.
 *
 * Deliberately fire-and-forget: awaiting a blocked `resume()` never settles.
 */
export function unlockAudio(): AudioContext | null {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state === "running") return ctx;

  try {
    // The silent buffer is the part iOS actually reacts to. One frame is
    // enough — it just has to be a real source that starts inside the gesture.
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    /* an OfflineAudioContext in tests, or a context already closed */
  }

  try {
    // `resume()` REJECTS (not throws) when it is refused, so the promise has to
    // be handled or it surfaces as an unhandled rejection.
    const p = ctx.resume?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    /* already closed */
  }
  notify();
  return ctx;
}

/**
 * Whether this browser honours `HTMLMediaElement.volume`.
 *
 * iOS silently ignores the write, so the check is to set a value and read it
 * back. Measured once and cached: the answer is a property of the platform.
 */
let mediaVolumeSettable: boolean | null = null;

export function mediaVolumeIsSettable(): boolean {
  if (mediaVolumeSettable !== null) return mediaVolumeSettable;
  if (typeof document === "undefined") return true;
  // `?webaudio-volume=1` forces the iOS path on a desktop browser, which is the
  // only way to exercise it without a phone in hand.
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("webaudio-volume") === "1"
  ) {
    mediaVolumeSettable = false;
    return false;
  }
  try {
    const probe = document.createElement("audio");
    probe.volume = 0.5;
    mediaVolumeSettable = Math.abs(probe.volume - 0.5) < 1e-6;
  } catch {
    mediaVolumeSettable = false;
  }
  return mediaVolumeSettable;
}

/**
 * Route an `<audio>` element's output through the shared context so a
 * `GainNode` can set its level. Returns the gain node, or null when the
 * element can't be captured.
 *
 * One-way door: once an element has a `MediaElementAudioSourceNode` it *only*
 * plays through the graph, so a suspended context would mute the recording
 * outright. Callers must only do this once the context is running — see
 * `AlphaTabPlayer`.
 */
const captured = new WeakMap<HTMLMediaElement, GainNode>();

export function captureMediaElement(audio: HTMLMediaElement): GainNode | null {
  const existing = captured.get(audio);
  if (existing) return existing;
  const ctx = getAudioContext();
  if (!ctx?.createMediaElementSource) return null;
  try {
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);
    captured.set(audio, gain);
    return gain;
  } catch (err) {
    console.error("[audioEngine] could not capture the recording", err);
    return null;
  }
}

/** Live `AudioContext.state` for the diagnostics readout ("none" before use). */
export function useAudioContextState(): string {
  const [state, setState] = useState(() => context?.state ?? "none");
  useEffect(() => {
    const update = () => setState(getAudioContext()?.state ?? "none");
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return state;
}
