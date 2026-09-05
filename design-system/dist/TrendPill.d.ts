import React from "react";
/** Props for {@link TrendPill}. */
export interface TrendPillProps {
    /** This period's value. */
    current: number;
    /** The prior period's value to compare against; null/undefined renders "no prior period on record". */
    prior: number | null | undefined;
    /** Which direction of change reads as positive — e.g. "down" for an expense metric where less is good. Defaults to "up". */
    goodDir?: "up" | "down";
}
/**
 * Pill showing a directional % change between two period totals (e.g. this
 * month vs. last month), colored green/red/neutral based on `goodDir`.
 */
export declare function TrendPill({ current, prior, goodDir }: TrendPillProps): React.JSX.Element;
