"use client";

import { useEffect } from "react";
import { installBundledSongs } from "../data/bundledSongs";

/** Installs the songs shipped in `public/songs/` on first load. Renders nothing. */
export function BundledSongsLoader() {
  useEffect(() => {
    installBundledSongs().catch((err) => {
      console.error("Failed to install bundled songs", err);
    });
  }, []);

  return null;
}
