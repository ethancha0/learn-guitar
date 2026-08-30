import { Guitar } from "lucide-react";
import { SidebarNav } from "./SidebarNav";

/** Persistent nav rail. Hidden below `md`, where `MobileTopBar` takes over. */
export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-6 border-r border-white/5 bg-surface-raised px-3 py-5 md:flex">
      <div className="flex items-center gap-2 px-2">
        <Guitar className="h-5 w-5 text-accent" />
        <span className="text-sm font-semibold tracking-tight">Learn Bass</span>
      </div>

      <SidebarNav />
    </aside>
  );
}
