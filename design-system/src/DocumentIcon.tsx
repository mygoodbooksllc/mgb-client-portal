import React from "react";

/** Props for {@link DocumentIcon}. Any native `<svg>` attribute can be
 * passed through and overrides the default. */
export type DocumentIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Document/report sheet. Thin-line, `stroke="currentColor"` house style.
 * Used for the "Daily Report" entry in the Enterprise Tools feature list.
 */
export function DocumentIcon(props: DocumentIconProps) {
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
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}
