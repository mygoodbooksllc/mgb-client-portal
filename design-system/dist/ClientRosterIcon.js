// src/ClientRosterIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function ClientRosterIcon(props) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      width: "16",
      height: "16",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.8",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: [
        /* @__PURE__ */ jsx("rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }),
        /* @__PURE__ */ jsx("path", { d: "M3 9h18M8 4v5" })
      ]
    }
  );
}
export {
  ClientRosterIcon
};
//# sourceMappingURL=ClientRosterIcon.js.map
