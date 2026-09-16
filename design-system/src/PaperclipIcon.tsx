import React from "react";

/** Props for {@link PaperclipIcon}. Any native `<svg>` attribute can be
 * passed through and overrides the default. */
export type PaperclipIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Paperclip. Thin-line, `stroke="currentColor"` house style. Used for
 * message attachments (the compose bar's attach button, the pending-
 * attachment chip, and an attachment already sent in a thread).
 */
export function PaperclipIcon(props: PaperclipIconProps) {
  return (
    <svg
      className="icon-inline"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M17 7.5l-8 8a3 3 0 004.24 4.24l8-8a5 5 0 00-7.07-7.07l-8.2 8.2a7 7 0 009.9 9.9" />
    </svg>
  );
}
