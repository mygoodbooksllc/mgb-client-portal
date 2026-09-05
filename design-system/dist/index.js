// src/utils.ts
var fmtMoney = (n, opts = {}) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + "$" + abs.toLocaleString("en-US", {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0
  });
};

// src/MockBanner.tsx
import { jsxs } from "react/jsx-runtime";
function MockBanner({ text }) {
  return /* @__PURE__ */ jsxs("div", { className: "mock-banner", children: [
    "\u{1F9EA} ",
    text
  ] });
}

// src/RunwayRing.tsx
import { jsx, jsxs as jsxs2 } from "react/jsx-runtime";
function RunwayRing({ pct, tone, children }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const trackColor = tone === "negative" ? "var(--bad-soft)" : "var(--good-soft)";
  const ringColor = tone === "negative" ? "var(--bad)" : "var(--good)";
  return /* @__PURE__ */ jsxs2("div", { className: "runway-ring-wrap", children: [
    /* @__PURE__ */ jsxs2("svg", { width: "108", height: "108", viewBox: "0 0 108 108", children: [
      /* @__PURE__ */ jsx("circle", { cx: "54", cy: "54", r, fill: "none", stroke: trackColor, strokeWidth: "9" }),
      /* @__PURE__ */ jsx(
        "circle",
        {
          cx: "54",
          cy: "54",
          r,
          fill: "none",
          stroke: ringColor,
          strokeWidth: "9",
          strokeLinecap: "round",
          strokeDasharray: c,
          strokeDashoffset: c * (1 - pct),
          transform: "rotate(-90 54 54)"
        }
      )
    ] }),
    /* @__PURE__ */ jsx("div", { className: "runway-ring-center", children })
  ] });
}

// src/TrendPill.tsx
import { jsxs as jsxs3 } from "react/jsx-runtime";
function trendInfo(current, prior, goodDir = "up") {
  if (prior == null || prior === 0) {
    return { dir: "flat", cls: "neutral", label: "no prior period on record", arrow: "\u2022" };
  }
  const pct = (current - prior) / Math.abs(prior) * 100;
  const dir = pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
  const cls = dir === "flat" ? "neutral" : dir === goodDir ? "positive" : "negative";
  const label = dir === "flat" ? "steady vs. prior period" : `${Math.abs(pct).toFixed(1)}% vs. prior period`;
  const arrow = dir === "up" ? "\u25B2" : dir === "down" ? "\u25BC" : "\u25CF";
  return { dir, cls, label, arrow };
}
function TrendPill({ current, prior, goodDir = "up" }) {
  const t = trendInfo(current, prior, goodDir);
  const pillClass = t.cls === "positive" ? "good" : t.cls === "negative" ? "bad" : "neutral";
  return /* @__PURE__ */ jsxs3("span", { className: "pill " + pillClass, children: [
    t.arrow,
    " ",
    t.label
  ] });
}

// src/AccountCashDonut.tsx
import { jsx as jsx2, jsxs as jsxs4 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs4("div", { className: "donut-widget compact", children: [
    /* @__PURE__ */ jsx2("div", { className: "donut", style: { background: `conic-gradient(${stops.join(", ")})` }, children: /* @__PURE__ */ jsxs4("div", { className: "donut-hole", children: [
      /* @__PURE__ */ jsx2("span", { className: "donut-center-value", children: fmtMoney(total) }),
      /* @__PURE__ */ jsx2("span", { className: "donut-center-label", children: "Total Cash" })
    ] }) }),
    /* @__PURE__ */ jsx2("div", { className: "donut-legend", children: accounts.map((a, i) => /* @__PURE__ */ jsxs4("div", { className: "donut-legend-row", children: [
      /* @__PURE__ */ jsx2("span", { className: "legend-swatch", style: { background: colors[i % colors.length] } }),
      /* @__PURE__ */ jsx2("span", { children: a.accountName }),
      /* @__PURE__ */ jsx2("span", { className: "donut-legend-value", children: fmtMoney(a.balance) })
    ] }, a.id)) })
  ] });
}

