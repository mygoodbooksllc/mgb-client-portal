import React from 'react';
import { AccountCashDonut, Card, CardTitle, CardSubtitle } from 'mygoodbooks-ds';

export const Default = () => (
  <Card style={{ width: 340 }}>
    <CardTitle>Cash by Account</CardTitle>
    <CardSubtitle style={{ margin: 0 }}>Share of total cash on hand</CardSubtitle>
    <AccountCashDonut
      accounts={[
        { id: 1, accountName: 'General Operating', balance: 68420.55 },
        { id: 2, accountName: 'Building Fund Savings', balance: 142300.0 },
      ]}
    />
  </Card>
);

export const ManyAccounts = () => (
  <Card style={{ width: 340 }}>
    <CardTitle>Cash by Account</CardTitle>
    <CardSubtitle style={{ margin: 0 }}>Share of total cash on hand</CardSubtitle>
    <AccountCashDonut
      accounts={[
        { id: 1, accountName: 'General Operating', balance: 4820.3 },
        { id: 2, accountName: 'Missions Reserve', balance: 1650.0 },
        { id: 3, accountName: 'Benevolence Fund', balance: 640.0 },
        { id: 4, accountName: 'Building Reserve', balance: 2200.0 },
      ]}
    />
  </Card>
);
