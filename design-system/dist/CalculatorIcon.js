// src/CalculatorIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function CalculatorIcon(props) {
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
        /* @__PURE__ */ jsx("rect", { x: "5", y: "3", width: "14", height: "18", rx: "2" }),
        /* @__PURE__ */ jsx("path", { d: "M8 8h8M8 12h1M12 12h1M16 12h1M8 16h1M12 16h1M16 16h1" })
      ]
    }
  );
}
export {
  CalculatorIcon
};
//# sourceMappingURL=CalculatorIcon.js.map
