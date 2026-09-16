// src/SearchIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function SearchIcon(props) {
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
        /* @__PURE__ */ jsx("circle", { cx: "10.5", cy: "10.5", r: "6.5" }),
        /* @__PURE__ */ jsx("path", { d: "M20 20l-4.8-4.8" })
      ]
    }
  );
}
export {
  SearchIcon
};
//# sourceMappingURL=SearchIcon.js.map
