"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { navItems } from "./navItems";

/** The nav link list, shared by the desktop sidebar and the mobile drawer. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {navItems.map(({ href, label, icon: Icon, comingSoon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={comingSoon ? "#" : href}
            aria-disabled={comingSoon}
            tabIndex={comingSoon ? -1 : undefined}
            onClick={comingSoon ? undefined : onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-2 py-2.5 text-sm transition-colors md:py-2",
              active
                ? "bg-surface-overlay text-zinc-100"
                : "text-zinc-400 hover:bg-surface-overlay hover:text-zinc-200",
              comingSoon && "pointer-events-none opacity-40",
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            {comingSoon && (
              <span className="ml-auto text-[10px] uppercase text-zinc-500">
                Soon
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
