"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, readTheme, storeTheme, type Theme } from "@/lib/theme";

/**
 * Paper ↔ Lamp. The class itself is set before paint by the inline script in
 * `app/layout.tsx`; this only mirrors it into React state after mount so the
 * server and client first renders agree.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => setTheme(readTheme()), []);

  function toggle() {
    const next: Theme = theme === "lamp" ? "paper" : "lamp";
    setTheme(next);
    applyTheme(next);
    storeTheme(next);
  }

  const lamp = theme === "lamp";
  const Icon = lamp ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={lamp ? "Switch to the Paper theme" : "Switch to the Lamp theme"}
      className="flex items-center gap-2 rounded-sm px-1.5 py-1.5 font-mono text-[9.5px] uppercase tracking-label text-ink-faint transition-colors hover:bg-[var(--wash-soft)] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {/* Rendered only once the stored theme is known, so the label can't
          contradict the class the init script already applied. */}
      {!compact && <span>{theme === null ? "" : lamp ? "Lamp" : "Paper"}</span>}
    </button>
  );
}
