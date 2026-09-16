import React from "react";

/** Props for {@link ChatIcon}. Any native `<svg>` attribute can be passed
 * through and overrides the default. */
export type ChatIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Chat bubble. Thin-line, `stroke="currentColor"` house style. Used by the
 * desktop floating chat widget's header and the mobile chat FAB.
 */
export function ChatIcon(props: ChatIconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 5h16v11H8l-4 4V5z" />
      <path d="M8 10h8M8 13h5" />
    </svg>
  );
}
