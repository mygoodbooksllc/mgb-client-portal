import React from "react";
type ShowToast = (text: string) => void;
/** Hook returning a `showToast(text)` function, for use inside a {@link ToastProvider}. */
export declare const useToast: () => ShowToast;
/** Props for {@link ToastProvider}. */
export interface ToastProviderProps {
    children?: React.ReactNode;
}
/**
 * Provides `useToast()` to its subtree and renders the resulting toast
 * stack, bottom-right, each auto-dismissing after 3.2s. Ported as-is from
 * app.jsx — it was already self-contained (own context, own state).
 */
export declare function ToastProvider({ children }: ToastProviderProps): React.JSX.Element;
export {};
