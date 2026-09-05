import React from "react";
import { fmtMoney } from "./utils";

/** One row in a {@link ReportBarRows} list. */
export interface ReportBarRowItem {
  /** Row label, also used as the React key — must be unique within the list. */
  label: string;
  /** Bar value; magnitude drives bar width, sign is shown in the trailing amount. */
  amount: number;
  /** CSS class applied to the bar fill (e.g. "under"/"over" from the shared bar-fill tones). Defaults to the report-builder gold fill. */
  tone?: string;
}

/** Props for {@link ReportBarRows}. */
export interface ReportBarRowsProps {
  /** Rows to render, each as a label + horizontal bar + trailing amount. */
  items: ReportBarRowItem[];
}

/**
 * Small horizontal bar list — same visual language as the shared
 * bar-track/bar-fill elements used elsewhere, laid out as label/bar/amount
 * rows rather than inline in a table cell. Originally built for the Report
 * Builder's budget and fund breakdowns.
 */
export function ReportBarRows({ items }: ReportBarRowsProps) {
  const max = Math.max(...items.map((i) => Math.abs(i.amount)), 1);
  return (
    <div className="rb-bar-rows">
      {items.map((item) => (
        <div className="rb-bar-row" key={item.label}>
          <span>{item.label}</span>
          <div className="bar-track">
            <div
              className={"bar-fill " + (item.tone || "rb-bar-fill")}
              style={{ width: `${Math.max(4, Math.round((Math.abs(item.amount) / max) * 100))}%` }}
            ></div>
          </div>
          <span className="rb-bar-amt">{fmtMoney(item.amount)}</span>
        </div>
      ))}
    </div>
  );
}
