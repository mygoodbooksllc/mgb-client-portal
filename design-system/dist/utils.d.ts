/**
 * Shared formatting helpers used by several components. Copied verbatim from
 * the top of the parent app's app.jsx so extracted components don't depend
 * on that file.
 */
/** Formats a number as US currency, e.g. fmtMoney(-42.5) -> "-$43". */
export declare const fmtMoney: (n: number, opts?: {
    cents?: boolean;
}) => string;
