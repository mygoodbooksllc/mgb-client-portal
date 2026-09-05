// src/ToastProvider.tsx
import { createContext, useContext, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var ToastContext = createContext(() => {
});
var useToast = () => useContext(ToastContext);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const showToast = (text) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };
  return /* @__PURE__ */ jsxs(ToastContext.Provider, { value: showToast, children: [
    children,
    /* @__PURE__ */ jsx("div", { className: "toast-stack", children: toasts.map((t) => /* @__PURE__ */ jsx("div", { className: "toast", children: t.text }, t.id)) })
  ] });
}
export {
  ToastProvider,
  useToast
};
//# sourceMappingURL=ToastProvider.js.map
