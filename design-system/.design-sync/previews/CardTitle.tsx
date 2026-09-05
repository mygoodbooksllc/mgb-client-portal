import React from 'react';
import { Card, CardTitle } from 'mygoodbooks-ds';

export const Default = () => (
  <Card style={{ width: 320 }}>
    <CardTitle>Income vs. Expenses</CardTitle>
  </Card>
);

export const WithInlineStyle = () => (
  <Card style={{ width: 320 }}>
    <CardTitle style={{ margin: 0 }}>Grace Community Church</CardTitle>
  </Card>
);
