import React from 'react';
import { MoonIcon, Button } from 'mygoodbooks-ds';

// Icons inherit color from `currentColor` and default to 16px; pass width/height to resize.
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20, color: 'var(--text)' }}>
    <MoonIcon />
    <MoonIcon width={24} height={24} />
    <MoonIcon width={32} height={32} />
    <MoonIcon width={48} height={48} strokeWidth={1.4} />
  </div>
);

export const Tones = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <span style={{ color: 'var(--ink-strong)' }}><MoonIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--gold-deep)' }}><MoonIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--good)' }}><MoonIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--bad)' }}><MoonIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--text-muted)' }}><MoonIcon width={28} height={28} /></span>
  </div>
);

export const InButton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    <Button variant="secondary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <MoonIcon /> Dark mode
      </span>
    </Button>
    <Button variant="primary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <MoonIcon /> Dark mode
      </span>
    </Button>
  </div>
);
