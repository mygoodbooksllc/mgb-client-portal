import React from "react";

export type SwapIconProps = React.SVGProps<SVGSVGElement>;

/** Two crossing arrows. Thin-line, `stroke="currentColor"` house style.
 * Sidebar's Receivables & Payables link — money moving both directions. */
export function SwapIcon(props: SwapIconProps) {
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
      <path d="M7 7h11l-3-3M17 17H6l3 3" />
    </svg>
  );
}
