import React from "react";

export type UsersIconProps = React.SVGProps<SVGSVGElement>;

/** Two people. Thin-line, `stroke="currentColor"` house style. Sidebar's Staff Access link. */
export function UsersIcon(props: UsersIconProps) {
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
      <circle cx="9" cy="8" r="3" />
      <path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" />
      <path d="M16 8a3 3 0 100-6" />
      <path d="M22 20c0-2.8-2-5-5-5.7" />
    </svg>
  );
}
