import React from "react";
/** Props for {@link ChatIcon}. Any native `<svg>` attribute can be passed
 * through and overrides the default. */
export type ChatIconProps = React.SVGProps<SVGSVGElement>;
/**
 * Chat bubble. Thin-line, `stroke="currentColor"` house style. Used by the
 * desktop floating chat widget's header and the mobile chat FAB.
 */
export declare function ChatIcon(props: ChatIconProps): React.JSX.Element;
