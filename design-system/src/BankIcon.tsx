import React from "react";

export type BankIconProps = React.SVGProps<SVGSVGElement>;

/** Bank building (columns + base). Thin-line, `stroke="currentColor"` house
 * style. Sidebar's Bank Accounts link. */
export function BankIcon(props: BankIconProps) {
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
      <path d="M3 10l9-6 9 6" />
      <path d="M5 10v9M10 10v9M14 10v9M19 10v9" />
      <path d="M3 19h18" />
    </svg>
  );
}
