import React from "react";

/** Props for {@link FlaskIcon}. Any native `<svg>` attribute can be passed
 * through and overrides the default. */
export type FlaskIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Lab flask. Thin-line, `stroke="currentColor"` house style. Used by
 * {@link MockBanner} to flag prototype/sample data.
 */
export function FlaskIcon(props: FlaskIconProps) {
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
      <path d="M9 3h6M10 3v6.5L4.8 18a2 2 0 001.7 3h11a2 2 0 001.7-3L14 9.5V3" />
      <path d="M7.5 15h9" />
    </svg>
  );
}
