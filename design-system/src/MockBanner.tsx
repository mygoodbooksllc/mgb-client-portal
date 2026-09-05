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
  return <div className="mock-banner">🧪 {text}</div>;
}
