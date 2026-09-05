/* @ds-bundle: {"namespace":"MygoodbooksDS","components":[{"name":"AccountCashDonut","sourcePath":"components/general/AccountCashDonut/AccountCashDonut.jsx"},{"name":"Badge","sourcePath":"components/general/Badge/Badge.jsx"},{"name":"Button","sourcePath":"components/general/Button/Button.jsx"},{"name":"Card","sourcePath":"components/general/Card/Card.jsx"},{"name":"CardSubtitle","sourcePath":"components/general/CardSubtitle/CardSubtitle.jsx"},{"name":"CardTitle","sourcePath":"components/general/CardTitle/CardTitle.jsx"},{"name":"IncomeExpenseChart","sourcePath":"components/general/IncomeExpenseChart/IncomeExpenseChart.jsx"},{"name":"MockBanner","sourcePath":"components/general/MockBanner/MockBanner.jsx"},{"name":"ReportBarRows","sourcePath":"components/general/ReportBarRows/ReportBarRows.jsx"},{"name":"RunwayRing","sourcePath":"components/general/RunwayRing/RunwayRing.jsx"},{"name":"ToastProvider","sourcePath":"components/general/ToastProvider/ToastProvider.jsx"},{"name":"TrendPill","sourcePath":"components/general/TrendPill/TrendPill.jsx"}],"sourceHashes":{"components/general/AccountCashDonut/AccountCashDonut.jsx":"9e813c3842c0","components/general/AccountCashDonut/AccountCashDonut.d.ts":"769f209bf9c9","components/general/AccountCashDonut/AccountCashDonut.prompt.md":"a8346024067b","components/general/Badge/Badge.jsx":"dfb3025947d9","components/general/Badge/Badge.d.ts":"433d01166674","components/general/Badge/Badge.prompt.md":"5b813375dc90","components/general/Button/Button.jsx":"225417d327d6","components/general/Button/Button.d.ts":"dacb0e421763","components/general/Button/Button.prompt.md":"28ecec8ea176","components/general/Card/Card.jsx":"6374e01efca7","components/general/Card/Card.d.ts":"bd5a2db42991","components/general/Card/Card.prompt.md":"ff56d6b4875e","components/general/CardSubtitle/CardSubtitle.jsx":"f0daac195ccb","components/general/CardSubtitle/CardSubtitle.d.ts":"8c0217cf7b14","components/general/CardSubtitle/CardSubtitle.prompt.md":"949c0f32ef97","components/general/CardTitle/CardTitle.jsx":"a4807088fddc","components/general/CardTitle/CardTitle.d.ts":"64863d8c7ff8","components/general/CardTitle/CardTitle.prompt.md":"ef45cf39274d","components/general/IncomeExpenseChart/IncomeExpenseChart.jsx":"c0aaad45a95d","components/general/IncomeExpenseChart/IncomeExpenseChart.d.ts":"5fd4c2ae16a8","components/general/IncomeExpenseChart/IncomeExpenseChart.prompt.md":"1b085ac05f48","components/general/MockBanner/MockBanner.jsx":"3a628df35888","components/general/MockBanner/MockBanner.d.ts":"ada2203e8ea5","components/general/MockBanner/MockBanner.prompt.md":"de10716ac701","components/general/ReportBarRows/ReportBarRows.jsx":"f3efc7b31c41","components/general/ReportBarRows/ReportBarRows.d.ts":"902c30159d0c","components/general/ReportBarRows/ReportBarRows.prompt.md":"6ca4dc06ed9e","components/general/RunwayRing/RunwayRing.jsx":"37a77ad88b9a","components/general/RunwayRing/RunwayRing.d.ts":"a69e822f6893","components/general/RunwayRing/RunwayRing.prompt.md":"a502dffd6143","components/general/ToastProvider/ToastProvider.jsx":"eed1bedd06df","components/general/ToastProvider/ToastProvider.d.ts":"67b5b45aa822","components/general/ToastProvider/ToastProvider.prompt.md":"89fbc03efbbe","components/general/TrendPill/TrendPill.jsx":"c27820107ecc","components/general/TrendPill/TrendPill.d.ts":"bb717cd15e24","components/general/TrendPill/TrendPill.prompt.md":"5e8c272e610a"},"inlinedExternals":[],"builtBy":"cc-design-sync"} */
"use strict";
var MygoodbooksDS = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // <define:import.meta.env>
  var init_define_import_meta_env = __esm({
    "<define:import.meta.env>"() {
    }
  });

  // shim:react-shim
  var require_react_shim = __commonJS({
    "shim:react-shim"(exports, module) {
      init_define_import_meta_env();
      var R = window.React;
      function np(p, k) {
        var o = {};
        for (var x in p) if (x !== "children") o[x] = p[x];
        if (k !== void 0) o.key = k;
        return o;
      }
      function jsx9(t, p, k) {
        var c = p && p.children;
        return c === void 0 ? R.createElement(t, np(p, k)) : R.createElement(t, np(p, k), c);
      }
      function jsxs9(t, p, k) {
        return R.createElement.apply(R, [t, np(p, k)].concat(p.children));
      }
      module.exports = R;
      module.exports.jsx = jsx9;
      module.exports.jsxs = jsxs9;
      module.exports.jsxDEV = function(t, p, k, s) {
        return (s ? jsxs9 : jsx9)(t, p, k);
      };
      module.exports.Fragment = R.Fragment;
    }
  });

  // dist/index.js
  var index_exports = {};
  __export(index_exports, {
    AccountCashDonut: () => AccountCashDonut,
    Badge: () => Badge,
    Button: () => Button,
    Card: () => Card,
    CardSubtitle: () => CardSubtitle,
    CardTitle: () => CardTitle,
    IncomeExpenseChart: () => IncomeExpenseChart,
    MockBanner: () => MockBanner,
    ReportBarRows: () => ReportBarRows,
    RunwayRing: () => RunwayRing,
    ToastProvider: () => ToastProvider,
    TrendPill: () => TrendPill,
    fmtMoney: () => fmtMoney,
    useToast: () => useToast
  });
  init_define_import_meta_env();
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  var import_jsx_runtime2 = __toESM(require_react_shim(), 1);
  var import_jsx_runtime3 = __toESM(require_react_shim(), 1);
  var import_jsx_runtime4 = __toESM(require_react_shim(), 1);
  var import_jsx_runtime5 = __toESM(require_react_shim(), 1);
  var import_jsx_runtime6 = __toESM(require_react_shim(), 1);
  var import_jsx_runtime7 = __toESM(require_react_shim(), 1);
  var import_jsx_runtime8 = __toESM(require_react_shim(), 1);
  var import_jsx_runtime9 = __toESM(require_react_shim(), 1);
  var import_react = __toESM(require_react_shim(), 1);
  var import_jsx_runtime10 = __toESM(require_react_shim(), 1);
  var fmtMoney = (n, opts = {}) => {
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    return sign + "$" + abs.toLocaleString("en-US", {
      minimumFractionDigits: opts.cents ? 2 : 0,
      maximumFractionDigits: opts.cents ? 2 : 0
    });
  };
  function MockBanner({ text }) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mock-banner", children: [
      "\u{1F9EA} ",
      text
    ] });
  }
  function RunwayRing({ pct, tone, children }) {
    const r = 42;
    const c = 2 * Math.PI * r;
    const trackColor = tone === "negative" ? "var(--bad-soft)" : "var(--good-soft)";
    const ringColor = tone === "negative" ? "var(--bad)" : "var(--good)";
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "runway-ring-wrap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "108", height: "108", viewBox: "0 0 108 108", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "54", cy: "54", r, fill: "none", stroke: trackColor, strokeWidth: "9" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "runway-ring-center", children })
    ] });
  }
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
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "pill " + pillClass, children: [
      t.arrow,
      " ",
      t.label
    ] });
  }
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
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "donut-widget compact", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "donut", style: { background: `conic-gradient(${stops.join(", ")})` }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "donut-hole", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "donut-center-value", children: fmtMoney(total) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "donut-center-label", children: "Total Cash" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "donut-legend", children: accounts.map((a, i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "donut-legend-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "legend-swatch", style: { background: colors[i % colors.length] } }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: a.accountName }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "donut-legend-value", children: fmtMoney(a.balance) })
      ] }, a.id)) })
    ] });
  }
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
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "chart-wrap", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%", preserveAspectRatio: "xMidYMid meet", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("defs", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("linearGradient", { id: gradientId, x1: "0", y1: "0", x2: "0", y2: "1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("stop", { offset: "0%", stopColor: "var(--chart-income)", stopOpacity: "0.35" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("stop", { offset: "100%", stopColor: "var(--chart-income)", stopOpacity: "0.02" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("linearGradient", { id: gradientIdExp, x1: "0", y1: "0", x2: "0", y2: "1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("stop", { offset: "0%", stopColor: "var(--gold)", stopOpacity: "0.4" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("stop", { offset: "100%", stopColor: "var(--gold)", stopOpacity: "0.02" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("g", { className: "chart-inline-legend", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("rect", { x: width - 190, y: "10", width: "10", height: "10", rx: "2", fill: "var(--chart-income)" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("text", { x: width - 176, y: "19", fontSize: "11.5", fill: "var(--text-muted)", children: "Income" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("rect", { x: width - 100, y: "10", width: "10", height: "10", rx: "2", fill: "var(--gold)" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("text", { x: width - 86, y: "19", fontSize: "11.5", fill: "var(--text-muted)", children: "Expenses" })
      ] }),
      tickVals.map((v, i) => {
        const y = padding.top + innerH - v / maxVal * innerH;
        return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("g", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: "var(--border)", strokeWidth: "1" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("text", { x: padding.left - 8, y: y + 4, fontSize: "10.5", fill: "var(--text-muted)", textAnchor: "end", children: v >= 1e3 ? `${Math.round(v / 1e3)}k` : Math.round(v) })
        ] }, i);
      }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: smoothAreaPath(expensePoints, baseline), fill: `url(#${gradientIdExp})` }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: smoothLinePath(expensePoints), fill: "none", stroke: "var(--gold)", strokeWidth: "2" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: smoothAreaPath(incomePoints, baseline), fill: `url(#${gradientId})` }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: smoothLinePath(incomePoints), fill: "none", stroke: "var(--chart-income)", strokeWidth: "2.5" }),
      incomePoints.map((p, i) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("circle", { cx: p.x, cy: p.y, r: "3.5", fill: "var(--surface)", stroke: "var(--chart-income)", strokeWidth: "2" }, "i" + i)),
      expensePoints.map((p, i) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("circle", { cx: p.x, cy: p.y, r: "3.5", fill: "var(--surface)", stroke: "var(--gold)", strokeWidth: "2" }, "e" + i)),
      monthly.map((m, i) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("text", { x: xFor(i), y: height - 8, fontSize: "11.5", fill: "var(--text-muted)", textAnchor: "middle", children: m.month }, m.month))
    ] }) });
  }
  function ReportBarRows({ items }) {
    const max = Math.max(...items.map((i) => Math.abs(i.amount)), 1);
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "rb-bar-rows", children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rb-bar-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: item.label }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "bar-track", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "div",
        {
          className: "bar-fill " + (item.tone || "rb-bar-fill"),
          style: { width: `${Math.max(4, Math.round(Math.abs(item.amount) / max * 100))}%` }
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "rb-bar-amt", children: fmtMoney(item.amount) })
    ] }, item.label)) });
  }
  function Card({ className, children, ...rest }) {
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "card" + (className ? " " + className : ""), ...rest, children });
  }
  function CardTitle({ className, children, ...rest }) {
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { className: "card-title" + (className ? " " + className : ""), ...rest, children });
  }
  function CardSubtitle({ className, children, ...rest }) {
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "card-subtitle" + (className ? " " + className : ""), ...rest, children });
  }
  function Button({ variant = "primary", className, children, ...rest }) {
    const base = variant === "secondary" ? "btn-secondary" : "btn-primary";
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { className: base + (className ? " " + className : ""), ...rest, children });
  }
  function Badge({ label, className }) {
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { className: "badge-live" + (className ? " " + className : ""), children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "badge-dot" }),
      label
    ] });
  }
  var ToastContext = (0, import_react.createContext)(() => {
  });
  var useToast = () => (0, import_react.useContext)(ToastContext);
  function ToastProvider({ children }) {
    const [toasts, setToasts] = (0, import_react.useState)([]);
    const showToast = (text) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
    };
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(ToastContext.Provider, { value: showToast, children: [
      children,
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "toast-stack", children: toasts.map((t) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "toast", children: t.text }, t.id)) })
    ] });
  }
  return __toCommonJS(index_exports);
})();
window.MygoodbooksDS=MygoodbooksDS.__dsMainNs?Object.assign({},MygoodbooksDS,MygoodbooksDS.__dsMainNs,{__dsMainNs:undefined}):MygoodbooksDS;
