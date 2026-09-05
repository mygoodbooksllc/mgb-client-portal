import React from "react";
/** Props for {@link RunwayRing}. */
export interface RunwayRingProps {
    /** Ring fill fraction from 0 to 1 (e.g. months of runway / 12, clamped). */
    pct: number;
    /** Which color pairing to use — "negative" draws from --bad/--bad-soft, anything else from --good/--good-soft. */
    tone?: "negative" | "positive" | string;
    /** Content rendered in the center of the ring (typically a value + status label). */
    children?: React.ReactNode;
}
/**
 * Circular progress ring, originally built for the Cash Runway KPI. `pct` is
 * 0-1; `tone` picks the good/bad color via the --good/--bad design tokens so
 * it stays in sync with the text tone used alongside it.
 */
export declare function RunwayRing({ pct, tone, children }: RunwayRingProps): React.JSX.Element;
