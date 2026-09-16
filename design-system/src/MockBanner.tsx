import React from "react";

/** Props for {@link MockBanner}. */
export interface MockBannerProps {
  /** Explanatory text shown next to the flask icon (e.g. what data on this page is fabricated). */
  text: string;
}

/**
 * Small inline banner used at the top of pages built on prototype/sample
 * data, to make clear to the viewer that the numbers aren't live yet.
 */
export function MockBanner({ text }: MockBannerProps) {
  return (
    <div className="mock-banner">
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
      >
        <path d="M9 3h6M10 3v6.5L4.8 18a2 2 0 001.7 3h11a2 2 0 001.7-3L14 9.5V3" />
        <path d="M7.5 15h9" />
      </svg>{" "}
      {text}
    </div>
  );
}
