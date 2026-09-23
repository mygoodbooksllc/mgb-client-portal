import React from 'react';
import { ClientRosterIcon, Button } from 'mygoodbooks-ds';

// Icons inherit color from `currentColor` and default to 16px; pass width/height to resize.
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20, color: 'var(--text)' }}>
    <ClientRosterIcon />
    <ClientRosterIcon width={24} height={24} />
    <ClientRosterIcon width={32} height={32} />
    <ClientRosterIcon width={48} height={48} strokeWidth={1.4} />
  </div>
);

export const Tones = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <span style={{ color: 'var(--ink-strong)' }}><ClientRosterIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--gold-deep)' }}><ClientRosterIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--good)' }}><ClientRosterIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--bad)' }}><ClientRosterIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--text-muted)' }}><ClientRosterIcon width={28} height={28} /></span>
  </div>
);

export const InButton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    <Button variant="secondary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <ClientRosterIcon /> Client Roster
      </span>
    </Button>
    <Button variant="primary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <ClientRosterIcon /> Client Roster
      </span>
    </Button>
  </div>
);
