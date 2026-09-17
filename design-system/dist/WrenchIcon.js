// src/WrenchIcon.tsx
import { jsx } from "react/jsx-runtime";
function WrenchIcon(props) {
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
      children: /* @__PURE__ */ jsx("path", { d: "M14.7 6.3a4 4 0 00-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 005.4-5.4l-2.6 2.6-2-2z" })
    }
  );
}
export {
  WrenchIcon
};
//# sourceMappingURL=WrenchIcon.js.map
