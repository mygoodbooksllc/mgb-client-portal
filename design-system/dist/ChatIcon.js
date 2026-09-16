// src/ChatIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function ChatIcon(props) {
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
        /* @__PURE__ */ jsx("path", { d: "M4 5h16v11H8l-4 4V5z" }),
        /* @__PURE__ */ jsx("path", { d: "M8 10h8M8 13h5" })
      ]
    }
  );
}
export {
  ChatIcon
};
//# sourceMappingURL=ChatIcon.js.map
