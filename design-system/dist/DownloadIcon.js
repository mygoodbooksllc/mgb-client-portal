// src/DownloadIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function DownloadIcon(props) {
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
        /* @__PURE__ */ jsx("path", { d: "M12 3v13M7 12l5 5 5-5" }),
        /* @__PURE__ */ jsx("path", { d: "M4 20h16" })
      ]
    }
  );
}
export {
  DownloadIcon
};
//# sourceMappingURL=DownloadIcon.js.map
