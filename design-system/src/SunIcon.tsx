import React from "react";

/** Props for {@link SunIcon}. Any native `<svg>` attribute can be passed
 * through and overrides the default. */
export type SunIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Sun. Thin-line, `stroke="currentColor"` house style. Shown in the sidebar
 * theme toggle when the current theme is dark (click to switch to light).
 */
export function SunIcon(props: SunIconProps) {
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
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}
