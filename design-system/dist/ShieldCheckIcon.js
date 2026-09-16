// src/ShieldCheckIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function ShieldCheckIcon(props) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      width: "22",
      height: "22",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.6",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: [
        /* @__PURE__ */ jsx("path", { d: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" }),
        /* @__PURE__ */ jsx("path", { d: "M9 12l2 2 4-4" })
      ]
    }
  );
}
export {
  ShieldCheckIcon
};
//# sourceMappingURL=ShieldCheckIcon.js.map
