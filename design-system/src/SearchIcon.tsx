import React from "react";

/** Props for {@link SearchIcon}. Any native `<svg>` attribute can be passed
 * through and overrides the default. */
export type SearchIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Magnifying glass. Thin-line, `stroke="currentColor"` house style. Used in
 * the global search bar.
 */
export function SearchIcon(props: SearchIconProps) {
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
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.8-4.8" />
    </svg>
  );
}
