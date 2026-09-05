// src/TrendPill.tsx
import { jsxs } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs("span", { className: "pill " + pillClass, children: [
    t.arrow,
    " ",
    t.label
  ] });
}
export {
  TrendPill
};
//# sourceMappingURL=TrendPill.js.map
