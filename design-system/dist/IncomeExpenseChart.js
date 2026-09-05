// src/IncomeExpenseChart.tsx
import { jsx, jsxs } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsx("div", { className: "chart-wrap", children: /* @__PURE__ */ jsxs("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%", preserveAspectRatio: "xMidYMid meet", children: [
    /* @__PURE__ */ jsxs("defs", { children: [
      /* @__PURE__ */ jsxs("linearGradient", { id: gradientId, x1: "0", y1: "0", x2: "0", y2: "1", children: [
        /* @__PURE__ */ jsx("stop", { offset: "0%", stopColor: "var(--chart-income)", stopOpacity: "0.35" }),
        /* @__PURE__ */ jsx("stop", { offset: "100%", stopColor: "var(--chart-income)", stopOpacity: "0.02" })
      ] }),
      /* @__PURE__ */ jsxs("linearGradient", { id: gradientIdExp, x1: "0", y1: "0", x2: "0", y2: "1", children: [
        /* @__PURE__ */ jsx("stop", { offset: "0%", stopColor: "var(--gold)", stopOpacity: "0.4" }),
        /* @__PURE__ */ jsx("stop", { offset: "100%", stopColor: "var(--gold)", stopOpacity: "0.02" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("g", { className: "chart-inline-legend", children: [
      /* @__PURE__ */ jsx("rect", { x: width - 190, y: "10", width: "10", height: "10", rx: "2", fill: "var(--chart-income)" }),
      /* @__PURE__ */ jsx("text", { x: width - 176, y: "19", fontSize: "11.5", fill: "var(--text-muted)", children: "Income" }),
      /* @__PURE__ */ jsx("rect", { x: width - 100, y: "10", width: "10", height: "10", rx: "2", fill: "var(--gold)" }),
      /* @__PURE__ */ jsx("text", { x: width - 86, y: "19", fontSize: "11.5", fill: "var(--text-muted)", children: "Expenses" })
    ] }),
    tickVals.map((v, i) => {
      const y = padding.top + innerH - v / maxVal * innerH;
      return /* @__PURE__ */ jsxs("g", { children: [
        /* @__PURE__ */ jsx("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: "var(--border)", strokeWidth: "1" }),
        /* @__PURE__ */ jsx("text", { x: padding.left - 8, y: y + 4, fontSize: "10.5", fill: "var(--text-muted)", textAnchor: "end", children: v >= 1e3 ? `${Math.round(v / 1e3)}k` : Math.round(v) })
      ] }, i);
    }),
    /* @__PURE__ */ jsx("path", { d: smoothAreaPath(expensePoints, baseline), fill: `url(#${gradientIdExp})` }),
    /* @__PURE__ */ jsx("path", { d: smoothLinePath(expensePoints), fill: "none", stroke: "var(--gold)", strokeWidth: "2" }),
    /* @__PURE__ */ jsx("path", { d: smoothAreaPath(incomePoints, baseline), fill: `url(#${gradientId})` }),
    /* @__PURE__ */ jsx("path", { d: smoothLinePath(incomePoints), fill: "none", stroke: "var(--chart-income)", strokeWidth: "2.5" }),
    incomePoints.map((p, i) => /* @__PURE__ */ jsx("circle", { cx: p.x, cy: p.y, r: "3.5", fill: "var(--surface)", stroke: "var(--chart-income)", strokeWidth: "2" }, "i" + i)),
    expensePoints.map((p, i) => /* @__PURE__ */ jsx("circle", { cx: p.x, cy: p.y, r: "3.5", fill: "var(--surface)", stroke: "var(--gold)", strokeWidth: "2" }, "e" + i)),
    monthly.map((m, i) => /* @__PURE__ */ jsx("text", { x: xFor(i), y: height - 8, fontSize: "11.5", fill: "var(--text-muted)", textAnchor: "middle", children: m.month }, m.month))
  ] }) });
}
export {
  IncomeExpenseChart
};
//# sourceMappingURL=IncomeExpenseChart.js.map
