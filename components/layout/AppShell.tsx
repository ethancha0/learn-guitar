import { Sidebar } from "./Sidebar";

/**
 * Server component. Renders the persistent chrome around every route.
 * Only the interactive nav (Sidebar) opts into the client.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
