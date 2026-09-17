// src/utils.ts
var fmtMoney = (n, opts = {}) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + "$" + abs.toLocaleString("en-US", {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0
  });
};

// src/FlaskIcon.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function FlaskIcon(props) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      className: "icon-inline",
      width: "15",
      height: "15",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.8",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: [
        /* @__PURE__ */ jsx("path", { d: "M9 3h6M10 3v6.5L4.8 18a2 2 0 001.7 3h11a2 2 0 001.7-3L14 9.5V3" }),
        /* @__PURE__ */ jsx("path", { d: "M7.5 15h9" })
      ]
    }
  );
}

// src/MockBanner.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function MockBanner({ text }) {
  return /* @__PURE__ */ jsxs2("div", { className: "mock-banner", children: [
    /* @__PURE__ */ jsx2(FlaskIcon, {}),
    " ",
    text
  ] });
}

// src/RunwayRing.tsx
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function RunwayRing({ pct, tone, children }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const trackColor = tone === "negative" ? "var(--bad-soft)" : "var(--good-soft)";
  const ringColor = tone === "negative" ? "var(--bad)" : "var(--good)";
  return /* @__PURE__ */ jsxs3("div", { className: "runway-ring-wrap", children: [
    /* @__PURE__ */ jsxs3("svg", { width: "108", height: "108", viewBox: "0 0 108 108", children: [
      /* @__PURE__ */ jsx3("circle", { cx: "54", cy: "54", r, fill: "none", stroke: trackColor, strokeWidth: "9" }),
      /* @__PURE__ */ jsx3(
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
    /* @__PURE__ */ jsx3("div", { className: "runway-ring-center", children })
  ] });
}

// src/TrendPill.tsx
import { jsxs as jsxs4 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs4("span", { className: "pill " + pillClass, children: [
    t.arrow,
    " ",
    t.label
  ] });
}

// src/AccountCashDonut.tsx
import { jsx as jsx4, jsxs as jsxs5 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs5("div", { className: "donut-widget compact", children: [
    /* @__PURE__ */ jsx4("div", { className: "donut", style: { background: `conic-gradient(${stops.join(", ")})` }, children: /* @__PURE__ */ jsxs5("div", { className: "donut-hole", children: [
      /* @__PURE__ */ jsx4("span", { className: "donut-center-value", children: fmtMoney(total) }),
      /* @__PURE__ */ jsx4("span", { className: "donut-center-label", children: "Total Cash" })
    ] }) }),
    /* @__PURE__ */ jsx4("div", { className: "donut-legend", children: accounts.map((a, i) => /* @__PURE__ */ jsxs5("div", { className: "donut-legend-row", children: [
      /* @__PURE__ */ jsx4("span", { className: "legend-swatch", style: { background: colors[i % colors.length] } }),
      /* @__PURE__ */ jsx4("span", { children: a.accountName }),
      /* @__PURE__ */ jsx4("span", { className: "donut-legend-value", children: fmtMoney(a.balance) })
    ] }, a.id)) })
  ] });
}

// src/IncomeExpenseChart.tsx
import { jsx as jsx5, jsxs as jsxs6 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsx5("div", { className: "chart-wrap", children: /* @__PURE__ */ jsxs6("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%", preserveAspectRatio: "xMidYMid meet", children: [
    /* @__PURE__ */ jsxs6("defs", { children: [
      /* @__PURE__ */ jsxs6("linearGradient", { id: gradientId, x1: "0", y1: "0", x2: "0", y2: "1", children: [
        /* @__PURE__ */ jsx5("stop", { offset: "0%", stopColor: "var(--chart-income)", stopOpacity: "0.35" }),
        /* @__PURE__ */ jsx5("stop", { offset: "100%", stopColor: "var(--chart-income)", stopOpacity: "0.02" })
      ] }),
      /* @__PURE__ */ jsxs6("linearGradient", { id: gradientIdExp, x1: "0", y1: "0", x2: "0", y2: "1", children: [
        /* @__PURE__ */ jsx5("stop", { offset: "0%", stopColor: "var(--gold)", stopOpacity: "0.4" }),
        /* @__PURE__ */ jsx5("stop", { offset: "100%", stopColor: "var(--gold)", stopOpacity: "0.02" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs6("g", { className: "chart-inline-legend", children: [
      /* @__PURE__ */ jsx5("rect", { x: width - 190, y: "10", width: "10", height: "10", rx: "2", fill: "var(--chart-income)" }),
      /* @__PURE__ */ jsx5("text", { x: width - 176, y: "19", fontSize: "11.5", fill: "var(--text-muted)", children: "Income" }),
      /* @__PURE__ */ jsx5("rect", { x: width - 100, y: "10", width: "10", height: "10", rx: "2", fill: "var(--gold)" }),
      /* @__PURE__ */ jsx5("text", { x: width - 86, y: "19", fontSize: "11.5", fill: "var(--text-muted)", children: "Expenses" })
    ] }),
    tickVals.map((v, i) => {
      const y = padding.top + innerH - v / maxVal * innerH;
      return /* @__PURE__ */ jsxs6("g", { children: [
        /* @__PURE__ */ jsx5("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: "var(--border)", strokeWidth: "1" }),
        /* @__PURE__ */ jsx5("text", { x: padding.left - 8, y: y + 4, fontSize: "10.5", fill: "var(--text-muted)", textAnchor: "end", children: v >= 1e3 ? `${Math.round(v / 1e3)}k` : Math.round(v) })
      ] }, i);
    }),
    /* @__PURE__ */ jsx5("path", { d: smoothAreaPath(expensePoints, baseline), fill: `url(#${gradientIdExp})` }),
    /* @__PURE__ */ jsx5("path", { d: smoothLinePath(expensePoints), fill: "none", stroke: "var(--gold)", strokeWidth: "2" }),
    /* @__PURE__ */ jsx5("path", { d: smoothAreaPath(incomePoints, baseline), fill: `url(#${gradientId})` }),
    /* @__PURE__ */ jsx5("path", { d: smoothLinePath(incomePoints), fill: "none", stroke: "var(--chart-income)", strokeWidth: "2.5" }),
    incomePoints.map((p, i) => /* @__PURE__ */ jsx5("circle", { cx: p.x, cy: p.y, r: "3.5", fill: "var(--surface)", stroke: "var(--chart-income)", strokeWidth: "2" }, "i" + i)),
    expensePoints.map((p, i) => /* @__PURE__ */ jsx5("circle", { cx: p.x, cy: p.y, r: "3.5", fill: "var(--surface)", stroke: "var(--gold)", strokeWidth: "2" }, "e" + i)),
    monthly.map((m, i) => /* @__PURE__ */ jsx5("text", { x: xFor(i), y: height - 8, fontSize: "11.5", fill: "var(--text-muted)", textAnchor: "middle", children: m.month }, m.month))
  ] }) });
}

// src/ReportBarRows.tsx
import { jsx as jsx6, jsxs as jsxs7 } from "react/jsx-runtime";
function ReportBarRows({ items }) {
  const max = Math.max(...items.map((i) => Math.abs(i.amount)), 1);
  return /* @__PURE__ */ jsx6("div", { className: "rb-bar-rows", children: items.map((item) => /* @__PURE__ */ jsxs7("div", { className: "rb-bar-row", children: [
    /* @__PURE__ */ jsx6("span", { children: item.label }),
    /* @__PURE__ */ jsx6("div", { className: "bar-track", children: /* @__PURE__ */ jsx6(
      "div",
      {
        className: "bar-fill " + (item.tone || "rb-bar-fill"),
        style: { width: `${Math.max(4, Math.round(Math.abs(item.amount) / max * 100))}%` }
      }
    ) }),
    /* @__PURE__ */ jsx6("span", { className: "rb-bar-amt", children: fmtMoney(item.amount) })
  ] }, item.label)) });
}

// src/Card.tsx
import { jsx as jsx7 } from "react/jsx-runtime";
function Card({ className, children, ...rest }) {
  return /* @__PURE__ */ jsx7("div", { className: "card" + (className ? " " + className : ""), ...rest, children });
}
function CardTitle({ className, children, ...rest }) {
  return /* @__PURE__ */ jsx7("h3", { className: "card-title" + (className ? " " + className : ""), ...rest, children });
}
function CardSubtitle({ className, children, ...rest }) {
  return /* @__PURE__ */ jsx7("p", { className: "card-subtitle" + (className ? " " + className : ""), ...rest, children });
}

// src/Button.tsx
import { jsx as jsx8 } from "react/jsx-runtime";
function Button({ variant = "primary", className, children, ...rest }) {
  const base = variant === "secondary" ? "btn-secondary" : "btn-primary";
  return /* @__PURE__ */ jsx8("button", { className: base + (className ? " " + className : ""), ...rest, children });
}

// src/Badge.tsx
import { jsx as jsx9, jsxs as jsxs8 } from "react/jsx-runtime";
function Badge({ label, className }) {
  return /* @__PURE__ */ jsxs8("span", { className: "badge-live" + (className ? " " + className : ""), children: [
    /* @__PURE__ */ jsx9("span", { className: "badge-dot" }),
    label
  ] });
}

// src/ToastProvider.tsx
import { createContext, useContext, useState } from "react";
import { jsx as jsx10, jsxs as jsxs9 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs9(ToastContext.Provider, { value: showToast, children: [
    children,
    /* @__PURE__ */ jsx10("div", { className: "toast-stack", children: toasts.map((t) => /* @__PURE__ */ jsx10("div", { className: "toast", children: t.text }, t.id)) })
  ] });
}

// src/WarningIcon.tsx
import { jsx as jsx11, jsxs as jsxs10 } from "react/jsx-runtime";
function WarningIcon(props) {
  return /* @__PURE__ */ jsxs10(
    "svg",
    {
      className: "icon-inline",
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
        /* @__PURE__ */ jsx11("path", { d: "M12 4l9.5 16.5H2.5L12 4z" }),
        /* @__PURE__ */ jsx11("path", { d: "M12 10v4.5M12 17.5h.01" })
      ]
    }
  );
}

// src/SearchIcon.tsx
import { jsx as jsx12, jsxs as jsxs11 } from "react/jsx-runtime";
function SearchIcon(props) {
  return /* @__PURE__ */ jsxs11(
    "svg",
    {
      className: "icon-inline",
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
        /* @__PURE__ */ jsx12("circle", { cx: "10.5", cy: "10.5", r: "6.5" }),
        /* @__PURE__ */ jsx12("path", { d: "M20 20l-4.8-4.8" })
      ]
    }
  );
}

// src/LockIcon.tsx
import { jsx as jsx13, jsxs as jsxs12 } from "react/jsx-runtime";
function LockIcon(props) {
  return /* @__PURE__ */ jsxs12(
    "svg",
    {
      className: "icon-inline",
      width: "14",
      height: "14",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.8",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: [
        /* @__PURE__ */ jsx13("rect", { x: "5", y: "11", width: "14", height: "9", rx: "2" }),
        /* @__PURE__ */ jsx13("path", { d: "M8 11V7a4 4 0 0 1 8 0v4" })
      ]
    }
  );
}

// src/PaperclipIcon.tsx
import { jsx as jsx14 } from "react/jsx-runtime";
function PaperclipIcon(props) {
  return /* @__PURE__ */ jsx14(
    "svg",
    {
      className: "icon-inline",
      width: "15",
      height: "15",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.8",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: /* @__PURE__ */ jsx14("path", { d: "M17 7.5l-8 8a3 3 0 004.24 4.24l8-8a5 5 0 00-7.07-7.07l-8.2 8.2a7 7 0 009.9 9.9" })
    }
  );
}

// src/SunIcon.tsx
import { jsx as jsx15, jsxs as jsxs13 } from "react/jsx-runtime";
function SunIcon(props) {
  return /* @__PURE__ */ jsxs13(
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
        /* @__PURE__ */ jsx15("circle", { cx: "12", cy: "12", r: "4.5" }),
        /* @__PURE__ */ jsx15("path", { d: "M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" })
      ]
    }
  );
}

// src/MoonIcon.tsx
import { jsx as jsx16 } from "react/jsx-runtime";
function MoonIcon(props) {
  return /* @__PURE__ */ jsx16(
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
      children: /* @__PURE__ */ jsx16("path", { d: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" })
    }
  );
}

// src/SlidersIcon.tsx
import { jsx as jsx17, jsxs as jsxs14 } from "react/jsx-runtime";
function SlidersIcon(props) {
  return /* @__PURE__ */ jsxs14(
    "svg",
    {
      className: "icon-inline",
      width: "15",
      height: "15",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.8",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: [
        /* @__PURE__ */ jsx17("path", { d: "M4 6h10M17 6h3M4 12h3M9 12h11M4 18h13M20 18h0" }),
        /* @__PURE__ */ jsx17("circle", { cx: "14", cy: "6", r: "2" }),
        /* @__PURE__ */ jsx17("circle", { cx: "6", cy: "12", r: "2" }),
        /* @__PURE__ */ jsx17("circle", { cx: "16", cy: "18", r: "2" })
      ]
    }
  );
}

// src/ChatIcon.tsx
import { jsx as jsx18, jsxs as jsxs15 } from "react/jsx-runtime";
function ChatIcon(props) {
  return /* @__PURE__ */ jsxs15(
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
        /* @__PURE__ */ jsx18("path", { d: "M4 5h16v11H8l-4 4V5z" }),
        /* @__PURE__ */ jsx18("path", { d: "M8 10h8M8 13h5" })
      ]
    }
  );
}

// src/DocumentIcon.tsx
import { jsx as jsx19, jsxs as jsxs16 } from "react/jsx-runtime";
function DocumentIcon(props) {
  return /* @__PURE__ */ jsxs16(
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
        /* @__PURE__ */ jsx19("rect", { x: "5", y: "3", width: "14", height: "18", rx: "2" }),
        /* @__PURE__ */ jsx19("path", { d: "M9 8h6M9 12h6M9 16h4" })
      ]
    }
  );
}

// src/BarChartIcon.tsx
import { jsx as jsx20 } from "react/jsx-runtime";
function BarChartIcon(props) {
  return /* @__PURE__ */ jsx20(
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
      children: /* @__PURE__ */ jsx20("path", { d: "M4 20V10M9.5 20V4M15 20V13M20.5 20V7" })
    }
  );
}

// src/ShieldCheckIcon.tsx
import { jsx as jsx21, jsxs as jsxs17 } from "react/jsx-runtime";
function ShieldCheckIcon(props) {
  return /* @__PURE__ */ jsxs17(
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
        /* @__PURE__ */ jsx21("path", { d: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" }),
        /* @__PURE__ */ jsx21("path", { d: "M9 12l2 2 4-4" })
      ]
    }
  );
}

// src/LightbulbIcon.tsx
import { jsx as jsx22, jsxs as jsxs18 } from "react/jsx-runtime";
function LightbulbIcon(props) {
  return /* @__PURE__ */ jsxs18(
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
        /* @__PURE__ */ jsx22("path", { d: "M9 18h6M10 21h4" }),
        /* @__PURE__ */ jsx22("path", { d: "M12 3a6 6 0 00-3.6 10.8c.6.45 1.1 1.2 1.1 2.2h5c0-1 .5-1.75 1.1-2.2A6 6 0 0012 3z" })
      ]
    }
  );
}

