// src/WarningIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function WarningIcon(props) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      className: "icon-inline",
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
        /* @__PURE__ */ jsx("path", { d: "M12 4l9.5 16.5H2.5L12 4z" }),
        /* @__PURE__ */ jsx("path", { d: "M12 10v4.5M12 17.5h.01" })
      ]
    }
  );
}
export {
  WarningIcon
};
//# sourceMappingURL=WarningIcon.js.map
