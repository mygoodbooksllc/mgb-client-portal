// src/LightbulbIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function LightbulbIcon(props) {
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
        /* @__PURE__ */ jsx("path", { d: "M9 18h6M10 21h4" }),
        /* @__PURE__ */ jsx("path", { d: "M12 3a6 6 0 00-3.6 10.8c.6.45 1.1 1.2 1.1 2.2h5c0-1 .5-1.75 1.1-2.2A6 6 0 0012 3z" })
      ]
    }
  );
}
export {
  LightbulbIcon
};
//# sourceMappingURL=LightbulbIcon.js.map
