import React from "react";

export type DownloadIconProps = React.SVGProps<SVGSVGElement>;

/** Download arrow. Thin-line, `stroke="currentColor"` house style. Sidebar's Reports link. */
export function DownloadIcon(props: DownloadIconProps) {
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
      <path d="M12 3v13M7 12l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}
