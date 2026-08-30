import { Sidebar } from "./Sidebar";
import { MobileTopBar } from "./MobileTopBar";

/**
 * Server component. Renders the persistent chrome around every route: a nav
 * rail on desktop, a header with an off-canvas drawer on phones. The content
 * column is a flex column so full-height routes (the player) can size their
 * own scroll areas instead of scrolling the whole page.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3 md:px-8 md:py-6">
          <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
