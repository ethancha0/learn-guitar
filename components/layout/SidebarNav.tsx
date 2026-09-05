"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { navItems } from "./navItems";

/**
 * The nav link list, shared by the desktop sidebar and the mobile drawer.
 * Ruled rows rather than pills: each item is a full-width line closed by a
 * hairline, with a 5px dot standing in for the old per-item icon.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col">
      {navItems.map(({ href, label, comingSoon }, i) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={comingSoon ? "#" : href}
            aria-disabled={comingSoon}
            tabIndex={comingSoon ? -1 : undefined}
            onClick={comingSoon ? undefined : onNavigate}
            className={cn(
              "flex items-center gap-2.5 border-b border-rule px-1.5 py-2.5 font-mono text-xs uppercase tracking-nav transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
              // The list opens on a strong rule so it reads as a table head.
              i === 0 && "border-t border-t-rule-strong",
              active
                ? "font-semibold text-ink"
                : "text-ink-faint hover:bg-[var(--wash-soft)]",
              // `comingSoon` keeps the label at full opacity — the SOON badge
              // carries the state on its own.
              comingSoon && "pointer-events-none",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "h-[5px] w-[5px] shrink-0 rounded-full",
                active ? "bg-accent" : "bg-dot",
              )}
            />
            <span>{label}</span>
            {comingSoon && (
              <span className="ml-auto font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink-ghost">
                Soon
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
