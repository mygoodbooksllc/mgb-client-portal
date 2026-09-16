import React from "react";

/** Props for {@link BarChartIcon}. Any native `<svg>` attribute can be
 * passed through and overrides the default. */
export type BarChartIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Bar chart (four uneven bars). Thin-line, `stroke="currentColor"` house
 * style. Used for the "Report Builder" entry in the Enterprise Tools
 * feature list.
 */
export function BarChartIcon(props: BarChartIconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 20V10M9.5 20V4M15 20V13M20.5 20V7" />
    </svg>
  );
}
