"use client";

/**
 * Immediate, unscheduled bass-note blips for rhythm-practice input feedback —
 * a keystroke plays *now*, not at a lookahead-scheduled time, unlike
 * `TrackSynth` (which drives the player's reference tone in sync with the
 * recording). Same plucked-string voicing language (triangle + detuned saw
 * through a lowpass, short pluck envelope) so a hit sounds like it belongs
 * next to the backing track, just triggered by the player's own keystroke
 * instead of the score clock.
 */

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export class StrikeSynth {
  private ctx: AudioContext;
  private out: GainNode;

  constructor(ctx: AudioContext, destination?: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.7;
    this.out.connect(destination ?? ctx.destination);
  }

  setVolume(v: number): void {
    const g = this.out.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, 0.01);
  }

  /** A struck note, at its real pitch — played the instant a hit registers. */
  playNote(midi: number, velocity = 0.85): void {
    const ctx = this.ctx;
    const when = ctx.currentTime;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const dur = 0.32;
    const lowRegister = midi < 45;

    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(6500, freq * (lowRegister ? 12 : 8)), when);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(lowRegister ? 320 : 220, freq * (lowRegister ? 6 : 3)),
      when + 0.18,
    );
    filter.Q.value = 0.7;

    const osc1 = ctx.createOscillator();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(freq, when);
    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.setValueAtTime(freq, when);
    osc2.detune.setValueAtTime(6, when);
    const mix2 = ctx.createGain();
    mix2.gain.value = lowRegister ? 0.4 : 0.25;

    osc1.connect(gain);
    osc2.connect(mix2).connect(gain);
    gain.connect(filter).connect(this.out);

    const peak = velocity * (lowRegister ? 0.55 : 0.4);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak * 0.3, 1e-4), when + Math.min(0.2, dur));
    gain.gain.setTargetAtTime(1e-4, when + dur, 0.05);

    const stopAt = when + dur + 0.15;
    osc1.start(when);
    osc1.stop(stopAt);
    osc2.start(when);
    osc2.stop(stopAt);
    osc1.onended = () => {
      try {
        gain.disconnect();
        filter.disconnect();
        mix2.disconnect();
      } catch {
        /* noop */
      }
    };
  }

  /** No note in the hit window — a dead, muted click rather than silence. */
  playWhiff(): void {
    const ctx = this.ctx;
    const when = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(110, when);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.1, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(1e-4, when + 0.08);
    osc.connect(gain).connect(this.out);
    osc.start(when);
    osc.stop(when + 0.1);
    osc.onended = () => {
      try {
        gain.disconnect();
      } catch {
        /* noop */
      }
    };
  }

  dispose(): void {
    try {
      this.out.disconnect();
    } catch {
      /* noop */
    }
  }
}
