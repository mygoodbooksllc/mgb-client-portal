import React from 'react';
import { ReportBarRows, Card, CardTitle } from 'mygoodbooks-ds';

export const FundBalances = () => (
  <Card style={{ width: 420 }}>
    <CardTitle>Fund Balances</CardTitle>
    <ReportBarRows
      items={[
        { label: 'Building Fund', amount: 142300.0 },
        { label: 'General Fund', amount: 35850.55 },
        { label: 'Missions Fund', amount: 18750.0 },
        { label: 'Benevolence Fund', amount: 6420.0 },
        { label: 'Kids Ministry Fund', amount: 5180.0 },
      ]}
    />
  </Card>
);

export const BudgetVsActual = () => (
  <Card style={{ width: 420 }}>
    <CardTitle>Spending by Category</CardTitle>
    <ReportBarRows
      items={[
        { label: 'Payroll — under budget', amount: 18200, tone: 'under' },
        { label: 'Facilities — over budget', amount: 6400, tone: 'over' },
        { label: 'Missions — under budget', amount: 3100, tone: 'under' },
      ]}
    />
  </Card>
);
