import * as React from 'react';

/**
 * RunwayRing — from mygoodbooks-ds@0.1.0.
 */
export interface RunwayRingProps {
  /** Ring fill fraction from 0 to 1 (e.g. months of runway / 12, clamped). */
  pct: number;
  /** Which color pairing to use — "negative" draws from --bad/--bad-soft, anything else from --good/--good-soft. */
  tone?: string;
  /** Content rendered in the center of the ring (typically a value + status label). */
  children?: React.ReactNode;
}

export declare const RunwayRing: React.ComponentType<RunwayRingProps>;
