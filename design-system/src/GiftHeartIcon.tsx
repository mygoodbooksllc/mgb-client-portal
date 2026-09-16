import React from "react";

export type GiftHeartIconProps = React.SVGProps<SVGSVGElement>;

/** Heart. Thin-line, `stroke="currentColor"` house style. Sidebar's Giving & Funds link. */
export function GiftHeartIcon(props: GiftHeartIconProps) {
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
      <path d="M12 21s-7-4.5-9.5-9A5 5 0 0112 6a5 5 0 019.5 6c-2.5 4.5-9.5 9-9.5 9z" />
    </svg>
  );
}
