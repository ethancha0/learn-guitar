/**
 * The catalogue's column track, shared by the header row and every song row so
 * the two stay in register.
 *
 * The seven-column measure is a desktop figure. Below `md` the row folds to two
 * lines — number and title over artist and length — via the explicit
 * `col-start` / `row-start` placement each cell carries; every one of those is
 * reset with `md:col-auto md:row-auto` so the printed grid takes over again.
 */
export const CATALOGUE_COLUMNS =
  "grid grid-cols-[28px_1fr_auto] items-center gap-x-3 gap-y-0.5 md:grid-cols-[34px_1fr_150px_92px_78px_96px_54px] md:gap-4 md:gap-y-0";

/** Cells that only earn their place at the full desktop measure. */
export const DESKTOP_ONLY_CELL = "hidden md:block";
