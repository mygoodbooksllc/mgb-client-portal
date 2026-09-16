import React from "react";

/** Props for {@link SlidersIcon}. Any native `<svg>` attribute can be
 * passed through and overrides the default. */
export type SlidersIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Adjustment sliders. Thin-line, `stroke="currentColor"` house style. Used
 * on both "Manage access" and "Customize dashboard."
 */
export function SlidersIcon(props: SlidersIconProps) {
  return (
    <svg
      className="icon-inline"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 6h10M17 6h3M4 12h3M9 12h11M4 18h13M20 18h0" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </svg>
  );
}
