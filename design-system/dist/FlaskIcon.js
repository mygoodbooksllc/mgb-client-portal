// src/FlaskIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function FlaskIcon(props) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      className: "icon-inline",
      width: "15",
      height: "15",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.8",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: [
        /* @__PURE__ */ jsx("path", { d: "M9 3h6M10 3v6.5L4.8 18a2 2 0 001.7 3h11a2 2 0 001.7-3L14 9.5V3" }),
        /* @__PURE__ */ jsx("path", { d: "M7.5 15h9" })
      ]
    }
  );
}
export {
  FlaskIcon
};
//# sourceMappingURL=FlaskIcon.js.map
