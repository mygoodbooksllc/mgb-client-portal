import React from 'react';
import { SlidersIcon, Button } from 'mygoodbooks-ds';

// Icons inherit color from `currentColor` and default to 16px; pass width/height to resize.
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20, color: 'var(--text)' }}>
    <SlidersIcon />
    <SlidersIcon width={24} height={24} />
    <SlidersIcon width={32} height={32} />
    <SlidersIcon width={48} height={48} strokeWidth={1.4} />
  </div>
);

export const Tones = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <span style={{ color: 'var(--ink-strong)' }}><SlidersIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--gold-deep)' }}><SlidersIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--good)' }}><SlidersIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--bad)' }}><SlidersIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--text-muted)' }}><SlidersIcon width={28} height={28} /></span>
  </div>
);

export const InButton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    <Button variant="secondary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <SlidersIcon /> Customize dashboard
      </span>
    </Button>
    <Button variant="primary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <SlidersIcon /> Customize dashboard
      </span>
    </Button>
  </div>
);
