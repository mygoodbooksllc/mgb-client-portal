import React from "react";

/** direction-agnostic % change between two totals for the same period length. */
function trendInfo(current: number, prior: number | null | undefined, goodDir: "up" | "down" = "up") {
  if (prior == null || prior === 0) {
    return { dir: "flat" as const, cls: "neutral" as const, label: "no prior period on record", arrow: "•" };
  }
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  const dir = pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
  const cls = dir === "flat" ? "neutral" : dir === goodDir ? "positive" : "negative";
  const label = dir === "flat" ? "steady vs. prior period" : `${Math.abs(pct).toFixed(1)}% vs. prior period`;
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "●";
  return { dir, cls, label, arrow };
}

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
export function TrendPill({ current, prior, goodDir = "up" }: TrendPillProps) {
  const t = trendInfo(current, prior, goodDir);
  const pillClass = t.cls === "positive" ? "good" : t.cls === "negative" ? "bad" : "neutral";
  return (
    <span className={"pill " + pillClass}>
      {t.arrow} {t.label}
    </span>
  );
}
