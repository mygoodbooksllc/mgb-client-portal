// src/SunIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function SunIcon(props) {
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
        /* @__PURE__ */ jsx("circle", { cx: "12", cy: "12", r: "4.5" }),
        /* @__PURE__ */ jsx("path", { d: "M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" })
      ]
    }
  );
}
export {
  SunIcon
};
//# sourceMappingURL=SunIcon.js.map
