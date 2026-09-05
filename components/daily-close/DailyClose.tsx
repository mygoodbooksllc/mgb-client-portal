"use client";

/*
  Adapted for this bundler-less prototype. The component body below is the
  original, unchanged; only the module wiring at the top and bottom differs.

  - React/hooks come from the global UMD build instead of an import.
  - `styles` maps to the `dc-` prefixed classes in DailyClose.css, standing in
    for the CSS Modules import.
  - The default export becomes a global, matching how app.jsx works.
  - The whole file runs inside an IIFE: every script here shares one global
    scope, so top-level `const`s would otherwise collide with app.jsx (which
    already declares useState/useMemo).
*/

(function () {
const { useMemo, useState } = React;

const styles = new Proxy(
  {},
  { get: (_, key) => (typeof key === "string" ? "dc-" + key : undefined) }
);

interface DailyCloseProps {
  data: DailyCloseData;
  /** Extra class applied to the outer wrapper, e.g. for page-level margins. */
  className?: string;
  /** Force a theme regardless of the viewer's OS setting. Omit to follow the system. */
  theme?: "light" | "dark";
}

/* ============================================================
   Formatting helpers
   ============================================================ */

function fmtMoney(n: number): string {
  const v = Math.round(n);
  const sign = v < 0 ? "−" : "";
  return sign + "$" + Math.abs(v).toLocaleString("en-US");
}

function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

// Bar-fill entrance duration scales with how far the bar travels, so a
// near-empty bar doesn't take as long to grow as a full one — matching
// styles.css's growDuration.
function growDuration(fillPct: number): number {
  const clamped = Math.min(100, Math.max(0, fillPct));
  return 450 + (clamped / 100) * 450;
}

/* ============================================================
   Sparkline (KPI tile trend)
   ============================================================ */

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 220,
    h = 60,
    pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className={styles.kpiSpark} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height: 30, marginTop: "auto" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}

/* ============================================================
   Line / area chart with crosshair tooltip
   ============================================================ */

interface ChartSeries {
  name: string;
  data: number[];
  color: string;
  /** Index at which this series switches from solid to dashed (projected). Omit for fully solid. */
  dashFrom?: number;
  area?: boolean;
  labelEnd?: boolean;
  labelAbove?: boolean;
}

function LineChart({
  labels,
  series,
  floorZero = true,
  lowPointIndex,
  ariaLabel,
}: {
  labels: string[];
  series: ChartSeries[];
  floorZero?: boolean;
  lowPointIndex?: number;
  ariaLabel?: string;
}) {
  const W = 720,
    H = 210,
    padL = 44,
    padR = 14,
    padT = 14,
    padB = 26;
  const n = labels.length;

  const { yMin, yMax, X, Y } = useMemo(() => {
    const allVals = series.flatMap((s) => s.data);
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const pad = (max - min) * 0.12 || 1;
    const yMin = floorZero ? 0 : Math.floor((min - pad) / 1000) * 1000;
    const yMax = Math.ceil((max + pad) / 1000) * 1000;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const stepX = innerW / (n - 1);
    const X = (i: number) => padL + i * stepX;
    const Y = (v: number) => padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
    return { yMin, yMax, X, Y };
  }, [series, floorZero, n]);

  const [hover, setHover] = useState<number | null>(null);

  const gridVals = [yMin, yMin + (yMax - yMin) / 2, yMax];
  const everyN = n > 9 ? Math.ceil(n / 7) : 1;

  function handleMove(evt: React.MouseEvent<SVGRectElement> | React.TouchEvent<SVGRectElement>) {
    const svg = (evt.currentTarget.ownerSVGElement ?? evt.currentTarget) as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const clientX = "touches" in evt ? evt.touches[0].clientX : (evt as React.MouseEvent).clientX;
    const scaleX = W / rect.width;
    const xIn = (clientX - rect.left) * scaleX;
    const hitW = (W - padL - padR) / (n - 1);
    let i = Math.round((xIn - padL) / hitW);
    i = Math.max(0, Math.min(n - 1, i));
    setHover(i);
  }

  const tooltipLeftPct = hover !== null ? (X(hover) / W) * 100 : 0;
  const tooltipTopPct =
    hover !== null ? (Y(Math.max(...series.map((s) => s.data[hover]))) / H) * 100 : 0;

  return (
    <div className={styles.chartWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {gridVals.map((gv, idx) => (
          <g key={idx}>
            <line x1={padL} x2={W - padR} y1={Y(gv)} y2={Y(gv)} stroke="var(--line)" strokeWidth={1} />
            <text
              className="count-up"
              x={padL - 8}
              y={Y(gv) + 3}
              textAnchor="end"
              fontSize={9.5}
              fontFamily="IBM Plex Mono, monospace"
              fill="var(--ink-400)"
            >
              ${Math.round(gv / 1000)}k
            </text>
          </g>
        ))}

        {labels.map((lab, i) => {
          if (i % everyN !== 0 && i !== n - 1) return null;
          return (
            <text
              key={i}
              x={X(i)}
              y={H - 6}
              textAnchor="middle"
              fontSize={9.5}
              fontFamily="IBM Plex Mono, monospace"
              fill="var(--ink-400)"
            >
              {lab}
            </text>
          );
        })}

        {series.map((s, si) => {
          const dashFrom = s.dashFrom ?? -1;
          const solidPts: [number, number][] = [];
          const dashPts: [number, number][] = [];
          s.data.forEach((v, i) => {
            const p: [number, number] = [X(i), Y(v)];
            if (dashFrom >= 0 && i >= dashFrom) dashPts.push(p);
            else solidPts.push(p);
          });
          if (dashFrom >= 0 && solidPts.length) dashPts.unshift(solidPts[solidPts.length - 1]);

          const toPath = (pts: [number, number][]) =>
            pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

          const lastIdx = s.data.length - 1;
          const lastPt: [number, number] = [X(lastIdx), Y(s.data[lastIdx])];

          return (
            <g key={si}>
              {s.area && solidPts.length > 0 && (
                <path
                  d={(() => {
                    const top = solidPts.concat(dashPts);
                    let d = "M" + top.map((p) => `${p[0]},${p[1]}`).join(" L");
                    d += ` L${top[top.length - 1][0]},${Y(yMin)} L${top[0][0]},${Y(yMin)} Z`;
                    return d;
                  })()}
                  fill={s.color}
                  opacity={0.1}
                />
              )}
              {solidPts.length > 1 && (
                <path d={toPath(solidPts)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              )}
              {dashPts.length > 1 && (
                <path
                  d={toPath(dashPts)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="5,4"
                />
              )}
              <circle cx={lastPt[0]} cy={lastPt[1]} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              {s.labelEnd && (
                <text
                  className="count-up"
                  x={lastPt[0]}
                  y={lastPt[1] + (s.labelAbove ? -9 : 15)}
                  textAnchor={lastIdx === n - 1 ? "end" : "middle"}
                  fontSize={10.5}
                  fontFamily="IBM Plex Mono, monospace"
                  fontWeight={600}
                  fill="var(--ink-900)"
                >
                  {fmtMoney(s.data[lastIdx])}
                </text>
              )}
              {lowPointIndex !== undefined && si === 0 && (
                <g>
                  <circle
                    cx={X(lowPointIndex)}
                    cy={Y(s.data[lowPointIndex])}
                    r={5.5}
                    fill="none"
                    stroke="var(--critical)"
                    strokeWidth={2}
                  />
                  <text
                    className="count-up"
                    x={X(lowPointIndex)}
                    y={Y(s.data[lowPointIndex]) + 18}
                    textAnchor="middle"
                    fontSize={10}
                    fontFamily="IBM Plex Mono, monospace"
                    fontWeight={600}
                    fill="var(--critical)"
                  >
                    low: {fmtMoney(s.data[lowPointIndex])}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {hover !== null && (
          <line x1={X(hover)} x2={X(hover)} y1={padT} y2={H - padB} stroke="var(--ink-400)" strokeWidth={1} />
        )}

        <rect
          x={padL}
          y={padT}
          width={W - padL - padR}
          height={H - padT - padB}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
          onTouchStart={handleMove}
          onTouchMove={handleMove}
          onTouchEnd={() => setHover(null)}
        />
      </svg>

      {hover !== null && (
        <div
          className={`${styles.tooltip} ${styles.tooltipShow}`}
          style={{ left: `${tooltipLeftPct}%`, top: `${tooltipTopPct}%` }}
        >
          <div className={styles.tDate}>{labels[hover]}</div>
          {series.map((s, i) => (
            <div className={styles.tRow} key={i}>
              <span>{s.name}</span>
              <span className={`${styles.num} count-up`} style={{ marginLeft: 10, color: s.color }}>
                {fmtMoney(s.data[hover])}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Horizontal bar list (expense breakdown)
   ============================================================ */

function BarList({ items }: { items: { label: string; amount: number }[] }) {
  const max = Math.max(...items.map((i) => i.amount));
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  return (
    <div>
      {sorted.map((item) => (
        <div className={styles.barRow} key={item.label}>
          <div className={styles.bLabel}>{item.label}</div>
          <div className={styles.bTrack}>
            <div
              className={styles.bFill}
              style={{ width: `${(item.amount / max) * 100}%`, animationDuration: `${growDuration((item.amount / max) * 100)}ms` }}
            />
          </div>
          <div className={`${styles.bValue} ${styles.num} count-up`}>{fmtMoney(item.amount)}</div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Receivables aging bar
   ============================================================ */

const AGING_TONE_VAR: Record<AgingTone, string> = {
  good: "var(--good)",
  neutral: "var(--ink-400)",
  warning: "var(--warning)",
  critical: "var(--critical)",
};

function AgingBar({ items }: { items: { label: string; amount: number; tone: AgingTone }[] }) {
  const total = items.reduce((a, b) => a + b.amount, 0);
  return (
    <>
      <div className={styles.aging}>
        {items.map((item) => (
          <div
            key={item.label}
            className={styles.agingSeg}
            style={{ width: `${(item.amount / total) * 100}%`, background: AGING_TONE_VAR[item.tone] }}
            title={`${item.label}: ${fmtMoney(item.amount)}`}
          />
        ))}
      </div>
      <div className={styles.agingKey}>
        {items.map((item) => (
          <div className={styles.agingKeyItem} key={item.label}>
            <span className={styles.agingSwatch} style={{ background: AGING_TONE_VAR[item.tone] }} />
            {item.label}&nbsp;<span className={`${styles.num} count-up`}>{fmtMoney(item.amount)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ============================================================
   Anomalies / flags list
   ============================================================ */

const SEV_STRIPE: Record<Severity, string> = {
  critical: styles.sevCritical,
  serious: styles.sevSerious,
  warn: styles.sevWarn,
  good: styles.sevGood,
};
const SEV_LABEL_CLASS: Record<Severity, string> = {
  critical: styles.sevLabelCritical,
  serious: styles.sevLabelSerious,
  warn: styles.sevLabelWarn,
  good: styles.sevLabelGood,
};
const SEV_COPY: Record<Severity, string> = {
  critical: "Needs attention",
  serious: "Worth a look",
  warn: "For your awareness",
  good: "Nice to see",
};

function AnomalyList({ items }: { items: DailyCloseData["anomalies"] }) {
  return (
    <div className={styles.anomalyList}>
      {items.map((a, i) => (
        <div className={styles.anomaly} key={i}>
          <div className={`${styles.sevStripe} ${SEV_STRIPE[a.severity]}`} />
          <div className={styles.anomalyBody}>
            <div className={styles.anomalyTop}>
              <div className={styles.anomalyTitle}>{a.title}</div>
              <div className={`${styles.anomalyAmt} ${styles.num}`}>{a.amount}</div>
            </div>
            <div className={styles.anomalyDesc}>{a.description}</div>
            <div className={`${styles.sevLabel} ${SEV_LABEL_CLASS[a.severity]}`}>{SEV_COPY[a.severity]}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Main component
   ============================================================ */

type OutlookTab = "forecast" | "trend" | "anomalies";

function DailyClose({ data, className, theme }: DailyCloseProps) {
  const [tab, setTab] = useState<OutlookTab>("forecast");

  const trendLabels = [...data.trend.months, ...data.trend.projectedMonths];
  const trendRevenue = [...data.trend.revenue, ...data.trend.projectedRevenue];
  const trendExpense = [...data.trend.expense, ...data.trend.projectedExpense];

  const marginMeterPct = Math.min(100, (data.netIncome.marginPct / (data.netIncome.marginTargetPct * 2)) * 100);
  const marginTargetPct = 50; // target sits at the midpoint of the 0..2x-target scale

  return (
    <div className={`${styles.dailyClose} ${className ?? ""}`} data-theme={theme}>
      <div className={styles.page}>
        {/* ---------- Masthead ---------- */}
        <header className={styles.masthead}>
          <div>
            <div className={styles.brandEyebrow}>{data.firm.name}</div>
            <h1 className={styles.brandTitle}>
              Daily <span className={styles.accentword}>Report</span>
            </h1>
          </div>
          <div className={styles.mastheadRight}>
            <div className={styles.clientName}>{data.client.name}</div>
            <div className={styles.asof}>{data.client.asOfLabel}</div>
            {data.client.syncedLabel && (
              <div className={styles.syncChip}>
                <span className={styles.syncDot} />
                {data.client.syncedLabel}
                {data.client.isSampleData && <span className={styles.demoTag}>Sample data</span>}
              </div>
            )}
          </div>
        </header>

        {/* ---------- KPI row ---------- */}
        <section className={styles.kpiRow} aria-label="Key metrics">
          <div className={styles.kpiTile}>
            <div className={styles.kpiLabel}>Cash on hand</div>
            <div className={styles.kpiValue}>
              {fmtMoney(data.cash.total)}
              {data.cash.cents !== undefined && <small>.{String(data.cash.cents).padStart(2, "0")}</small>}
            </div>
            <div className={`${styles.delta} ${data.cash.deltaVsYesterday >= 0 ? styles.deltaUp : styles.deltaDown}`}>
              {data.cash.deltaVsYesterday >= 0 ? "▲" : "▼"} {fmtMoney(Math.abs(data.cash.deltaVsYesterday))} vs. yesterday
            </div>
            <Sparkline values={data.cash.sparkline14d} color="var(--series-revenue)" />
          </div>

          <div className={styles.kpiTile}>
            <div className={styles.kpiLabel}>Accounts receivable</div>
            <div className={styles.kpiValue}>{fmtMoney(data.receivables.total)}</div>
            <div className={`${styles.chip} ${styles.chipWarn}`}>
              <span className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)" }} />
              {fmtMoney(data.receivables.overdueAmount)} overdue
            </div>
            <div className={styles.kpiFoot} style={{ marginTop: "auto" }}>
              {data.receivables.openInvoiceCount} open invoices, {data.receivables.customerCount} customers
            </div>
          </div>

          <div className={styles.kpiTile}>
            <div className={styles.kpiLabel}>Accounts payable</div>
            <div className={styles.kpiValue}>{fmtMoney(data.payables.total)}</div>
            <div className={`${styles.chip} ${data.payables.hasPastDue ? styles.chipCritical : styles.chipGood}`}>
              <span
                className="dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: data.payables.hasPastDue ? "var(--critical)" : "var(--good)",
                }}
              />
              {data.payables.hasPastDue ? "Some past due" : "Nothing past due"}
            </div>
            <div className={styles.kpiFoot} style={{ marginTop: "auto" }}>
              {fmtMoney(data.payables.dueWithin7Days)} due within 7 days
            </div>
          </div>

          <div className={styles.kpiTile}>
            <div className={styles.kpiLabel}>Net income, MTD</div>
            <div className={styles.kpiValue}>{fmtMoney(data.netIncome.mtd)}</div>
            <div className={`${styles.delta} ${data.netIncome.deltaPctVsPriorMonth >= 0 ? styles.deltaUp : styles.deltaDown}`}>
              {data.netIncome.deltaPctVsPriorMonth >= 0 ? "▲" : "▼"} {pct(Math.abs(data.netIncome.deltaPctVsPriorMonth))} vs. last month
            </div>
            <div className={styles.kpiMeter}>
              <div
                className={styles.kpiMeterFill}
                style={{ width: `${marginMeterPct}%`, animationDuration: `${growDuration(marginMeterPct)}ms` }}
              />
            </div>
            <div className={styles.kpiFoot}>
              {pct(data.netIncome.marginPct)} margin &middot; target {pct(data.netIncome.marginTargetPct, 0)}
            </div>
          </div>
        </section>

        {/* ---------- Revenue vs expenses + expense breakdown ---------- */}
        <section className={styles.grid2}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <div className={styles.panelTitle}>Revenue vs. expenses</div>
                <div className={styles.panelSub}>Last {data.trend.months.length} months, actuals</div>
              </div>
              <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={styles.legendSwatchLine} style={{ background: "var(--series-revenue)" }} />
                  Revenue
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendSwatchLine} style={{ background: "var(--series-expense)" }} />
                  Expenses
                </span>
              </div>
            </div>
            <LineChart
              ariaLabel="Revenue versus expenses"
              labels={trendLabels}
              series={[
                {
                  name: "Revenue",
                  color: "var(--series-revenue)",
                  data: trendRevenue,
                  dashFrom: data.trend.months.length,
                  labelEnd: true,
                  labelAbove: true,
                },
                {
                  name: "Expenses",
                  color: "var(--series-expense)",
                  data: trendExpense,
                  dashFrom: data.trend.months.length,
                  labelEnd: true,
                  labelAbove: false,
                },
              ]}
              floorZero
            />
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <div className={styles.panelTitle}>Where the money went</div>
                <div className={styles.panelSub}>Expenses, this month</div>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <BarList items={data.expenseBreakdown} />
            </div>
          </div>
        </section>

        {/* ---------- Receivables aging ---------- */}
        <section className={styles.panel} style={{ marginTop: 12 }}>
          <div className={styles.panelHead}>
            <div>
              <div className={styles.panelTitle}>Receivables aging</div>
              <div className={styles.panelSub}>{fmtMoney(data.receivables.total)} outstanding across {data.receivables.openInvoiceCount} invoices</div>
            </div>
          </div>
          <AgingBar items={data.receivables.aging} />
        </section>

        {/* ---------- Outlook (predictive) ---------- */}
        <section className={styles.outlook}>
          <div className={styles.tabs} role="tablist" aria-label="Outlook view">
            <button
              type="button"
              className={`${styles.tab} ${tab === "forecast" ? styles.tabActive : ""}`}
              role="tab"
              aria-selected={tab === "forecast"}
              onClick={() => setTab("forecast")}
            >
              Cash Flow Forecast
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === "trend" ? styles.tabActive : ""}`}
              role="tab"
              aria-selected={tab === "trend"}
              onClick={() => setTab("trend")}
            >
              Revenue Trend
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === "anomalies" ? styles.tabActive : ""}`}
              role="tab"
              aria-selected={tab === "anomalies"}
              onClick={() => setTab("anomalies")}
            >
              Anomalies &amp; Flags
            </button>
          </div>

          {tab === "forecast" && (
            <div className={styles.panel} style={{ marginTop: 14 }}>
              <div className={styles.panelHead}>
                <div>
                  <div className={styles.panelTitle}>90-day cash flow forecast</div>
                  <div className={styles.panelSub}>Solid = actual &middot; dashed = projected</div>
                </div>
                <div className={styles.legend}>
                  <span className={styles.legendItem}>
                    <span className={styles.legendSwatchLine} style={{ background: "var(--series-revenue)" }} />
                    Actual
                  </span>
                  <span className={styles.legendItem}>
                    <span className={styles.legendSwatchDashed} />
                    Projected
                  </span>
                </div>
              </div>
              <LineChart
                ariaLabel="Ninety day cash flow forecast"
                labels={data.forecast90d.labels}
                floorZero={false}
                lowPointIndex={data.forecast90d.cashBalances.indexOf(
                  Math.min(...data.forecast90d.cashBalances.slice(1))
                )}
                series={[
                  {
                    name: "Cash balance",
                    color: "var(--series-revenue)",
                    data: data.forecast90d.cashBalances,
                    dashFrom: data.forecast90d.actualCount,
                    area: true,
                  },
                ]}
              />
              <div className={styles.callout}>
                💡 <span>{data.forecast90d.narrative}</span>
              </div>
              <div className={styles.methodology}>{data.forecast90d.methodology}</div>
            </div>
          )}

          {tab === "trend" && (
            <div className={styles.panel} style={{ marginTop: 14 }}>
              <div className={styles.panelHead}>
                <div>
                  <div className={styles.panelTitle}>Revenue trend &amp; projection</div>
                  <div className={styles.panelSub}>Solid = actual &middot; dashed = next {data.trend.projectedMonths.length} months</div>
                </div>
                <div className={styles.legend}>
                  <span className={styles.legendItem}>
                    <span className={styles.legendSwatchLine} style={{ background: "var(--series-revenue)" }} />
                    Actual
                  </span>
                  <span className={styles.legendItem}>
                    <span className={styles.legendSwatchDashed} />
                    Projected
                  </span>
                </div>
              </div>
              <LineChart
                ariaLabel="Revenue trend and projection"
                labels={trendLabels}
                floorZero={false}
                series={[
                  {
                    name: "Revenue",
                    color: "var(--series-revenue)",
                    data: trendRevenue,
                    dashFrom: data.trend.months.length,
                    area: true,
                    labelEnd: true,
                    labelAbove: true,
                  },
                ]}
              />
            </div>
          )}

          {tab === "anomalies" && (
            <div className={styles.panel} style={{ marginTop: 14 }}>
              <div className={styles.panelHead}>
                <div>
                  <div className={styles.panelTitle}>Needs a look</div>
                  <div className={styles.panelSub}>Flagged automatically from this month&apos;s activity</div>
                </div>
              </div>
              <AnomalyList items={data.anomalies} />
            </div>
          )}
        </section>

        <div className={styles.footer}>
          <span>Prepared by {data.firm.name} &middot; data refreshes automatically each morning</span>
          <span>Questions? Reply to this report or message your bookkeeper.</span>
        </div>
      </div>
    </div>
  );
}


// No module system here — publish to the global scope the way app.jsx does.
window.DailyClose = DailyClose;
})();