// src/HomeIcon.tsx
import { jsx as jsx23, jsxs as jsxs19 } from "react/jsx-runtime";
function HomeIcon(props) {
  return /* @__PURE__ */ jsxs19(
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
        /* @__PURE__ */ jsx23("path", { d: "M4 11.5L12 4l8 7.5" }),
        /* @__PURE__ */ jsx23("path", { d: "M6 10v9h12v-9" })
      ]
    }
  );
}

// src/UsersIcon.tsx
import { jsx as jsx24, jsxs as jsxs20 } from "react/jsx-runtime";
function UsersIcon(props) {
  return /* @__PURE__ */ jsxs20(
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
        /* @__PURE__ */ jsx24("circle", { cx: "9", cy: "8", r: "3" }),
        /* @__PURE__ */ jsx24("path", { d: "M2 20c0-3.5 3-6 7-6s7 2.5 7 6" }),
        /* @__PURE__ */ jsx24("path", { d: "M16 8a3 3 0 100-6" }),
        /* @__PURE__ */ jsx24("path", { d: "M22 20c0-2.8-2-5-5-5.7" })
      ]
    }
  );
}

// src/ClientRosterIcon.tsx
import { jsx as jsx25, jsxs as jsxs21 } from "react/jsx-runtime";
function ClientRosterIcon(props) {
  return /* @__PURE__ */ jsxs21(
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
        /* @__PURE__ */ jsx25("rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }),
        /* @__PURE__ */ jsx25("path", { d: "M3 9h18M8 4v5" })
      ]
    }
  );
}

