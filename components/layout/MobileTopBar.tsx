"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Guitar, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DialogOverlay, DialogPortal } from "@/components/ui/Dialog";
import { SidebarNav } from "./SidebarNav";

/**
 * Phone-only header: the sidebar is off-canvas below `md`, so nav lives behind
 * this hamburger. Uses the Radix dialog primitives directly (rather than the
 * centred `DialogContent`) so it can slide in as a left drawer.
 */
export function MobileTopBar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/5 bg-surface-raised px-2 pt-[env(safe-area-inset-top)] md:hidden">
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
        </DialogPrimitive.Trigger>

        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80vw] flex-col gap-6 border-r border-white/10 bg-surface-raised px-3 py-5 shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
          >
            <div className="flex items-center gap-2 px-2">
              <Guitar className="h-5 w-5 text-accent" />
              <DialogPrimitive.Title className="text-sm font-semibold tracking-tight">
                Learn Bass
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                className="ml-auto rounded-md p-1 text-zinc-400 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>

            <SidebarNav onNavigate={() => setOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPortal>
      </DialogPrimitive.Root>

      <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <Guitar className="h-4 w-4 text-accent" />
        Learn Bass
      </span>
    </header>
  );
}
