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
const { useMemo, useRef, useState } = React;

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
  /** Cross-navigates the host app to another tab (e.g. the Accounts Payable
      KPI tile jumping to AP Command Center). Omit to render that tile as
      non-interactive — used by the standalone prototype, which has nowhere
      to navigate to. */
  onNavigate?: (page: string) => void;
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
   Cash-floor alert threshold — per-client, browser-local only (same
   throwaway-localStorage posture app.jsx's own FEATURE_FLAGS use, not a
   real backend setting).
   ============================================================ */

function cashFloorKey(clientId?: string): string {
  return `mygoodbooks_cash_floor_v1:${clientId || "default"}`;
}

function readCashFloor(clientId?: string): number | null {
  try {
    const raw = localStorage.getItem(cashFloorKey(clientId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    return null;
  }
}

function writeCashFloor(clientId: string | undefined, value: number | null): void {
  try {
    if (value === null) localStorage.removeItem(cashFloorKey(clientId));
    else localStorage.setItem(cashFloorKey(clientId), String(value));
  } catch (e) {}
}

/* ============================================================
   Widget layout — "customize your Live Report," same idea as the
   Dashboard's own customize feature in app.jsx (show/hide + reorder via
   move buttons). Not a call into app.jsx's useWidgetLayout/WidgetPickerModal:
   this file is deliberately self-contained (loads before app.jsx even
   exists, and the module comment at the top of this file says why), so this
   is a small parallel implementation rather than a cross-file dependency on
   another script's internals.
   ============================================================ */

type LiveReportWidgetId = "kpi-cash" | "kpi-ar" | "kpi-ap" | "kpi-net" | "trend" | "expense-breakdown" | "aging" | "outlook";

const LIVE_REPORT_WIDGETS: { id: LiveReportWidgetId; label: string; description: string }[] = [
  { id: "kpi-cash", label: "Cash on Hand", description: "Current balance, delta vs. yesterday, 14-day trend" },
  { id: "kpi-ar", label: "Accounts Receivable", description: "Outstanding balance and overdue amount" },
  { id: "kpi-ap", label: "Accounts Payable", description: "Outstanding balance and amount due within 7 days" },
  { id: "kpi-net", label: "Net Income, MTD", description: "Month-to-date net income and margin" },
  { id: "trend", label: "Revenue vs. Expenses", description: "6-month trend chart" },
  { id: "expense-breakdown", label: "Where the Money Went", description: "Expenses by category, this month" },
  { id: "aging", label: "Receivables Aging", description: "Aging buckets and the collections queue" },
  { id: "outlook", label: "Outlook", description: "Cash flow forecast, revenue trend, and flagged anomalies" },
];
const LIVE_REPORT_WIDGET_IDS = LIVE_REPORT_WIDGETS.map((w) => w.id);

function liveReportLayoutKey(clientId?: string): string {
  return `mygoodbooks_live_report_layout_v1:${clientId || "default"}`;
}

function readLiveReportLayout(clientId?: string): { order: string[]; hidden: string[] } | null {
  try {
    const raw = localStorage.getItem(liveReportLayoutKey(clientId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.hidden)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function writeLiveReportLayout(clientId: string | undefined, order: string[], hidden: string[]): void {
  try {
    localStorage.setItem(liveReportLayoutKey(clientId), JSON.stringify({ order, hidden }));
  } catch (e) {}
}

function useLiveReportLayout(clientId?: string) {
  const [saved, setSaved] = useState(() => readLiveReportLayout(clientId));
  const order = saved ? saved.order.filter((id) => LIVE_REPORT_WIDGET_IDS.includes(id as LiveReportWidgetId)).concat(LIVE_REPORT_WIDGET_IDS.filter((id) => !saved!.order.includes(id))) : LIVE_REPORT_WIDGET_IDS.slice();
  const hidden = new Set(saved ? saved.hidden.filter((id) => LIVE_REPORT_WIDGET_IDS.includes(id as LiveReportWidgetId)) : []);

  const update = (nextOrder: string[], nextHidden: Set<string>) => {
    const nextHiddenArr = Array.from(nextHidden);
    writeLiveReportLayout(clientId, nextOrder, nextHiddenArr);
    setSaved({ order: nextOrder, hidden: nextHiddenArr });
  };

  return {
    order,
    hidden,
    visibleOrder: order.filter((id) => !hidden.has(id)),
    toggle: (id: string) => {
      const next = new Set(hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      update(order, next);
    },
    move: (id: string, direction: -1 | 1) => {
      const index = order.indexOf(id);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= order.length) return;
      const next = order.slice();
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      update(next, hidden);
    },
    reset: () => update(LIVE_REPORT_WIDGET_IDS.slice(), new Set()),
  };
}

// Lightweight modal — not ModalShell (also an app.jsx internal, same
// self-containment reasoning as the layout hook above). Handles Escape and
// backdrop click; doesn't bother with a full focus trap, since this is a
// small settings list, not a form with anything to lose by tabbing out of it.
function LiveReportCustomizeModal({
  layout,
  onClose,
}: {
  layout: ReturnType<typeof useLiveReportLayout>;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.customizeOverlay} onClick={onClose}>
      <div className={styles.customizePanel} role="dialog" aria-modal="true" aria-labelledby="live-report-customize-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.customizeHeader}>
          <h3 id="live-report-customize-title">Customize your Live Report</h3>
          <button type="button" className={styles.customizeClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.customizeList}>
          {layout.order.map((id, index) => {
            const meta = LIVE_REPORT_WIDGETS.find((w) => w.id === id)!;
            const isHidden = layout.hidden.has(id);
            return (
              <div className={styles.customizeRow} key={id}>
                <label className={styles.customizeCheckboxLabel}>
                  <input type="checkbox" checked={!isHidden} onChange={() => layout.toggle(id)} />
                  <span>
                    <span className={styles.customizeRowLabel}>{meta.label}</span>
                    <span className={styles.customizeRowDesc}>{meta.description}</span>
                  </span>
                </label>
                <div className={styles.customizeMoveGroup}>
                  <button type="button" disabled={index === 0} onClick={() => layout.move(id, -1)} aria-label={`Move ${meta.label} up`}>
                    ▲
                  </button>
                  <button type="button" disabled={index === layout.order.length - 1} onClick={() => layout.move(id, 1)} aria-label={`Move ${meta.label} down`}>
                    ▼
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.customizeFooter}>
          <button type="button" className={styles.customizeReset} onClick={layout.reset}>
            Reset to default
          </button>
          <button type="button" className={styles.customizeDone} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function LiveReportCustomizeButton({ layout }: { layout: ReturnType<typeof useLiveReportLayout> }) {
  const [open, setOpen] = useState(false);
  return (
    <React.Fragment>
      <button type="button" className={styles.customizeTrigger} onClick={() => setOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M8 12h12M4 18h16" />
          <circle cx="6" cy="6" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="16" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="9" cy="18" r="1.6" fill="currentColor" stroke="none" />
        </svg>
        Customize Live Report
      </button>
      {open && <LiveReportCustomizeModal layout={layout} onClose={() => setOpen(false)} />}
    </React.Fragment>
  );
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

// Reuses the anomaly severity pill styling for aging-bucket tags in the
// Collections queue, rather than inventing a second pill class for the
// same visual language. Defined after AnomalyList's own SEV_LABEL_CLASS
// exists below, so it's declared as a function to defer the styles.* lookup.
function sevLabelClassByTone(tone: AgingTone): string {
  const map: Record<AgingTone, string> = {
    good: styles.sevLabelGood,
    neutral: styles.sevLabelWarn,
    warning: styles.sevLabelWarn,
    critical: styles.sevLabelCritical,
  };
  return map[tone];
}

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
   Collections queue — select overdue receivables and draft a reminder
   ============================================================ */

function CollectionsQueue({
  items,
  clientName,
}: {
  items: NonNullable<DailyCloseData["receivables"]["list"]>;
  clientName: string;
}) {
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const overdue = items.filter((r) => r.tone !== "good");

  if (overdue.length === 0) return null;

  const toggle = (id: number | string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = overdue.filter((r) => selected.has(r.id));
  const selectedTotal = selectedRows.reduce((s, r) => s + r.amount, 0);

  const draftReminder = () => {
    const rows = selectedRows.length ? selectedRows : overdue;
    const subject = `Payment reminder — ${clientName}`;
    const lines = rows.map((r) => `- ${r.description}: ${fmtMoney(r.amount)}, due ${r.dueDate} (${r.daysOverdue} days overdue)`);
    const body =
      `Hi,\n\nThis is a friendly reminder that the following balance${rows.length > 1 ? "s are" : " is"} still outstanding:\n\n` +
      lines.join("\n") +
      `\n\nTotal: ${fmtMoney(rows.reduce((s, r) => s + r.amount, 0))}\n\nPlease let us know if you have any questions.\n\nThank you,\n${clientName}`;
    // No customer email address is in the underlying data yet — this opens a
    // blank-recipient draft in the browser's own mail client for the client
    // to address and send themselves, same honest-mock posture as the rest
    // of the app's "real email you review and hit send on" flows.
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_self");
  };

  return (
    <div className={styles.collectionsQueue}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.panelTitle}>Collections Queue</div>
          <div className={styles.panelSub}>
            {selectedRows.length > 0
              ? `${selectedRows.length} selected · ${fmtMoney(selectedTotal)}`
              : `${overdue.length} overdue invoice${overdue.length !== 1 ? "s" : ""}`}
          </div>
        </div>
        <button type="button" className={styles.collectionsDraftBtn} onClick={draftReminder}>
          Draft Reminder{selectedRows.length > 1 ? " Email" : ""}
        </button>
      </div>
      <div className={styles.collectionsList}>
        {overdue.map((r) => (
          <label className={styles.collectionsRow} key={r.id}>
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
            <span className={styles.collectionsDesc}>{r.description}</span>
            <span className={`${styles.sevLabel} ${sevLabelClassByTone(r.tone)}`}>{r.bucketLabel}</span>
            <span className={`${styles.num} ${styles.collectionsAmt}`}>{fmtMoney(r.amount)}</span>
          </label>
        ))}
      </div>
    </div>
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

function AnomalyList({
  items,
  reviewed,
  onToggleReviewed,
}: {
  items: DailyCloseData["anomalies"];
  reviewed: Set<number>;
  onToggleReviewed: (index: number) => void;
}) {
  // Unreviewed first, so the working queue reads top-to-bottom as "what's
  // left," not in whatever order the flags happened to generate in.
  const ordered = items
    .map((a, i) => ({ a, i }))
    .sort((x, y) => Number(reviewed.has(x.i)) - Number(reviewed.has(y.i)));

  return (
    <div className={styles.anomalyList}>
      {ordered.map(({ a, i }) => {
        const isReviewed = reviewed.has(i);
        return (
          <div className={`${styles.anomaly} ${isReviewed ? styles.anomalyReviewed : ""}`} key={i}>
            <div className={`${styles.sevStripe} ${SEV_STRIPE[a.severity]}`} />
            <div className={styles.anomalyBody}>
              <div className={styles.anomalyTop}>
                <div className={styles.anomalyTitle}>{a.title}</div>
                <div className={`${styles.anomalyAmt} ${styles.num}`}>{a.amount}</div>
              </div>
              <div className={styles.anomalyDesc}>{a.description}</div>
              <div className={styles.anomalyFoot}>
                <div className={`${styles.sevLabel} ${SEV_LABEL_CLASS[a.severity]}`}>{SEV_COPY[a.severity]}</div>
                <button type="button" className={styles.anomalyReviewBtn} onClick={() => onToggleReviewed(i)}>
                  {isReviewed ? "Undo" : "Mark reviewed"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   Main component
   ============================================================ */

type OutlookTab = "forecast" | "trend" | "anomalies";

function DailyClose({ data, className, theme, onNavigate }: DailyCloseProps) {
  const [tab, setTab] = useState<OutlookTab>("forecast");
  const [reviewedAnomalies, setReviewedAnomalies] = useState<Set<number>>(new Set());
  const [cashFloor, setCashFloor] = useState<number | null>(() => readCashFloor(data.client.id));
  const [editingFloor, setEditingFloor] = useState(false);
  const [floorDraft, setFloorDraft] = useState("");
  const layout = useLiveReportLayout(data.client.id);

  const agingRef = useRef<HTMLDivElement>(null);
  const outlookRef = useRef<HTMLDivElement>(null);

  const trendLabels = [...data.trend.months, ...data.trend.projectedMonths];
  const trendRevenue = [...data.trend.revenue, ...data.trend.projectedRevenue];
  const trendExpense = [...data.trend.expense, ...data.trend.projectedExpense];

  const marginMeterPct = Math.min(100, (data.netIncome.marginPct / (data.netIncome.marginTargetPct * 2)) * 100);
  const marginTargetPct = 50; // target sits at the midpoint of the 0..2x-target scale

  const toggleReviewed = (index: number) => {
    setReviewedAnomalies((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const jumpToAging = () => agingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const jumpToOutlook = (nextTab: OutlookTab) => {
    setTab(nextTab);
    outlookRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const saveFloor = () => {
    const n = Number(floorDraft);
    const next = floorDraft.trim() === "" || !Number.isFinite(n) ? null : n;
    setCashFloor(next);
    writeCashFloor(data.client.id, next);
    setEditingFloor(false);
  };

  const belowFloor = cashFloor !== null && data.cash.total < cashFloor;

  // Snapshot PDF — mirrors the navy theme app.jsx's own report PDFs use
  // (rgb(5, 8, 13) is --navy, #05080d). jsPDF/autoTable are loaded globally
  // by index.html the same way app.jsx's PDF builders rely on them.
  const downloadPdf = () => {
    const w = window as any;
    if (!w.jspdf) return;
    const doc = new w.jspdf.jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFillColor(5, 8, 13);
    doc.rect(0, 0, pageWidth, 28, "F");
    doc.setTextColor(250, 249, 246);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("MyGoodBooks", 14, 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(data.client.name, 14, 19.5);

    doc.setTextColor(5, 8, 13);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Live Report", 14, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110, 110, 110);
    doc.text(data.client.asOfLabel, 14, 47);

    const tableTheme = {
      theme: "striped",
      styles: { fontSize: 9, cellPadding: 3, textColor: [5, 8, 13] },
      headStyles: { fillColor: [5, 8, 13], textColor: [250, 249, 246], fontStyle: "bold" },
      margin: { left: 14, right: 14 },
    };

    doc.autoTable({
      startY: 55,
      head: [["Key metric", "Value"]],
      body: [
        ["Cash on hand", fmtMoney(data.cash.total)],
        ["Accounts receivable", fmtMoney(data.receivables.total) + ` (${fmtMoney(data.receivables.overdueAmount)} overdue)`],
        ["Accounts payable", fmtMoney(data.payables.total)],
        ["Net income, MTD", fmtMoney(data.netIncome.mtd)],
      ],
      columnStyles: { 1: { halign: "right" } },
      ...tableTheme,
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [["Receivables aging", "Amount"]],
      body: data.receivables.aging.map((b) => [b.label, fmtMoney(b.amount)]),
      columnStyles: { 1: { halign: "right" } },
      ...tableTheme,
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [["Flagged for review", "Amount"]],
      body: data.anomalies.map((a) => [a.title, a.amount]),
      columnStyles: { 1: { halign: "right" } },
      ...tableTheme,
    });

    doc.save(`${data.client.name.replace(/\s+/g, "_")}_Live_Report.pdf`);
  };

  return (
    <div className={`${styles.dailyClose} ${className ?? ""}`} data-theme={theme}>
      <div className={styles.page}>
        {/* ---------- Masthead ---------- */}
        <header className={styles.masthead}>
          <div>
            <div className={styles.brandEyebrow}>{data.firm.name}</div>
            <h1 className={styles.brandTitle}>
              Live <span className={styles.accentword}>Report</span>
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
            <button type="button" className={styles.downloadBtn} onClick={downloadPdf}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
                <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
              </svg>
              Download Live Report
            </button>
          </div>
        </header>

        <LiveReportCustomizeButton layout={layout} />

        {/* ---------- KPI row ---------- */}
        <section className={styles.kpiRow} aria-label="Key metrics">
          {layout.visibleOrder
            .filter((id) => id.startsWith("kpi-"))
            .map((id) => {
              if (id === "kpi-cash")
                return (
                  <div className={`${styles.kpiTile} ${belowFloor ? styles.kpiTileAlert : ""}`} key={id}>
                    <div className={styles.kpiTileTop}>
                      <div className={styles.kpiLabel}>Cash on hand</div>
                      <button
                        type="button"
                        className={styles.cashFloorTrigger}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFloorDraft(cashFloor !== null ? String(cashFloor) : "");
                          setEditingFloor((v) => !v);
                        }}
                        title="Set a low-cash alert"
                      >
                        Alert
                      </button>
                    </div>
                    {editingFloor ? (
                      <div className={styles.cashFloorEditor} onClick={(e) => e.stopPropagation()}>
                        <span>Alert below $</span>
                        <input
                          type="number"
                          className={styles.cashFloorInput}
                          value={floorDraft}
                          onChange={(e) => setFloorDraft(e.target.value)}
                          placeholder="e.g. 10000"
                          autoFocus
                        />
                        <button type="button" className={styles.cashFloorSave} onClick={saveFloor}>
                          Save
                        </button>
                      </div>
                    ) : (
                      <React.Fragment>
                        <div className={styles.kpiValue}>
                          {fmtMoney(data.cash.total)}
                          {data.cash.cents !== undefined && <small>.{String(data.cash.cents).padStart(2, "0")}</small>}
                        </div>
                        <div className={`${styles.delta} ${data.cash.deltaVsYesterday >= 0 ? styles.deltaUp : styles.deltaDown}`}>
                          {data.cash.deltaVsYesterday >= 0 ? "▲" : "▼"} {fmtMoney(Math.abs(data.cash.deltaVsYesterday))} vs. yesterday
                        </div>
                        {belowFloor && (
                          <div className={styles.cashFloorWarning}>Below your {fmtMoney(cashFloor as number)} alert threshold</div>
                        )}
                        <Sparkline values={data.cash.sparkline14d} color="var(--series-revenue)" />
                      </React.Fragment>
                    )}
                  </div>
                );

              if (id === "kpi-ar")
                return (
                  <button type="button" className={`${styles.kpiTile} ${styles.kpiTileClickable}`} onClick={jumpToAging} key={id}>
                    <div className={styles.kpiLabel}>Accounts receivable</div>
                    <div className={styles.kpiValue}>{fmtMoney(data.receivables.total)}</div>
                    <div className={`${styles.chip} ${styles.chipWarn}`}>
                      <span className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)" }} />
                      {fmtMoney(data.receivables.overdueAmount)} overdue
                    </div>
                    <div className={styles.kpiFoot} style={{ marginTop: "auto" }}>
                      {data.receivables.openInvoiceCount} open invoices, {data.receivables.customerCount} customers
                    </div>
                  </button>
                );

              if (id === "kpi-ap")
                return (
                  <button
                    type="button"
                    className={`${styles.kpiTile} ${onNavigate ? styles.kpiTileClickable : ""}`}
                    onClick={() => onNavigate && onNavigate("ap-command-center")}
                    disabled={!onNavigate}
                    key={id}
                  >
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
                      {fmtMoney(data.payables.dueWithin7Days)} due within 7 days{onNavigate ? " · view in AP Command Center" : ""}
                    </div>
                  </button>
                );

              // kpi-net
              return (
                <button type="button" className={`${styles.kpiTile} ${styles.kpiTileClickable}`} onClick={() => jumpToOutlook("trend")} key={id}>
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
                </button>
              );
            })}
        </section>

        {/* ---------- Everything below the KPI row is order/visibility-driven
             by the Customize Live Report layout, same idea as Dashboard's
             own customizable content-masonry in app.jsx. ---------- */}
        <div className={styles.contentMasonry}>
          {layout.visibleOrder
            .filter((id) => !id.startsWith("kpi-"))
            .map((id) => {
              if (id === "trend")
                return (
                  <div className={styles.panel} key={id}>
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
                );

              if (id === "expense-breakdown")
                return (
                  <div className={styles.panel} key={id}>
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
                );

              if (id === "aging")
                return (
                  <div className={styles.panel} ref={agingRef} key={id}>
                    <div className={styles.panelHead}>
                      <div>
                        <div className={styles.panelTitle}>Receivables aging</div>
                        <div className={styles.panelSub}>{fmtMoney(data.receivables.total)} outstanding across {data.receivables.openInvoiceCount} invoices</div>
                      </div>
                    </div>
                    <AgingBar items={data.receivables.aging} />
                    {data.receivables.list && <CollectionsQueue items={data.receivables.list} clientName={data.client.name} />}
                  </div>
                );

              // outlook
              return (
                <div className={styles.outlook} ref={outlookRef} key={id}>
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
                        {/* Thin-line, currentColor icon — matches the rest of the app's icon style,
                            no emoji. */}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M9 18h6M10 21h4" />
                          <path d="M12 3a6 6 0 00-3.6 10.8c.6.45 1.1 1.2 1.1 2.2h5c0-1 .5-1.75 1.1-2.2A6 6 0 0012 3z" />
                        </svg>
                        <span>{data.forecast90d.narrative}</span>
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
                      <AnomalyList items={data.anomalies} reviewed={reviewedAnomalies} onToggleReviewed={toggleReviewed} />
                    </div>
                  )}
                </div>
              );
            })}
        </div>

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
