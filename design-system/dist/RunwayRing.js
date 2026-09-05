// src/RunwayRing.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function RunwayRing({ pct, tone, children }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const trackColor = tone === "negative" ? "var(--bad-soft)" : "var(--good-soft)";
  const ringColor = tone === "negative" ? "var(--bad)" : "var(--good)";
  return /* @__PURE__ */ jsxs("div", { className: "runway-ring-wrap", children: [
    /* @__PURE__ */ jsxs("svg", { width: "108", height: "108", viewBox: "0 0 108 108", children: [
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
export {
  RunwayRing
};
//# sourceMappingURL=RunwayRing.js.map