// src/GridIcon.tsx
import { jsx as jsx26, jsxs as jsxs22 } from "react/jsx-runtime";
function GridIcon(props) {
  return /* @__PURE__ */ jsxs22(
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
        /* @__PURE__ */ jsx26("rect", { x: "3.5", y: "3.5", width: "7", height: "7", rx: "1.3" }),
        /* @__PURE__ */ jsx26("rect", { x: "13.5", y: "3.5", width: "7", height: "7", rx: "1.3" }),
        /* @__PURE__ */ jsx26("rect", { x: "3.5", y: "13.5", width: "7", height: "7", rx: "1.3" }),
        /* @__PURE__ */ jsx26("rect", { x: "13.5", y: "13.5", width: "7", height: "7", rx: "1.3" })
      ]
    }
  );
}

// src/PieChartIcon.tsx
import { jsx as jsx27, jsxs as jsxs23 } from "react/jsx-runtime";
function PieChartIcon(props) {
  return /* @__PURE__ */ jsxs23(
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
        /* @__PURE__ */ jsx27("path", { d: "M12 12V3a9 9 0 019 9h-9z" }),
        /* @__PURE__ */ jsx27("path", { d: "M20.5 15A9 9 0 1112 3v9l8.5 3z" })
      ]
    }
  );
}

