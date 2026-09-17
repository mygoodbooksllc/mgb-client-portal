// src/UploadIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function UploadIcon(props) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      width: "20",
      height: "20",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.7",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: [
        /* @__PURE__ */ jsx("path", { d: "M12 16V4M12 4l-4 4M12 4l4 4" }),
        /* @__PURE__ */ jsx("path", { d: "M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" })
      ]
    }
  );
}
export {
  UploadIcon
};
//# sourceMappingURL=UploadIcon.js.map
