// src/PaperclipIcon.tsx
import { jsx } from "react/jsx-runtime";
function PaperclipIcon(props) {
  return /* @__PURE__ */ jsx(
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
      children: /* @__PURE__ */ jsx("path", { d: "M17 7.5l-8 8a3 3 0 004.24 4.24l8-8a5 5 0 00-7.07-7.07l-8.2 8.2a7 7 0 009.9 9.9" })
    }
  );
}
export {
  PaperclipIcon
};
//# sourceMappingURL=PaperclipIcon.js.map
