"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut, UserCircle } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/Button";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export function AuthButton({ compact = false }: { compact?: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data.user);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [configured]);

  if (!configured) return null;

  async function signIn() {
    setBusy(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/library`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      console.error("[AuthButton] Google sign-in failed", error);
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) console.error("[AuthButton] sign-out failed", error);
    setBusy(false);
  }

  if (!user) {
    return (
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        onClick={signIn}
        disabled={busy}
        aria-label="Sign in with Google"
      >
        <LogIn className="h-4 w-4" />
        {!compact && "Sign in"}
      </Button>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {!compact && (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-zinc-400">
          <UserCircle className="h-4 w-4 shrink-0" />
          <span className="truncate">{user.email}</span>
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size={compact ? "icon" : "sm"}
        onClick={signOut}
        disabled={busy}
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
        {!compact && "Sign out"}
      </Button>
    </div>
  );
}
