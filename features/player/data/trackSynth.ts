"use client";

/**
 * A small Web Audio synth that plays the notes of ONE score track in sync with
 * the original recording.
 *
 * Why not alphaTab's synthesizer? In `PlayerMode.EnabledExternalMedia` — which is
 * what keeps the cursor locked to the mp3 — alphaTab installs
 * `BackingTrackAudioSynthesizer`, whose synthesis methods are all no-ops. alphaTab
 * 1.8.4 has no mode that renders instruments *and* plays a backing track, so the
 * reference tone has to come from outside it.
 *
 * Sync comes for free: note positions are score times, mapped through the same
 * `SyncMap` the cursor uses, then scheduled against `AudioContext.currentTime`.
 * That makes the synth sample-accurate against the recording rather than
 * chasing it.
 */

import type { SyncMap } from "./syncMap";
import { getAudioContext, unlockAudio } from "./audioEngine";

export interface SynthNote {
  /** Onset on the score timeline, seconds. */
  scoreTime: number;
  /** Note length on the score timeline, seconds. */
  scoreDuration: number;
  /** MIDI pitch. */
  midi: number;
  /** 0..1 */
  velocity: number;
  /** Tab string, 1 = lowest-pitched (alphaTab's convention). Absent if unfretted. */
  string?: number;
  /** Fret number for `string`. */
  fret?: number;
}

export interface TrackTab {
  notes: SynthNote[];
  /** Number of strings in the track's tuning (6 guitar, 4 bass, …). */
  stringCount: number;
}

// --- extraction --------------------------------------------------------------

export interface TempoSegment {
  startTick: number;
  endTick: number;
  startSec: number;
  secPerTick: number;
}

export function buildTempoMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  masterBars: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  score: any,
  division: number,
): TempoSegment[] {
  const segments: TempoSegment[] = [];
  let sec = 0;
  // A bar with no tempo change keeps the tempo already in force; falling back to
  // the score's opening tempo would mistime every bar after a tempo change.
  let activeTempo = score.tempo;
  for (const b of masterBars) {
    const changes =
      b.tempoChanges && b.tempoChanges.length
        ? b.tempoChanges
        : [{ tick: b.start, tempo: activeTempo }];
    let segStart = b.start;
    for (let j = 0; j < changes.length; j++) {
      const segEnd = j + 1 < changes.length ? changes[j + 1].tick : b.end;
      const secPerTick = 60 / changes[j].tempo / division;
      segments.push({ startTick: segStart, endTick: segEnd, startSec: sec, secPerTick });
      sec += (segEnd - segStart) * secPerTick;
      segStart = segEnd;
      activeTempo = changes[j].tempo;
    }
  }
  return segments;
}

export function tickToSec(segments: TempoSegment[], tick: number): number {
  if (segments.length === 0) return 0;
  if (tick <= segments[0].startTick) return segments[0].startSec;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].startTick <= tick) lo = mid;
    else hi = mid - 1;
  }
  const s = segments[lo];
  return s.startSec + (tick - s.startTick) * s.secPerTick;
}

/**
 * Notes of one track, on the score timeline. Uses alphaTab's MIDI generator so
 * tick→time (including tempo changes) matches playback exactly.
 */
export async function extractTrackNotes(
  gpBytes: Uint8Array,
  trackIndex: number,
): Promise<SynthNote[]> {
  return (await extractTrackTab(gpBytes, trackIndex)).notes;
}

