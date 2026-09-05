import { AuthButton } from "@/components/auth/AuthButton";
import { SidebarNav } from "./SidebarNav";
import { ThemeToggle } from "./ThemeToggle";
import { WordmarkLockup } from "./Wordmark";

/** Persistent nav rail. Hidden below `md`, where `MobileTopBar` takes over. */
export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-7 border-r border-rule bg-paper-raised px-3.5 py-[22px] md:flex">
      <WordmarkLockup />

      <SidebarNav />

      <div className="mt-auto flex flex-col gap-3">
        <ThemeToggle />
        <AuthButton />
      </div>
    </aside>
  );
}
