import React, { createContext, useContext, useState } from "react";

type ShowToast = (text: string) => void;

const ToastContext = createContext<ShowToast>(() => {});

/** Hook returning a `showToast(text)` function, for use inside a {@link ToastProvider}. */
export const useToast = (): ShowToast => useContext(ToastContext);

/** Props for {@link ToastProvider}. */
export interface ToastProviderProps {
  children?: React.ReactNode;
}

interface ToastItem {
  id: number;
  text: string;
}

/**
 * Provides `useToast()` to its subtree and renders the resulting toast
 * stack, bottom-right, each auto-dismissing after 3.2s. Ported as-is from
 * app.jsx — it was already self-contained (own context, own state).
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast: ShowToast = (text) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
