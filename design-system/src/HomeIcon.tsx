import React from "react";

export type HomeIconProps = React.SVGProps<SVGSVGElement>;

/** House. Thin-line, `stroke="currentColor"` house style. Sidebar's Home link. */
export function HomeIcon(props: HomeIconProps) {
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
      <path d="M4 11.5L12 4l8 7.5" />
      <path d="M6 10v9h12v-9" />
    </svg>
  );
}