/** As {@link extractTrackNotes}, plus the tab geometry needed to draw a staff. */
export async function extractTrackTab(
  gpBytes: Uint8Array,
  trackIndex: number,
): Promise<TrackTab> {
  const alphaTab = await import("@coderline/alphatab");
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(gpBytes, settings);
  const midi = new alphaTab.midi.MidiFile();
  const gen = new alphaTab.midi.MidiFileGenerator(
    score,
    settings,
    new alphaTab.midi.AlphaSynthMidiFileHandler(midi),
  );
  gen.generate();

  const track = score.tracks[trackIndex];
  if (!track) return { notes: [], stringCount: 6 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lookupBars: any[] = (gen.tickLookup as any).masterBars;
  const segments = buildTempoMap(lookupBars, score, midi.division);

  const notes: SynthNote[] = [];
  // Walk PLAYBACK order, not score order: `lookupBars` expands repeats, and its
  // `start` ticks are the same space `buildTempoMap` measures. Iterating
  // `staff.bars` instead would emit each repeated bar once, at its first-pass
  // time, leaving the notes drifting against a bar grid that does expand.
  for (const staff of track.staves) {
    for (const lookupBar of lookupBars) {
      const bar = staff.bars[lookupBar.masterBar?.index ?? -1];
      if (!bar) continue;
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          if (beat.isRest) continue;
          // `beat.playbackStart` is relative to its own bar; the occurrence's
          // own start tick is what places it on the playback timeline.
          const startTick = lookupBar.start + beat.playbackStart;
          const startSec = tickToSec(segments, startTick);
          const endSec = tickToSec(segments, startTick + beat.playbackDuration);
          for (const note of beat.notes) {
            // Ties continue the previous note; dead notes are percussive mutes.
            if (note.isTieDestination || note.isDead) continue;
            const midiPitch = note.realValue;
            if (!Number.isFinite(midiPitch)) continue;
            notes.push({
              scoreTime: startSec,
              scoreDuration: Math.max(0.05, endSec - startSec),
              midi: midiPitch,
              string: note.isStringed ? note.string : undefined,
              fret: note.isStringed ? note.fret : undefined,
              // Guitar Pro dynamics run ppp(0)..fff(7).
              velocity: clamp(
                0.35 + (typeof beat.dynamics === "number" ? beat.dynamics : 5) * 0.08,
                0.2,
                1,
              ),
            });
          }
        }
      }
    }
  }
  notes.sort((a, b) => a.scoreTime - b.scoreTime);

  const stringCount =
    track.staves.reduce((n, st) => Math.max(n, st.tuning?.length ?? 0), 0) || 6;
  return { notes, stringCount };
}

// --- playback ----------------------------------------------------------------

const LOOKAHEAD_SEC = 0.25;
const TICK_MS = 40;

interface Anchor {
  ctxTime: number;
  audioTime: number;
  rate: number;
}

/**
 * Schedules `SynthNote`s onto a Web Audio graph, positioned via a `SyncMap` so
 * they land on the recording. Re-anchor on play/seek/rate change.
 */
export class TrackSynth {
  private ctx: AudioContext;
  private out: GainNode;
  private limiter: DynamicsCompressorNode;
  private trim: GainNode;
  private notes: SynthNote[] = [];
  private map: SyncMap | null = null;
  private anchor: Anchor | null = null;
  private nextIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private voices: Array<{ osc: OscillatorNode[]; gain: GainNode }> = [];

  constructor(ctx: AudioContext, destination?: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;

    // Safety limiter on the synth bus. Chords stack 6 voices and a resonant
    // filter adds more on top; without this a dense passage clips hard
    // (measured peak 6.8 before adding it).
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -12;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.12;

    // The compressor lets transients overshoot; a fixed trim after it keeps the
    // bus below full scale even at volume 1.0 (measured 1.10 peak without it).
    this.trim = ctx.createGain();
    this.trim.gain.value = 0.8;

    this.out.connect(this.limiter).connect(this.trim);
    this.trim.connect(destination ?? ctx.destination);
  }

  get output(): GainNode {
    return this.out;
  }

  get context(): AudioContext {
    return this.ctx;
  }

  /**
   * Start the audio hardware. Must be called from a real user gesture — browsers
   * create an `AudioContext` suspended and it stays that way otherwise.
   *
   * Delegated to `unlockAudio` when this synth runs on the shared context, so
   * the iOS silent-buffer kick happens here too; a synth built on its own
   * context (offline rendering in tests/diagnostics) just resumes.
   */
  resume(): void {
    if (this.ctx.state === "running" || typeof this.ctx.resume !== "function") {
      return;
    }
    if (this.ctx === getAudioContext()) {
      unlockAudio();
      return;
    }
    try {
      // `resume()` REJECTS (not throws) on an offline context, so the promise
      // must be handled or it surfaces as an unhandled rejection.
      const p = this.ctx.resume();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* already closed */
    }
  }

