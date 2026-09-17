import React from "react";

export type ChevronDownIconProps = React.SVGProps<SVGSVGElement>;

/** Chevron down. Thin-line, `stroke="currentColor"` house style. Widget-picker "move down" button. */
export function ChevronDownIcon(props: ChevronDownIconProps) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5 9l7 7 7-7" />
    </svg>
  );
}
