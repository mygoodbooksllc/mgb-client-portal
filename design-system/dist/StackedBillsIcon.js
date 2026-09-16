// src/StackedBillsIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function StackedBillsIcon(props) {
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
        /* @__PURE__ */ jsx("rect", { x: "4", y: "4", width: "14", height: "10", rx: "1.5" }),
        /* @__PURE__ */ jsx("rect", { x: "7", y: "9", width: "14", height: "10", rx: "1.5" })
      ]
    }
  );
}
export {
  StackedBillsIcon
};
//# sourceMappingURL=StackedBillsIcon.js.map
