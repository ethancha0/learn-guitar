"use client";

import { useEffect, useState } from "react";

/**
 * Who gets the sync diagnostics panel.
 *
 * The gate used to be `process.env.NODE_ENV !== "production"`, which Next
 * inlines at build time: the panel, its toggle and everything they import were
 * dead-code-eliminated from the production bundle, so a song that drifts *only*
 * on the deployed site — the awkward imports usually do — could not be looked
 * at where it misbehaves. The gate is a runtime opt-in instead:
 *
 *   - development: on, exactly as before;
 *   - `NEXT_PUBLIC_SYNC_DIAGNOSTICS=1` in the build: on for everyone;
 *   - `?diag=1` on any player URL: on for that browser, remembered until
 *     `?diag=0` turns it off again.
 *
 * The panel is now *in* the production bundle either way (a few KB), which is
 * the price of being able to turn it on without a redeploy.
 *
 * What stays development-only is the DTW re-align button inside the panel: it
 * needs `/api/align`, which shells out to a local Python pipeline and answers
 * 404 in production. See `ALIGNMENT_ENABLED` in `alignmentQueue.ts` — the panel
 * hides the button rather than offering a control that cannot work.
 */

const DIAG_KEY = "learn-bass.sync-diagnostics";

/** True where the build itself opts in, with no per-browser flag needed. */
export const SYNC_DIAGNOSTICS_ALWAYS_ON =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_SYNC_DIAGNOSTICS === "1";

/**
 * The `?diag=` / stored-preference decision, as a pure function. `persist` is
 * set when the URL carried an explicit answer that should be remembered, so a
 * link works once and the browser keeps the panel afterwards.
 */
export function resolveSyncDiagnosticsFlag(
  search: string,
  stored: string | null,
): { enabled: boolean; persist?: "1" | "0" } {
  const param = new URLSearchParams(search).get("diag");
  if (param === "1" || param === "0") {
    return { enabled: param === "1", persist: param };
  }
  return { enabled: stored === "1" };
}

/**
 * Read the opt-in, applying `?diag=1` / `?diag=0` if either is present. Browser
 * only — the server has neither the URL nor the stored preference.
 */
export function readSyncDiagnosticsFlag(): boolean {
  if (SYNC_DIAGNOSTICS_ALWAYS_ON) return true;
  if (typeof window === "undefined") return false;
  const search = window.location.search;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(DIAG_KEY);
  } catch {
    /* private-mode Safari; the URL alone decides */
  }
  const { enabled, persist } = resolveSyncDiagnosticsFlag(search, stored);
  if (persist) {
    try {
      window.localStorage.setItem(DIAG_KEY, persist);
    } catch {
      /* nothing to remember it with — the flag lasts this page load */
    }
  }
  return enabled;
}

/**
 * The flag as React state. The first render always returns the build-time
 * answer: the URL param and `localStorage` are read after mount, because the
 * server cannot see either and a disagreement is a hydration mismatch.
 */
export function useSyncDiagnosticsEnabled(): boolean {
  const [enabled, setEnabled] = useState(SYNC_DIAGNOSTICS_ALWAYS_ON);
  useEffect(() => setEnabled(readSyncDiagnosticsFlag()), []);
  return enabled;
}
