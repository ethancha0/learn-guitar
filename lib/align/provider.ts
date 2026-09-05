/**
 * Chooses how DTW alignment actually runs.
 *
 * - `worker` — proxy to an align worker over HTTP. Required in production; set
 *   `ALIGN_WORKER_URL` (and `ALIGN_WORKER_TOKEN`).
 * - `local`  — spawn node + python on this machine. Dev only.
 *
 * Set `ALIGN_PROVIDER=local|worker` to force one explicitly.
 *
 * This mirrors `lib/youtube/provider.ts`, and for the same reason: `align.py`
 * needs Python, SyncToolbox and fluidsynth, and managed serverless images ship
 * none of them. The GP→MIDI step and ffmpeg are plain Node and would run
 * anywhere; it is only the DTW solve that has to be hosted somewhere real.
 */

export interface AlignWorkerConfig {
  baseUrl: string;
  token: string;
}

export interface AlignDispatchConfig {
  /** "owner/repo" holding the align workflow. */
  repo: string;
  token: string;
  eventType: string;
}

export type AlignProvider =
  | { kind: "worker"; config: AlignWorkerConfig }
  | { kind: "dispatch"; config: AlignDispatchConfig }
  | { kind: "local" }
  /** No way to align here — carries the reason, for the diagnostics panel. */
  | { kind: "unavailable"; message: string };

/**
 * How the browser must talk to us, which is not the same question as where the
 * work runs. `local` answers with the finished map on the same request;
 * `dispatch` only accepts a song id and answers later by writing the map to the
 * song's row. The client has to know which *before* it picks a request shape —
 * it cannot POST a 5 MB recording to a serverless function that would only
 * forward an id, and on Vercel that upload would breach the body limit anyway.
 */
export type AlignMode = "local" | "dispatch" | "unavailable";

export function alignMode(provider: AlignProvider): AlignMode {
  if (provider.kind === "unavailable") return "unavailable";
  // A worker proxy still answers in-band, so it looks like `local` to the client.
  return provider.kind === "dispatch" ? "dispatch" : "local";
}

/**
 * Alignment by GitHub Action: the app fires a `repository_dispatch` and the
 * workflow writes `sync_map` back to the song's row. Set `ALIGN_GITHUB_REPO`
 * ("owner/repo") and `ALIGN_GITHUB_TOKEN` (a token with `contents: write` on
 * that repo). See `.github/workflows/align-song.yml`.
 */
export function alignDispatchConfig(): AlignDispatchConfig | null {
  const repo = process.env.ALIGN_GITHUB_REPO?.trim();
  const token = process.env.ALIGN_GITHUB_TOKEN?.trim();
  if (!repo || !token) return null;
  return {
    repo,
    token,
    eventType: process.env.ALIGN_GITHUB_EVENT?.trim() || "align-song",
  };
}

export function alignWorkerConfig(): AlignWorkerConfig | null {
  const baseUrl = process.env.ALIGN_WORKER_URL?.trim();
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token: process.env.ALIGN_WORKER_TOKEN?.trim() ?? "",
  };
}

/**
 * Managed serverless runtimes cannot run the aligner: no Python interpreter,
 * and no fluidsynth to render the score to audio for the DTW comparison.
 */
function isManagedServerless(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY,
  );
}

export function resolveAlignProvider(): AlignProvider {
  const forced = process.env.ALIGN_PROVIDER?.trim().toLowerCase();
  const worker = alignWorkerConfig();
  const dispatch = alignDispatchConfig();

  if (forced === "local") return { kind: "local" };
  if (forced === "worker" || (worker && forced !== "dispatch")) {
    return worker
      ? { kind: "worker", config: worker }
      : {
          kind: "unavailable",
          message:
            "ALIGN_PROVIDER=worker but ALIGN_WORKER_URL is not set.",
        };
  }
  if (forced === "dispatch" || dispatch) {
    return dispatch
      ? { kind: "dispatch", config: dispatch }
      : {
          kind: "unavailable",
          message:
            "ALIGN_PROVIDER=dispatch but ALIGN_GITHUB_REPO / ALIGN_GITHUB_TOKEN are not set.",
        };
  }

  if (isManagedServerless()) {
    return {
      kind: "unavailable",
      message:
        "Alignment is not configured on this deployment: this runtime has no Python, " +
        "so DTW has to run elsewhere. Set ALIGN_GITHUB_REPO and ALIGN_GITHUB_TOKEN to " +
        "align by GitHub Action (see .github/workflows/align-song.yml), or ALIGN_WORKER_URL " +
        "to proxy to a worker.",
    };
  }

  return { kind: "local" };
}
