import * as React from 'react';

/**
 * IncomeExpenseChart — from mygoodbooks-ds@0.1.0.
 */
export interface IncomeExpenseChartProps {
  /** Monthly income/expense series, oldest first. */
  monthly: MonthlyDatum[];
}

export declare const IncomeExpenseChart: React.ComponentType<IncomeExpenseChartProps>;
