// src/SlidersIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function SlidersIcon(props) {
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
        /* @__PURE__ */ jsx("path", { d: "M4 6h10M17 6h3M4 12h3M9 12h11M4 18h13M20 18h0" }),
        /* @__PURE__ */ jsx("circle", { cx: "14", cy: "6", r: "2" }),
        /* @__PURE__ */ jsx("circle", { cx: "6", cy: "12", r: "2" }),
        /* @__PURE__ */ jsx("circle", { cx: "16", cy: "18", r: "2" })
      ]
    }
  );
}
export {
  SlidersIcon
};
//# sourceMappingURL=SlidersIcon.js.map
