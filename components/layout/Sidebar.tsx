"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Guitar } from "lucide-react";
import { cn } from "@/lib/cn";
import { navItems } from "./navItems";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-6 border-r border-white/5 bg-surface-raised px-3 py-5">
      <div className="flex items-center gap-2 px-2">
        <Guitar className="h-5 w-5 text-accent" />
        <span className="text-sm font-semibold tracking-tight">Learn Bass</span>
      </div>

      <nav className="flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon, comingSoon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={comingSoon ? "#" : href}
              aria-disabled={comingSoon}
              tabIndex={comingSoon ? -1 : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                active
                  ? "bg-surface-overlay text-zinc-100"
                  : "text-zinc-400 hover:bg-surface-overlay hover:text-zinc-200",
                comingSoon && "pointer-events-none opacity-40",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
              {comingSoon && (
                <span className="ml-auto text-[10px] uppercase text-zinc-500">Soon</span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
