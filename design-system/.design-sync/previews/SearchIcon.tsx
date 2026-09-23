import React from 'react';
import { SearchIcon, Button } from 'mygoodbooks-ds';

// Icons inherit color from `currentColor` and default to 16px; pass width/height to resize.
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20, color: 'var(--text)' }}>
    <SearchIcon />
    <SearchIcon width={24} height={24} />
    <SearchIcon width={32} height={32} />
    <SearchIcon width={48} height={48} strokeWidth={1.4} />
  </div>
);

export const Tones = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <span style={{ color: 'var(--ink-strong)' }}><SearchIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--gold-deep)' }}><SearchIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--good)' }}><SearchIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--bad)' }}><SearchIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--text-muted)' }}><SearchIcon width={28} height={28} /></span>
  </div>
);

export const InButton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    <Button variant="secondary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <SearchIcon /> Search clients
      </span>
    </Button>
    <Button variant="primary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <SearchIcon /> Search clients
      </span>
    </Button>
  </div>
);
