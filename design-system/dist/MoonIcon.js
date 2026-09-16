// src/MoonIcon.tsx
import { jsx } from "react/jsx-runtime";
function MoonIcon(props) {
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
      children: /* @__PURE__ */ jsx("path", { d: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" })
    }
  );
}
export {
  MoonIcon
};
//# sourceMappingURL=MoonIcon.js.map
