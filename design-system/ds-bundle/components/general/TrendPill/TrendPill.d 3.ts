import * as React from 'react';

/**
 * TrendPill — from mygoodbooks-ds@0.1.0.
 */
export interface TrendPillProps {
  /** This period's value. */
  current: number;
  /** The prior period's value to compare against; null/undefined renders "no prior period on record". */
  prior: number;
  /** Which direction of change reads as positive — e.g. "down" for an expense metric where less is good. Defaults to "up". */
  goodDir?: "up" | "down";
}

export declare const TrendPill: React.ComponentType<TrendPillProps>;
