import React from "react";

export type FolderIconProps = React.SVGProps<SVGSVGElement>;

/** Folder. Thin-line, `stroke="currentColor"` house style. Sidebar's Documents link. */
export function FolderIcon(props: FolderIconProps) {
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
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}
