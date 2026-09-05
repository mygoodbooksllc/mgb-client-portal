// src/Card.tsx
import { jsx } from "react/jsx-runtime";
function Card({ className, children, ...rest }) {
  return /* @__PURE__ */ jsx("div", { className: "card" + (className ? " " + className : ""), ...rest, children });
}
function CardTitle({ className, children, ...rest }) {
  return /* @__PURE__ */ jsx("h3", { className: "card-title" + (className ? " " + className : ""), ...rest, children });
}
function CardSubtitle({ className, children, ...rest }) {
  return /* @__PURE__ */ jsx("p", { className: "card-subtitle" + (className ? " " + className : ""), ...rest, children });
}
export {
  Card,
  CardSubtitle,
  CardTitle
};
//# sourceMappingURL=Card.js.map