// src/BankIcon.tsx
import { jsx as jsx28, jsxs as jsxs24 } from "react/jsx-runtime";
function BankIcon(props) {
  return /* @__PURE__ */ jsxs24(
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
        /* @__PURE__ */ jsx28("path", { d: "M3 10l9-6 9 6" }),
        /* @__PURE__ */ jsx28("path", { d: "M5 10v9M10 10v9M14 10v9M19 10v9" }),
        /* @__PURE__ */ jsx28("path", { d: "M3 19h18" })
      ]
    }
  );
}

// src/SwapIcon.tsx
import { jsx as jsx29 } from "react/jsx-runtime";
function SwapIcon(props) {
  return /* @__PURE__ */ jsx29(
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
      children: /* @__PURE__ */ jsx29("path", { d: "M7 7h11l-3-3M17 17H6l3 3" })
    }
  );
}

// src/CalculatorIcon.tsx
import { jsx as jsx30, jsxs as jsxs25 } from "react/jsx-runtime";
function CalculatorIcon(props) {
  return /* @__PURE__ */ jsxs25(
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
        /* @__PURE__ */ jsx30("rect", { x: "5", y: "3", width: "14", height: "18", rx: "2" }),
        /* @__PURE__ */ jsx30("path", { d: "M8 8h8M8 12h1M12 12h1M16 12h1M8 16h1M12 16h1M16 16h1" })
      ]
    }
  );
}

