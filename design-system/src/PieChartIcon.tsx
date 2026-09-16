import React from "react";

export type PieChartIconProps = React.SVGProps<SVGSVGElement>;

/** Pie chart. Thin-line, `stroke="currentColor"` house style. Sidebar's Budget vs. Actual link. */
export function PieChartIcon(props: PieChartIconProps) {
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
      <path d="M12 12V3a9 9 0 019 9h-9z" />
      <path d="M20.5 15A9 9 0 1112 3v9l8.5 3z" />
    </svg>
  );
}
