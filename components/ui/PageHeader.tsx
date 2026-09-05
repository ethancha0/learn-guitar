interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Small uppercase line above the title, e.g. `CATALOGUE · TEN ENTRIES`. */
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * Masthead for a route: an engraved rule under an editorial title block, with
 * the actions hung off the same baseline.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between border-b-2 border-rule-strong pb-3">
      <div>
        {eyebrow && (
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-faint">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1.5 font-display text-[38px] font-bold leading-none tracking-[-0.025em] text-ink">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 font-display text-[15px] italic text-ink-muted">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
