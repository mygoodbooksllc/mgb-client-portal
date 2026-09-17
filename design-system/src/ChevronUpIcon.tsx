import React from "react";

export type ChevronUpIconProps = React.SVGProps<SVGSVGElement>;

/** Chevron up. Thin-line, `stroke="currentColor"` house style. Widget-picker "move up" button. */
export function ChevronUpIcon(props: ChevronUpIconProps) {
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
      <path d="M5 15l7-7 7 7" />
    </svg>
  );
}
