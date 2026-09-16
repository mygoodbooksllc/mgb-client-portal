// src/BankIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function BankIcon(props) {
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
        /* @__PURE__ */ jsx("path", { d: "M3 10l9-6 9 6" }),
        /* @__PURE__ */ jsx("path", { d: "M5 10v9M10 10v9M14 10v9M19 10v9" }),
        /* @__PURE__ */ jsx("path", { d: "M3 19h18" })
      ]
    }
  );
}
export {
  BankIcon
};
//# sourceMappingURL=BankIcon.js.map
