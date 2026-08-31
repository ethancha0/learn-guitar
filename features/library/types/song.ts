export interface Song {
  id: string;
  title: string;
  artist: string;
  /** Total playable length in seconds. */
  durationSec: number;
  bpm: number;
  difficulty: "beginner" | "intermediate" | "advanced";
  /** Whether a synced audio track has been imported yet (mock flag). */
  hasAudio: boolean;
  /** Whether a Guitar Pro / tab file has been imported yet (mock flag). */
  hasTab: boolean;
  /**
   * Base64-encoded bytes of the imported Guitar Pro / PowerTab file, used to
   * feed alphaTab in the player. Present on user-imported songs only.
   */
  tabData?: string;
  tabStoragePath?: string;
  audioStoragePath?: string;
  persisted?: boolean;
}
