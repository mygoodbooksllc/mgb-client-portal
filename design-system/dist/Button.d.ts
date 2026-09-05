import React from "react";
/** Props for {@link Button}. */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Visual style — "primary" is the solid navy pill (`.btn-primary`), "secondary" the outlined pill (`.btn-secondary`). Defaults to "primary". */
    variant?: "primary" | "secondary";
}
/**
 * Pill-shaped action button. Synthesized from the `.btn-primary` /
 * `.btn-secondary` classes used directly on `<button>` elements throughout
 * app.jsx (e.g. "Download PDF", "Export CSV", modal save/cancel actions) —
 * there was no single shared Button component in the original app.
 */
export declare function Button({ variant, className, children, ...rest }: ButtonProps): React.JSX.Element;
