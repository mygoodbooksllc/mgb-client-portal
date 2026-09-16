import React from "react";

/** Props for {@link MoonIcon}. Any native `<svg>` attribute can be passed
 * through and overrides the default. */
export type MoonIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Crescent moon. Thin-line, `stroke="currentColor"` house style. Shown in
 * the sidebar theme toggle when the current theme is light (click to switch
 * to dark).
 */
export function MoonIcon(props: MoonIconProps) {
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
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
    </svg>
  );
}
