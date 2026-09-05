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
export function RunwayRing({ pct, tone, children }: RunwayRingProps) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const trackColor = tone === "negative" ? "var(--bad-soft)" : "var(--good-soft)";
  const ringColor = tone === "negative" ? "var(--bad)" : "var(--good)";
  return (
    <div className="runway-ring-wrap">
      <svg width="108" height="108" viewBox="0 0 108 108">
        <circle cx="54" cy="54" r={r} fill="none" stroke={trackColor} strokeWidth="9" />
        <circle
          cx="54"
          cy="54"
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform="rotate(-90 54 54)"
        />
      </svg>
      <div className="runway-ring-center">{children}</div>
    </div>
  );
}
