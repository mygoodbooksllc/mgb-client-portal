// src/utils.ts
var fmtMoney = (n, opts = {}) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + "$" + abs.toLocaleString("en-US", {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0
  });
};

// src/AccountCashDonut.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var DEFAULT_DONUT_COLORS = ["var(--gold)", "var(--good)", "var(--bad)", "var(--gold-deep)"];
function AccountCashDonut({ accounts, colors = DEFAULT_DONUT_COLORS }) {
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  let cursor = 0;
  const stops = accounts.map((a, i) => {
    const pct = total > 0 ? a.balance / total * 100 : 0;
    const color = colors[i % colors.length];
    const stop = `${color} ${cursor}% ${cursor + pct}%`;
    cursor += pct;
    return stop;
  });
  return /* @__PURE__ */ jsxs("div", { className: "donut-widget compact", children: [
    /* @__PURE__ */ jsx("div", { className: "donut", style: { background: `conic-gradient(${stops.join(", ")})` }, children: /* @__PURE__ */ jsxs("div", { className: "donut-hole", children: [
      /* @__PURE__ */ jsx("span", { className: "donut-center-value", children: fmtMoney(total) }),
      /* @__PURE__ */ jsx("span", { className: "donut-center-label", children: "Total Cash" })
    ] }) }),
    /* @__PURE__ */ jsx("div", { className: "donut-legend", children: accounts.map((a, i) => /* @__PURE__ */ jsxs("div", { className: "donut-legend-row", children: [
      /* @__PURE__ */ jsx("span", { className: "legend-swatch", style: { background: colors[i % colors.length] } }),
      /* @__PURE__ */ jsx("span", { children: a.accountName }),
      /* @__PURE__ */ jsx("span", { className: "donut-legend-value", children: fmtMoney(a.balance) })
    ] }, a.id)) })
  ] });
}
export {
  AccountCashDonut
};
//# sourceMappingURL=AccountCashDonut.js.map
