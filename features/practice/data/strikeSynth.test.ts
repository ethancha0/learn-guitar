import { describe, expect, it } from "vitest";
import { StrikeSynth } from "./strikeSynth";

/**
 * Minimal Web Audio stand-in — enough of a graph for the level logic, which is
 * the part that has to behave the same whether or not the hardware has been
 * unlocked yet. `currentTime` stays frozen while suspended, exactly as a real
 * context's does.
 */
function fakeContext(state: "suspended" | "running") {
  const ramps: Array<{ value: number; when: number }> = [];
  const gain = {
    value: 0,
    cancelScheduledValues: () => {},
    setTargetAtTime: (value: number, when: number) => {
      ramps.push({ value, when });
    },
  };
  const ctx = {
    state,
    currentTime: state === "running" ? 1.5 : 0,
    destination: {},
    createGain: () => ({ gain, connect: () => ({}) }),
  };
  return { ctx: ctx as unknown as AudioContext, gain, ramps };
}

describe("StrikeSynth.setVolume", () => {
  it("writes the level outright while the context is suspended", () => {
    const { ctx, gain, ramps } = fakeContext("suspended");
    const synth = new StrikeSynth(ctx);

    synth.setVolume(0.25);

    // A ramp against a frozen clock would leave the gain where it was.
    expect(gain.value).toBeCloseTo(0.25, 9);
    expect(ramps).toHaveLength(0);
    expect(synth.volume).toBeCloseTo(0.25, 9);
  });

  it("ramps once the context is running", () => {
    const { ctx, ramps } = fakeContext("running");
    const synth = new StrikeSynth(ctx);

    synth.setVolume(0.9);

    expect(ramps).toEqual([{ value: 0.9, when: 1.5 }]);
  });

  it("clamps to 0..1", () => {
    const { ctx, gain } = fakeContext("suspended");
    const synth = new StrikeSynth(ctx);

    synth.setVolume(-3);
    expect(gain.value).toBe(0);
    synth.setVolume(4);
    expect(gain.value).toBe(1);
  });
});
