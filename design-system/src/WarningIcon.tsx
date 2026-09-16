import React from "react";

/** Props for {@link WarningIcon}. Any native `<svg>` attribute (width, height,
 * strokeWidth, style, ...) can be passed through and overrides the default. */
export type WarningIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Warning triangle. Thin-line, `stroke="currentColor"` — the house icon
 * style used throughout the app instead of emoji. Used in Staff Access's and
 * Client Roster's "writes directly to the real table" banners.
 */
export function WarningIcon(props: WarningIconProps) {
  return (
    <svg
      className="icon-inline"
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
      <path d="M12 4l9.5 16.5H2.5L12 4z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </svg>
  );
}