// src/StackedBillsIcon.tsx
import { jsx as jsx31, jsxs as jsxs26 } from "react/jsx-runtime";
function StackedBillsIcon(props) {
  return /* @__PURE__ */ jsxs26(
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
        /* @__PURE__ */ jsx31("rect", { x: "4", y: "4", width: "14", height: "10", rx: "1.5" }),
        /* @__PURE__ */ jsx31("rect", { x: "7", y: "9", width: "14", height: "10", rx: "1.5" })
      ]
    }
  );
}

// src/DownloadIcon.tsx
import { jsx as jsx32, jsxs as jsxs27 } from "react/jsx-runtime";
function DownloadIcon(props) {
  return /* @__PURE__ */ jsxs27(
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
        /* @__PURE__ */ jsx32("path", { d: "M12 3v13M7 12l5 5 5-5" }),
        /* @__PURE__ */ jsx32("path", { d: "M4 20h16" })
      ]
    }
  );
}

// src/GiftHeartIcon.tsx
import { jsx as jsx33 } from "react/jsx-runtime";
function GiftHeartIcon(props) {
  return /* @__PURE__ */ jsx33(
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
      children: /* @__PURE__ */ jsx33("path", { d: "M12 21s-7-4.5-9.5-9A5 5 0 0112 6a5 5 0 019.5 6c-2.5 4.5-9.5 9-9.5 9z" })
    }
  );
}

