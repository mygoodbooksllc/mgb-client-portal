import React from 'react';
import { Card, CardTitle, CardSubtitle } from 'mygoodbooks-ds';

export const Default = () => (
  <Card style={{ width: 320 }}>
    <CardTitle>Recent Contributions</CardTitle>
    <CardSubtitle>Individual gifts and grants received</CardSubtitle>
  </Card>
);

export const NoRecords = () => (
  <Card style={{ width: 320 }}>
    <CardTitle>Recent Activity</CardTitle>
    <CardSubtitle>No recent transactions in your areas.</CardSubtitle>
  </Card>
);
