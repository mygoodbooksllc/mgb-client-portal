// src/utils.ts
var fmtMoney = (n, opts = {}) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + "$" + abs.toLocaleString("en-US", {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0
  });
};

// src/ReportBarRows.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function ReportBarRows({ items }) {
  const max = Math.max(...items.map((i) => Math.abs(i.amount)), 1);
  return /* @__PURE__ */ jsx("div", { className: "rb-bar-rows", children: items.map((item) => /* @__PURE__ */ jsxs("div", { className: "rb-bar-row", children: [
    /* @__PURE__ */ jsx("span", { children: item.label }),
    /* @__PURE__ */ jsx("div", { className: "bar-track", children: /* @__PURE__ */ jsx(
      "div",
      {
        className: "bar-fill " + (item.tone || "rb-bar-fill"),
        style: { width: `${Math.max(4, Math.round(Math.abs(item.amount) / max * 100))}%` }
      }
    ) }),
    /* @__PURE__ */ jsx("span", { className: "rb-bar-amt", children: fmtMoney(item.amount) })
  ] }, item.label)) });
}
export {
  ReportBarRows
};
//# sourceMappingURL=ReportBarRows.js.map
