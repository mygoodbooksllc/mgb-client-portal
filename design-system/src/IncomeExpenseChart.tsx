import React from "react";

/** One month's income/expense totals. */
export interface MonthlyDatum {
  /** Short month label shown on the x-axis (e.g. "Jan"). */
  month: string;
  income: number;
  expenses: number;
}

/** Props for {@link IncomeExpenseChart}. */
export interface IncomeExpenseChartProps {
  /** Monthly income/expense series, oldest first. */
  monthly: MonthlyDatum[];
}

// Builds a smooth cubic-bezier path through a set of {x,y} points, using the
// midpoint between each pair as the control-point anchor — cheap and good
// enough for a handful of monthly points, no need for full Catmull-Rom.
function smoothLinePath(points: { x: number; y: number }[]) {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    d += ` C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

function smoothAreaPath(points: { x: number; y: number }[], baseline: number) {
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

/**
 * Filled area chart plotting income vs. expenses over a monthly series.
 * Pure SVG, no charting library dependency.
 */
export function IncomeExpenseChart({ monthly }: IncomeExpenseChartProps) {
  const width = 640;
  const height = 220;
  const padding = { top: 32, right: 14, bottom: 28, left: 46 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const baseline = padding.top + innerH;

  const maxVal = Math.max(...monthly.flatMap((m) => [m.income, m.expenses])) * 1.15;

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (maxVal / yTicks) * i);

  const xFor = (i: number) => padding.left + (monthly.length === 1 ? innerW / 2 : (i / (monthly.length - 1)) * innerW);
  const incomePoints = monthly.map((m, i) => ({ x: xFor(i), y: baseline - (m.income / maxVal) * innerH }));
  const expensePoints = monthly.map((m, i) => ({ x: xFor(i), y: baseline - (m.expenses / maxVal) * innerH }));

  const gradientId = `oc-income-fill-${monthly.length}-${Math.round(maxVal)}`;
  const gradientIdExp = `oc-expense-fill-${monthly.length}-${Math.round(maxVal)}`;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-income)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--chart-income)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={gradientIdExp} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <g className="chart-inline-legend">
          <rect x={width - 190} y="10" width="10" height="10" rx="2" fill="var(--chart-income)" />
          <text x={width - 176} y="19" fontSize="11.5" fill="var(--text-muted)">Income</text>
          <rect x={width - 100} y="10" width="10" height="10" rx="2" fill="var(--gold)" />
          <text x={width - 86} y="19" fontSize="11.5" fill="var(--text-muted)">Expenses</text>
        </g>

        {tickVals.map((v, i) => {
          const y = padding.top + innerH - (v / maxVal) * innerH;
          return (
            <g key={i}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 4} fontSize="10.5" fill="var(--text-muted)" textAnchor="end">
                {v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}
              </text>
            </g>
          );
        })}

        <path d={smoothAreaPath(expensePoints, baseline)} fill={`url(#${gradientIdExp})`} />
        <path d={smoothLinePath(expensePoints)} fill="none" stroke="var(--gold)" strokeWidth="2" />
        <path d={smoothAreaPath(incomePoints, baseline)} fill={`url(#${gradientId})`} />
        <path d={smoothLinePath(incomePoints)} fill="none" stroke="var(--chart-income)" strokeWidth="2.5" />

        {incomePoints.map((p, i) => (
          <circle key={"i" + i} cx={p.x} cy={p.y} r="3.5" fill="var(--surface)" stroke="var(--chart-income)" strokeWidth="2" />
        ))}
        {expensePoints.map((p, i) => (
          <circle key={"e" + i} cx={p.x} cy={p.y} r="3.5" fill="var(--surface)" stroke="var(--gold)" strokeWidth="2" />
        ))}

        {monthly.map((m, i) => (
          <text key={m.month} x={xFor(i)} y={height - 8} fontSize="11.5" fill="var(--text-muted)" textAnchor="middle">
            {m.month}
          </text>
        ))}
      </svg>
    </div>
  );
}
