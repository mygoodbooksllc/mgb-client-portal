import React from "react";
/** Props for {@link LightbulbIcon}. Any native `<svg>` attribute can be
 * passed through and overrides the default. */
export type LightbulbIconProps = React.SVGProps<SVGSVGElement>;
/**
 * Lightbulb. Thin-line, `stroke="currentColor"` house style. Used by the
 * Daily Report's 90-day forecast callout (`components/daily-close/
 * DailyClose.tsx`, a vendored component with its own styling scope, so it
 * keeps its own inline copy of this icon rather than importing from here —
 * this export exists so the icon is still part of the shared set).
 */
export declare function LightbulbIcon(props: LightbulbIconProps): React.JSX.Element;