  setVolume(v: number): void {
    // Short ramp avoids clicks when dragging the slider.
    const g = this.out.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, 0.015);
  }

  setNotes(notes: SynthNote[]): void {
    this.notes = notes;
    this.resyncPointer();
  }

  setSyncMap(map: SyncMap | null): void {
    this.map = map;
    this.resyncPointer();
  }

  /** Called on play and on every seek / rate change. */
  anchorAt(audioTimeSec: number, rate: number): void {
    this.resume();
    this.anchor = { ctxTime: this.ctx.currentTime, audioTime: audioTimeSec, rate };
    this.stopVoices();
    this.resyncPointer();
  }

  start(audioTimeSec: number, rate: number): void {
    this.anchorAt(audioTimeSec, rate);
    if (this.timer == null) {
      this.timer = setInterval(() => this.pump(), TICK_MS);
    }
    this.pump();
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.anchor = null;
    this.stopVoices();
  }

  dispose(): void {
    this.stop();
    try {
      this.out.disconnect();
      this.limiter.disconnect();
      this.trim.disconnect();
    } catch {
      /* noop */
    }
  }

  /** Current recording position implied by the anchor, seconds. */
  private audioNow(): number {
    if (!this.anchor) return 0;
    return (
      this.anchor.audioTime +
      (this.ctx.currentTime - this.anchor.ctxTime) * this.anchor.rate
    );
  }

  /** Skip notes already behind the playhead so a seek doesn't dump a burst. */
  private resyncPointer(): void {
    if (!this.anchor || !this.map) {
      this.nextIndex = 0;
      return;
    }
    const now = this.audioNow();
    let i = 0;
    while (
      i < this.notes.length &&
      this.map.scoreTimeToAudioTime(this.notes[i].scoreTime) < now
    ) {
      i++;
    }
    this.nextIndex = i;
  }

  private pump(): void {
    const map = this.map;
    const anchor = this.anchor;
    if (!map || !anchor) return;

    const horizon = this.audioNow() + LOOKAHEAD_SEC;
    while (this.nextIndex < this.notes.length) {
      const note = this.notes[this.nextIndex];
      const audioTime = map.scoreTimeToAudioTime(note.scoreTime);
      if (audioTime > horizon) break;
      this.nextIndex++;

      const when =
        anchor.ctxTime + (audioTime - anchor.audioTime) / anchor.rate;
      if (when < this.ctx.currentTime - 0.05) continue; // missed it

      const audioEnd = map.scoreTimeToAudioTime(
        note.scoreTime + note.scoreDuration,
      );
      const durationSec = Math.max(
        0.05,
        (audioEnd - audioTime) / anchor.rate,
      );
      this.playNote(note, Math.max(when, this.ctx.currentTime), durationSec);
    }
  }

  /**
   * One voice: triangle + detuned saw through a lowpass with a plucked
   * envelope. Reads as a plausible bass/guitar reference tone without shipping a
   * soundfont.
   */
  private playNote(note: SynthNote, when: number, durationSec: number): void {
    const ctx = this.ctx;
    const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
    const dur = Math.min(durationSec, 4);

    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    const lowRegister = note.midi < 45;

    // Brighter attack that settles — the classic plucked-string gesture. Bass
    // notes keep more upper harmonics so they survive laptop/phone speakers.
    filter.frequency.setValueAtTime(
      Math.min(7000, freq * (lowRegister ? 14 : 8)),
      when,
    );
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(lowRegister ? 360 : 200, freq * (lowRegister ? 7 : 3)),
      when + Math.min(0.25, dur),
    );
    // Q kept at ~0.7 (Butterworth): resonance here multiplies across voices.
    filter.Q.value = 0.7;

    const osc1 = ctx.createOscillator();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(freq, when);
    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.setValueAtTime(freq, when);
    osc2.detune.setValueAtTime(6, when);

    const mix2 = ctx.createGain();
    mix2.gain.value = lowRegister ? 0.42 : 0.25;

    osc1.connect(gain);
    osc2.connect(mix2).connect(gain);
    const oscillators = [osc1, osc2];
    const cleanupNodes: AudioNode[] = [filter, mix2];
    if (lowRegister) {
      const osc3 = ctx.createOscillator();
      osc3.type = "triangle";
      osc3.frequency.setValueAtTime(freq * 2, when);
      const octaveMix = ctx.createGain();
      octaveMix.gain.value = 0.18;
      osc3.connect(octaveMix).connect(gain);
      oscillators.push(osc3);
      cleanupNodes.push(octaveMix);
    }
    gain.connect(filter).connect(this.out);

    // Conservative per-voice level; the bus limiter catches dense chords.
    const peak = note.velocity * (lowRegister ? 0.16 : 0.12);
    const release = 0.09;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(peak * 0.35, 1e-4),
      when + Math.min(0.35, dur),
    );
    gain.gain.setTargetAtTime(1e-4, when + dur, release / 3);

    const stopAt = when + dur + release;
    for (const osc of oscillators) {
      osc.start(when);
      osc.stop(stopAt);
    }

    const voice = { osc: oscillators, gain };
    this.voices.push(voice);
    osc1.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
      try {
        gain.disconnect();
        for (const node of cleanupNodes) node.disconnect();
      } catch {
        /* noop */
      }
    };
  }

  private stopVoices(): void {
    for (const v of this.voices) {
      try {
        v.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        v.gain.gain.setTargetAtTime(1e-4, this.ctx.currentTime, 0.01);
        for (const o of v.osc) o.stop(this.ctx.currentTime + 0.05);
      } catch {
        /* already stopped */
      }
    }
    this.voices = [];
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
