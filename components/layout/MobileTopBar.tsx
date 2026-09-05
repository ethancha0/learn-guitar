"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { AuthButton } from "@/components/auth/AuthButton";
import { Button } from "@/components/ui/Button";
import { DialogOverlay, DialogPortal } from "@/components/ui/Dialog";
import { SidebarNav } from "./SidebarNav";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark, WordmarkLockup } from "./Wordmark";

/**
 * Phone-only header: the sidebar is off-canvas below `md`, so nav lives behind
 * this hamburger. Uses the Radix dialog primitives directly (rather than the
 * centred `DialogContent`) so it can slide in as a left drawer.
 */
export function MobileTopBar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-rule bg-paper-raised px-2 pt-[env(safe-area-inset-top)] md:hidden">
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
            className="fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80vw] flex-col gap-7 border-r border-rule bg-paper-raised px-3.5 py-[22px] focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
          >
            <div className="flex items-center gap-2">
              <WordmarkLockup
                title={
                  <DialogPrimitive.Title className="font-display text-base font-bold tracking-[-0.01em] text-ink">
                    Learn Bass
                  </DialogPrimitive.Title>
                }
              />
              <DialogPrimitive.Close
                className="ml-auto rounded-sm p-1 text-ink-faint transition-colors hover:text-ink focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>

            <SidebarNav onNavigate={() => setOpen(false)} />

            <div className="mt-auto flex flex-col gap-3">
              <ThemeToggle />
              <AuthButton />
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </DialogPrimitive.Root>

      <span className="flex items-center gap-2.5">
        <Wordmark />
        <span className="font-display text-base font-bold tracking-[-0.01em] text-ink">
          Fretly
        </span>
      </span>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle compact />
        <AuthButton compact />
      </div>
    </header>
  );
}
