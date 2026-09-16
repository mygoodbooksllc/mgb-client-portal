// src/SwapIcon.tsx
import { jsx } from "react/jsx-runtime";
function SwapIcon(props) {
  return /* @__PURE__ */ jsx(
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
      children: /* @__PURE__ */ jsx("path", { d: "M7 7h11l-3-3M17 17H6l3 3" })
    }
  );
}
export {
  SwapIcon
};
//# sourceMappingURL=SwapIcon.js.map
