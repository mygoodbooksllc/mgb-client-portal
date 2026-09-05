// src/Badge.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function Badge({ label, className }) {
  return /* @__PURE__ */ jsxs("span", { className: "badge-live" + (className ? " " + className : ""), children: [
    /* @__PURE__ */ jsx("span", { className: "badge-dot" }),
    label
  ] });
}
export {
  Badge
};
//# sourceMappingURL=Badge.js.map