// src/FolderIcon.tsx
import { jsx as jsx34 } from "react/jsx-runtime";
function FolderIcon(props) {
  return /* @__PURE__ */ jsx34(
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
      children: /* @__PURE__ */ jsx34("path", { d: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" })
    }
  );
}

// src/WrenchIcon.tsx
import { jsx as jsx35 } from "react/jsx-runtime";
function WrenchIcon(props) {
  return /* @__PURE__ */ jsx35(
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
      children: /* @__PURE__ */ jsx35("path", { d: "M14.7 6.3a4 4 0 00-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 005.4-5.4l-2.6 2.6-2-2z" })
    }
  );
}

// src/ChevronUpIcon.tsx
import { jsx as jsx36 } from "react/jsx-runtime";
function ChevronUpIcon(props) {
  return /* @__PURE__ */ jsx36(
    "svg",
    {
      width: "14",
      height: "14",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: /* @__PURE__ */ jsx36("path", { d: "M5 15l7-7 7 7" })
    }
  );
}

// src/ChevronDownIcon.tsx
import { jsx as jsx37 } from "react/jsx-runtime";
function ChevronDownIcon(props) {
  return /* @__PURE__ */ jsx37(
    "svg",
    {
      width: "14",
      height: "14",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...props,
      children: /* @__PURE__ */ jsx37("path", { d: "M5 9l7 7 7-7" })
    }
  );
}

// src/UploadIcon.tsx
import { jsx as jsx38, jsxs as jsxs28 } from "react/jsx-runtime";
function UploadIcon(props) {
  return /* @__PURE__ */ jsxs28(
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
        /* @__PURE__ */ jsx38("path", { d: "M12 16V4M12 4l-4 4M12 4l4 4" }),
        /* @__PURE__ */ jsx38("path", { d: "M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" })
      ]
    }
  );
}

// src/FileIcon.tsx
import { jsx as jsx39, jsxs as jsxs29 } from "react/jsx-runtime";
function FileIcon(props) {
  return /* @__PURE__ */ jsxs29(
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
        /* @__PURE__ */ jsx39("path", { d: "M6 3h8l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" }),
        /* @__PURE__ */ jsx39("path", { d: "M14 3v5h5" })
      ]
    }
  );
}

