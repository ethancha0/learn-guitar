import { describe, expect, it } from "vitest";
import { resolveSyncDiagnosticsFlag } from "./syncDiagnosticsFlag";

describe("resolveSyncDiagnosticsFlag", () => {
  it("turns the panel on from the URL and remembers it", () => {
    expect(resolveSyncDiagnosticsFlag("?diag=1", null)).toEqual({
      enabled: true,
      persist: "1",
    });
  });

  it("turns it off again from the URL, overriding what was stored", () => {
    expect(resolveSyncDiagnosticsFlag("?diag=0", "1")).toEqual({
      enabled: false,
      persist: "0",
    });
  });

  it("falls back to the stored answer when the URL says nothing", () => {
    expect(resolveSyncDiagnosticsFlag("", "1")).toEqual({ enabled: true });
    expect(resolveSyncDiagnosticsFlag("?songId=abc", null)).toEqual({
      enabled: false,
    });
  });

  it("ignores a value that is neither 1 nor 0", () => {
    expect(resolveSyncDiagnosticsFlag("?diag=yes", "1")).toEqual({
      enabled: true,
    });
  });
});
