// src/LockIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function LockIcon(props) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      className: "icon-inline",
      width: "14",
      height: "14",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.8",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: [
        /* @__PURE__ */ jsx("rect", { x: "5", y: "11", width: "14", height: "9", rx: "2" }),
        /* @__PURE__ */ jsx("path", { d: "M8 11V7a4 4 0 0 1 8 0v4" })
      ]
    }
  );
}
export {
  LockIcon
};
//# sourceMappingURL=LockIcon.js.map
