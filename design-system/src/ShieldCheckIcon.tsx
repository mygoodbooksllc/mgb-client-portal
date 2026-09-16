import React from "react";

/** Props for {@link ShieldCheckIcon}. Any native `<svg>` attribute can be
 * passed through and overrides the default. */
export type ShieldCheckIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Shield with a checkmark. Thin-line, `stroke="currentColor"` house style.
 * Used for the "Budgeting Tool" entry in the Enterprise Tools feature list.
 */
export function ShieldCheckIcon(props: ShieldCheckIconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
