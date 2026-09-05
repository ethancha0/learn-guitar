/**
 * The mark is a music final barline — one thick rule, one thin — rather than
 * an instrument icon. Two spans, no SVG.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="flex h-[26px] items-stretch gap-[2px]" aria-hidden>
        <span className="w-[5px] bg-ink" />
        <span className="w-[1.5px] bg-ink" />
      </span>
    </span>
  );
}

/** Barline plus the stacked `Learn Bass` / `Ed. 2026` lockup. */
export function WordmarkLockup({ title }: { title?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <Wordmark />
      <span className="flex flex-col leading-[1.05]">
        {title ?? (
          <span className="font-display text-base font-bold tracking-[-0.01em] text-ink">
            Fretly
          </span>
        )}
        <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-ink-faint">
          Ed. 2026
        </span>
      </span>
    </div>
  );
}
