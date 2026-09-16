// src/BarChartIcon.tsx
import { jsx } from "react/jsx-runtime";
function BarChartIcon(props) {
  return /* @__PURE__ */ jsx(
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
      children: /* @__PURE__ */ jsx("path", { d: "M4 20V10M9.5 20V4M15 20V13M20.5 20V7" })
    }
  );
}
export {
  BarChartIcon
};
//# sourceMappingURL=BarChartIcon.js.map
