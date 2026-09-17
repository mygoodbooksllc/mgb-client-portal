// src/FileIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function FileIcon(props) {
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
        /* @__PURE__ */ jsx("path", { d: "M6 3h8l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" }),
        /* @__PURE__ */ jsx("path", { d: "M14 3v5h5" })
      ]
    }
  );
}
export {
  FileIcon
};
//# sourceMappingURL=FileIcon.js.map
