// src/PieChartIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function PieChartIcon(props) {
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
        /* @__PURE__ */ jsx("path", { d: "M12 12V3a9 9 0 019 9h-9z" }),
        /* @__PURE__ */ jsx("path", { d: "M20.5 15A9 9 0 1112 3v9l8.5 3z" })
      ]
    }
  );
}
export {
  PieChartIcon
};
//# sourceMappingURL=PieChartIcon.js.map
