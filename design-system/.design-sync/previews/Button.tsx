import React from 'react';
import { Button } from 'mygoodbooks-ds';

export const Primary = () => <Button variant="primary">Export CSV</Button>;

export const Secondary = () => <Button variant="secondary">Cancel</Button>;

export const Disabled = () => (
  <Button variant="primary" disabled>
    Send Referral
  </Button>
);

export const Group = () => (
  <div style={{ display: 'flex', gap: 10 }}>
    <Button variant="secondary">Cancel</Button>
    <Button variant="primary">Save</Button>
  </div>
);
