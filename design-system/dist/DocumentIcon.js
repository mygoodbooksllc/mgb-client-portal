// src/DocumentIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function DocumentIcon(props) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      width: "22",
      height: "22",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.6",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: [
        /* @__PURE__ */ jsx("rect", { x: "5", y: "3", width: "14", height: "18", rx: "2" }),
        /* @__PURE__ */ jsx("path", { d: "M9 8h6M9 12h6M9 16h4" })
      ]
    }
  );
}
export {
  DocumentIcon
};
//# sourceMappingURL=DocumentIcon.js.map
