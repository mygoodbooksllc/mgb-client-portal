import React from "react";

export type StackedBillsIconProps = React.SVGProps<SVGSVGElement>;

/** Two overlapping rectangles ("stacked bills"). Thin-line,
 * `stroke="currentColor"` house style. Sidebar's AP Command Center link. */
export function StackedBillsIcon(props: StackedBillsIconProps) {
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
      <rect x="4" y="4" width="14" height="10" rx="1.5" />
      <rect x="7" y="9" width="14" height="10" rx="1.5" />
    </svg>
  );
}
