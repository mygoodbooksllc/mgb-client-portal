import React from 'react';
import { IncomeExpenseChart, Card, CardTitle, CardSubtitle } from 'mygoodbooks-ds';

export const SixMonths = () => (
  <Card style={{ width: 680 }}>
    <CardTitle>Income vs. Expenses</CardTitle>
    <CardSubtitle>Last 6 months</CardSubtitle>
    <IncomeExpenseChart
      monthly={[
        { month: 'Mar', income: 52000, expenses: 47800 },
        { month: 'Apr', income: 54200, expenses: 48900 },
        { month: 'May', income: 58900, expenses: 51200 },
        { month: 'Jun', income: 61200, expenses: 53800 },
        { month: 'Jul', income: 59800, expenses: 52900 },
        { month: 'Aug', income: 63500, expenses: 55100 },
      ]}
    />
  </Card>
);

export const SmallOrg = () => (
  <Card style={{ width: 680 }}>
    <CardTitle>Income vs. Expenses</CardTitle>
    <CardSubtitle>Last 6 months</CardSubtitle>
    <IncomeExpenseChart
      monthly={[
        { month: 'Mar', income: 9200, expenses: 9800 },
        { month: 'Apr', income: 8900, expenses: 10100 },
        { month: 'May', income: 11200, expenses: 10500 },
        { month: 'Jun', income: 10100, expenses: 10800 },
        { month: 'Jul', income: 9800, expenses: 10950 },
        { month: 'Aug', income: 9500, expenses: 11200 },
      ]}
    />
  </Card>
);