// src/IconGallery.tsx
import { jsx as jsx40, jsxs as jsxs30 } from "react/jsx-runtime";
var ICON_GALLERY_ENTRIES = [
  { name: "WarningIcon", Icon: WarningIcon },
  { name: "SearchIcon", Icon: SearchIcon },
  { name: "LockIcon", Icon: LockIcon },
  { name: "PaperclipIcon", Icon: PaperclipIcon },
  { name: "FlaskIcon", Icon: FlaskIcon },
  { name: "SunIcon", Icon: SunIcon },
  { name: "MoonIcon", Icon: MoonIcon },
  { name: "SlidersIcon", Icon: SlidersIcon },
  { name: "ChatIcon", Icon: ChatIcon },
  { name: "DocumentIcon", Icon: DocumentIcon },
  { name: "BarChartIcon", Icon: BarChartIcon },
  { name: "ShieldCheckIcon", Icon: ShieldCheckIcon },
  { name: "LightbulbIcon", Icon: LightbulbIcon },
  { name: "HomeIcon", Icon: HomeIcon },
  { name: "UsersIcon", Icon: UsersIcon },
  { name: "ClientRosterIcon", Icon: ClientRosterIcon },
  { name: "GridIcon", Icon: GridIcon },
  { name: "PieChartIcon", Icon: PieChartIcon },
  { name: "BankIcon", Icon: BankIcon },
  { name: "SwapIcon", Icon: SwapIcon },
  { name: "CalculatorIcon", Icon: CalculatorIcon },
  { name: "StackedBillsIcon", Icon: StackedBillsIcon },
  { name: "DownloadIcon", Icon: DownloadIcon },
  { name: "GiftHeartIcon", Icon: GiftHeartIcon },
  { name: "FolderIcon", Icon: FolderIcon },
  { name: "WrenchIcon", Icon: WrenchIcon },
  { name: "ChevronUpIcon", Icon: ChevronUpIcon },
  { name: "ChevronDownIcon", Icon: ChevronDownIcon },
  { name: "UploadIcon", Icon: UploadIcon },
  { name: "FileIcon", Icon: FileIcon }
];
function IconGallery() {
  return /* @__PURE__ */ jsx40("div", { className: "icon-gallery", children: ICON_GALLERY_ENTRIES.map(({ name, Icon }) => /* @__PURE__ */ jsxs30("div", { className: "icon-gallery-item", children: [
    /* @__PURE__ */ jsx40("div", { className: "icon-gallery-swatch", children: /* @__PURE__ */ jsx40(Icon, { width: 20, height: 20 }) }),
    /* @__PURE__ */ jsx40("span", { className: "icon-gallery-name", children: name })
  ] }, name)) });
}
export {
  AccountCashDonut,
  Badge,
  BankIcon,
  BarChartIcon,
  Button,
  CalculatorIcon,
  Card,
  CardSubtitle,
  CardTitle,
  ChatIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClientRosterIcon,
  DocumentIcon,
  DownloadIcon,
  FileIcon,
  FlaskIcon,
  FolderIcon,
  GiftHeartIcon,
  GridIcon,
  HomeIcon,
  ICON_GALLERY_ENTRIES,
  IconGallery,
  IncomeExpenseChart,
  LightbulbIcon,
  LockIcon,
  MockBanner,
  MoonIcon,
  PaperclipIcon,
  PieChartIcon,
  ReportBarRows,
  RunwayRing,
  SearchIcon,
  ShieldCheckIcon,
  SlidersIcon,
  StackedBillsIcon,
  SunIcon,
  SwapIcon,
  ToastProvider,
  TrendPill,
  UploadIcon,
  UsersIcon,
  WarningIcon,
  WrenchIcon,
  fmtMoney,
  useToast
};
//# sourceMappingURL=index.js.map
