import React from "react";

/** Props for {@link LockIcon}. Any native `<svg>` attribute can be passed
 * through and overrides the default. */
export type LockIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Padlock. Thin-line, `stroke="currentColor"` house style. Used on
 * Documents' "Full access only" visibility pill.
 */
export function LockIcon(props: LockIconProps) {
  return (
    <svg
      className="icon-inline"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