// src/IncomeExpenseChart.tsx
import { jsx as jsx3, jsxs as jsxs5 } from "react/jsx-runtime";
function smoothLinePath(points) {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    d += ` C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}
function smoothAreaPath(points, baseline) {
  let d = `M ${points[0].x} ${baseline} L ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    d += ` C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  d += ` L ${points[points.length - 1].x} ${baseline} Z`;
  return d;
}
function IncomeExpenseChart({ monthly }) {
  const width = 640;
  const height = 220;
  const padding = { top: 32, right: 14, bottom: 28, left: 46 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const baseline = padding.top + innerH;
  const maxVal = Math.max(...monthly.flatMap((m) => [m.income, m.expenses])) * 1.15;
  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => maxVal / yTicks * i);
  const xFor = (i) => padding.left + (monthly.length === 1 ? innerW / 2 : i / (monthly.length - 1) * innerW);
  const incomePoints = monthly.map((m, i) => ({ x: xFor(i), y: baseline - m.income / maxVal * innerH }));
  const expensePoints = monthly.map((m, i) => ({ x: xFor(i), y: baseline - m.expenses / maxVal * innerH }));
  const gradientId = `oc-income-fill-${monthly.length}-${Math.round(maxVal)}`;
  const gradientIdExp = `oc-expense-fill-${monthly.length}-${Math.round(maxVal)}`;
  return /* @__PURE__ */ jsx3("div", { className: "chart-wrap", children: /* @__PURE__ */ jsxs5("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%", preserveAspectRatio: "xMidYMid meet", children: [
    /* @__PURE__ */ jsxs5("defs", { children: [
      /* @__PURE__ */ jsxs5("linearGradient", { id: gradientId, x1: "0", y1: "0", x2: "0", y2: "1", children: [
        /* @__PURE__ */ jsx3("stop", { offset: "0%", stopColor: "var(--chart-income)", stopOpacity: "0.35" }),
        /* @__PURE__ */ jsx3("stop", { offset: "100%", stopColor: "var(--chart-income)", stopOpacity: "0.02" })
      ] }),
      /* @__PURE__ */ jsxs5("linearGradient", { id: gradientIdExp, x1: "0", y1: "0", x2: "0", y2: "1", children: [
        /* @__PURE__ */ jsx3("stop", { offset: "0%", stopColor: "var(--gold)", stopOpacity: "0.4" }),
        /* @__PURE__ */ jsx3("stop", { offset: "100%", stopColor: "var(--gold)", stopOpacity: "0.02" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs5("g", { className: "chart-inline-legend", children: [
      /* @__PURE__ */ jsx3("rect", { x: width - 190, y: "10", width: "10", height: "10", rx: "2", fill: "var(--chart-income)" }),
      /* @__PURE__ */ jsx3("text", { x: width - 176, y: "19", fontSize: "11.5", fill: "var(--text-muted)", children: "Income" }),
      /* @__PURE__ */ jsx3("rect", { x: width - 100, y: "10", width: "10", height: "10", rx: "2", fill: "var(--gold)" }),
      /* @__PURE__ */ jsx3("text", { x: width - 86, y: "19", fontSize: "11.5", fill: "var(--text-muted)", children: "Expenses" })
    ] }),
    tickVals.map((v, i) => {
      const y = padding.top + innerH - v / maxVal * innerH;
      return /* @__PURE__ */ jsxs5("g", { children: [
        /* @__PURE__ */ jsx3("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: "var(--border)", strokeWidth: "1" }),
        /* @__PURE__ */ jsx3("text", { x: padding.left - 8, y: y + 4, fontSize: "10.5", fill: "var(--text-muted)", textAnchor: "end", children: v >= 1e3 ? `${Math.round(v / 1e3)}k` : Math.round(v) })
      ] }, i);
    }),
    /* @__PURE__ */ jsx3("path", { d: smoothAreaPath(expensePoints, baseline), fill: `url(#${gradientIdExp})` }),
    /* @__PURE__ */ jsx3("path", { d: smoothLinePath(expensePoints), fill: "none", stroke: "var(--gold)", strokeWidth: "2" }),
    /* @__PURE__ */ jsx3("path", { d: smoothAreaPath(incomePoints, baseline), fill: `url(#${gradientId})` }),
    /* @__PURE__ */ jsx3("path", { d: smoothLinePath(incomePoints), fill: "none", stroke: "var(--chart-income)", strokeWidth: "2.5" }),
    incomePoints.map((p, i) => /* @__PURE__ */ jsx3("circle", { cx: p.x, cy: p.y, r: "3.5", fill: "var(--surface)", stroke: "var(--chart-income)", strokeWidth: "2" }, "i" + i)),
    expensePoints.map((p, i) => /* @__PURE__ */ jsx3("circle", { cx: p.x, cy: p.y, r: "3.5", fill: "var(--surface)", stroke: "var(--gold)", strokeWidth: "2" }, "e" + i)),
    monthly.map((m, i) => /* @__PURE__ */ jsx3("text", { x: xFor(i), y: height - 8, fontSize: "11.5", fill: "var(--text-muted)", textAnchor: "middle", children: m.month }, m.month))
  ] }) });
}

