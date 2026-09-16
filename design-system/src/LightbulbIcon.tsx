import React from "react";

/** Props for {@link LightbulbIcon}. Any native `<svg>` attribute can be
 * passed through and overrides the default. */
export type LightbulbIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Lightbulb. Thin-line, `stroke="currentColor"` house style. Used by the
 * Daily Report's 90-day forecast callout (`components/daily-close/
 * DailyClose.tsx`, a vendored component with its own styling scope, so it
 * keeps its own inline copy of this icon rather than importing from here —
 * this export exists so the icon is still part of the shared set).
 */
export function LightbulbIcon(props: LightbulbIconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 00-3.6 10.8c.6.45 1.1 1.2 1.1 2.2h5c0-1 .5-1.75 1.1-2.2A6 6 0 0012 3z" />
    </svg>
  );
}
