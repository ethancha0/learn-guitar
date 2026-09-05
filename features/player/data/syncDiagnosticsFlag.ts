"use client";

import { useEffect, useState } from "react";

/**
 * Who gets the sync diagnostics panel.
 *
 * The gate used to be `process.env.NODE_ENV !== "production"`, which Next
 * inlines at build time: the panel, its toggle and everything they import were
 * dead-code-eliminated from the production bundle, so a song that drifts *only*
 * on the deployed site — the awkward imports usually do — could not be looked
 * at where it misbehaves.
 *
 * It is on by default now, everywhere. The panel was gated because it began as
 * a development-only debug view, not because showing it costs anything: it is
 * in the production bundle either way (a few KB), it reads state the page
 * already has, and it exposes nothing but this song's own mapping. Whether the
 * alignment is drifting is a question you have while *using* the app, so the
 * answer should be reachable without a redeploy or a remembered URL.
 *
 *   - default: on;
 *   - `?diag=0` on any player URL: off for that browser, until `?diag=1`;
 *   - `NEXT_PUBLIC_SYNC_DIAGNOSTICS=0` in the build: off by default for
 *     everyone, with the URL still able to override per browser.
 *
 * The re-align button inside the panel is a separate question, and no longer a
 * build-time one: `alignCapability` asks the server whether alignment can run
 * here at all (locally, on CI, or not), and the panel shows the button or the
 * reason accordingly. Seeing the diagnostics never depended on being able to
 * re-run them.
 */

const DIAG_KEY = "learn-bass.sync-diagnostics";

/** What a browser that has never expressed a preference gets. */
export const SYNC_DIAGNOSTICS_DEFAULT =
  process.env.NEXT_PUBLIC_SYNC_DIAGNOSTICS !== "0";

/**
 * The `?diag=` / stored-preference decision, as a pure function. `persist` is
 * set when the URL carried an explicit answer that should be remembered, so a
 * link works once and the browser keeps that answer afterwards.
 *
 * `fallback` is the deployment default, injectable so tests need no env stub.
 */
export function resolveSyncDiagnosticsFlag(
  search: string,
  stored: string | null,
  fallback: boolean = SYNC_DIAGNOSTICS_DEFAULT,
): { enabled: boolean; persist?: "1" | "0" } {
  const param = new URLSearchParams(search).get("diag");
  if (param === "1" || param === "0") {
    return { enabled: param === "1", persist: param };
  }
  if (stored === "1" || stored === "0") return { enabled: stored === "1" };
  return { enabled: fallback };
}

/**
 * Read the opt-in, applying `?diag=1` / `?diag=0` if either is present. Browser
 * only — the server has neither the URL nor the stored preference.
 */
export function readSyncDiagnosticsFlag(): boolean {
  if (typeof window === "undefined") return SYNC_DIAGNOSTICS_DEFAULT;
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
 * default: the URL param and `localStorage` are read after mount, because the
 * server cannot see either and a disagreement is a hydration mismatch.
 */
export function useSyncDiagnosticsEnabled(): boolean {
  const [enabled, setEnabled] = useState(SYNC_DIAGNOSTICS_DEFAULT);
  useEffect(() => setEnabled(readSyncDiagnosticsFlag()), []);
  return enabled;
}
