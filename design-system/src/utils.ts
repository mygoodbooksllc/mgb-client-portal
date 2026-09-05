/**
 * Shared formatting helpers used by several components. Copied verbatim from
 * the top of the parent app's app.jsx so extracted components don't depend
 * on that file.
 */

/** Formats a number as US currency, e.g. fmtMoney(-42.5) -> "-$43". */
export const fmtMoney = (n: number, opts: { cents?: boolean } = {}): string => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return (
    sign +
    "$" +
    abs.toLocaleString("en-US", {
      minimumFractionDigits: opts.cents ? 2 : 0,
      maximumFractionDigits: opts.cents ? 2 : 0,
    })
  );
};
