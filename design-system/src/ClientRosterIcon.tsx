import React from "react";

export type ClientRosterIconProps = React.SVGProps<SVGSVGElement>;

/** Table/roster outline. Thin-line, `stroke="currentColor"` house style.
 * Sidebar's Client Roster link. */
export function ClientRosterIcon(props: ClientRosterIconProps) {
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
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 4v5" />
    </svg>
  );
}