// src/ReportBarRows.tsx
import { jsx as jsx4, jsxs as jsxs6 } from "react/jsx-runtime";
function ReportBarRows({ items }) {
  const max = Math.max(...items.map((i) => Math.abs(i.amount)), 1);
  return /* @__PURE__ */ jsx4("div", { className: "rb-bar-rows", children: items.map((item) => /* @__PURE__ */ jsxs6("div", { className: "rb-bar-row", children: [
    /* @__PURE__ */ jsx4("span", { children: item.label }),
    /* @__PURE__ */ jsx4("div", { className: "bar-track", children: /* @__PURE__ */ jsx4(
      "div",
      {
        className: "bar-fill " + (item.tone || "rb-bar-fill"),
        style: { width: `${Math.max(4, Math.round(Math.abs(item.amount) / max * 100))}%` }
      }
    ) }),
    /* @__PURE__ */ jsx4("span", { className: "rb-bar-amt", children: fmtMoney(item.amount) })
  ] }, item.label)) });
}

// src/Card.tsx
import { jsx as jsx5 } from "react/jsx-runtime";
function Card({ className, children, ...rest }) {
  return /* @__PURE__ */ jsx5("div", { className: "card" + (className ? " " + className : ""), ...rest, children });
}
function CardTitle({ className, children, ...rest }) {
  return /* @__PURE__ */ jsx5("h3", { className: "card-title" + (className ? " " + className : ""), ...rest, children });
}
function CardSubtitle({ className, children, ...rest }) {
  return /* @__PURE__ */ jsx5("p", { className: "card-subtitle" + (className ? " " + className : ""), ...rest, children });
}

// src/Button.tsx
import { jsx as jsx6 } from "react/jsx-runtime";
function Button({ variant = "primary", className, children, ...rest }) {
  const base = variant === "secondary" ? "btn-secondary" : "btn-primary";
  return /* @__PURE__ */ jsx6("button", { className: base + (className ? " " + className : ""), ...rest, children });
}

// src/Badge.tsx
import { jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
function Badge({ label, className }) {
  return /* @__PURE__ */ jsxs7("span", { className: "badge-live" + (className ? " " + className : ""), children: [
    /* @__PURE__ */ jsx7("span", { className: "badge-dot" }),
    label
  ] });
}

// src/ToastProvider.tsx
import { createContext, useContext, useState } from "react";
import { jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
var ToastContext = createContext(() => {
});
var useToast = () => useContext(ToastContext);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const showToast = (text) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };
  return /* @__PURE__ */ jsxs8(ToastContext.Provider, { value: showToast, children: [
    children,
    /* @__PURE__ */ jsx8("div", { className: "toast-stack", children: toasts.map((t) => /* @__PURE__ */ jsx8("div", { className: "toast", children: t.text }, t.id)) })
  ] });
}
export {
  AccountCashDonut,
  Badge,
  Button,
  Card,
  CardSubtitle,
  CardTitle,
  IncomeExpenseChart,
  MockBanner,
  ReportBarRows,
  RunwayRing,
  ToastProvider,
  TrendPill,
  fmtMoney,
  useToast
};
//# sourceMappingURL=index.js.map
