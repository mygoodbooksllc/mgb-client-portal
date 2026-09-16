// src/HomeIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function HomeIcon(props) {
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
        /* @__PURE__ */ jsx("path", { d: "M4 11.5L12 4l8 7.5" }),
        /* @__PURE__ */ jsx("path", { d: "M6 10v9h12v-9" })
      ]
    }
  );
}
export {
  HomeIcon
};
//# sourceMappingURL=HomeIcon.js.map
