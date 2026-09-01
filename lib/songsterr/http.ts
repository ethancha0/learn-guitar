import { SONGSTERR_ORIGIN, SongsterrError } from "./types";

/**
 * Every outbound request needs a deadline. Without one a stalled upstream (a
 * rate-limited datacenter IP, a hung CDN connection) holds the request open
 * until the serverless function itself is killed, which surfaces as a hard
 * invocation timeout instead of a recoverable per-request failure.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Songsterr's CDN serves the player's own XHRs and refuses requests that don't
 * look like one, so outbound calls carry the header set a browser would send.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${SONGSTERR_ORIGIN}/`,
  Origin: SONGSTERR_ORIGIN,
};

/**
 * `AbortSignal.timeout` rejects with a TimeoutError; older runtimes report an
 * aborted fetch as AbortError.
 */
export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "TimeoutError" || name === "AbortError";
}

export function songsterrFetch(
  url: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<Response> {
  return fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** GET a path on songsterr.com and parse it as JSON, or throw a SongsterrError. */
export async function getSongsterrJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await songsterrFetch(`${SONGSTERR_ORIGIN}${path}`);
  } catch (err) {
    throw new SongsterrError(
      "UPSTREAM_FAILED",
      isTimeoutError(err) ? "Songsterr took too long to respond." : "Could not reach Songsterr.",
      err instanceof Error ? err.message : undefined,
    );
  }

  if (response.status === 404) {
    throw new SongsterrError("NOT_FOUND", "That song is not on Songsterr.");
  }
  if (!response.ok) {
    throw new SongsterrError("UPSTREAM_FAILED", `Songsterr returned ${response.status}.`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new SongsterrError("UPSTREAM_FAILED", "Songsterr returned invalid JSON.");
  }
}
