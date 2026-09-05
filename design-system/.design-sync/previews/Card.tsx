import React from 'react';
import { Card, CardTitle, CardSubtitle } from 'mygoodbooks-ds';

export const Default = () => (
  <Card style={{ width: 320 }}>
    <CardTitle>Recent Activity</CardTitle>
    <CardSubtitle>Transactions in your areas</CardSubtitle>
    <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
      Aug 24 · $500.00 · General Operating
    </p>
  </Card>
);

export const Report = () => (
  <Card style={{ width: 320 }} className="report-card">
    <CardTitle>Monthly Financial Statement</CardTitle>
    <CardSubtitle>Income statement, balance sheet, and cash flow for the current month</CardSubtitle>
  </Card>
);

export const SubtitleOnly = () => (
  <Card style={{ width: 320 }}>
    <CardTitle>Fund Balances</CardTitle>
    <CardSubtitle>What the money in the bank is designated for</CardSubtitle>
  </Card>
);
