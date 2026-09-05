// src/Button.tsx
import { jsx } from "react/jsx-runtime";
function Button({ variant = "primary", className, children, ...rest }) {
  const base = variant === "secondary" ? "btn-secondary" : "btn-primary";
  return /* @__PURE__ */ jsx("button", { className: base + (className ? " " + className : ""), ...rest, children });
}
export {
  Button
};
//# sourceMappingURL=Button.js.map
