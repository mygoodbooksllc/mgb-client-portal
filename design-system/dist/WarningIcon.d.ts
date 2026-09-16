import React from "react";
/** Props for {@link WarningIcon}. Any native `<svg>` attribute (width, height,
 * strokeWidth, style, ...) can be passed through and overrides the default. */
export type WarningIconProps = React.SVGProps<SVGSVGElement>;
/**
 * Warning triangle. Thin-line, `stroke="currentColor"` — the house icon
 * style used throughout the app instead of emoji. Used in Staff Access's and
 * Client Roster's "writes directly to the real table" banners.
 */
export declare function WarningIcon(props: WarningIconProps): React.JSX.Element;
