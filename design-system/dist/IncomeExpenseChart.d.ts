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
/**
 * Filled area chart plotting income vs. expenses over a monthly series.
 * Pure SVG, no charting library dependency.
 */
export declare function IncomeExpenseChart({ monthly }: IncomeExpenseChartProps): React.JSX.Element;
