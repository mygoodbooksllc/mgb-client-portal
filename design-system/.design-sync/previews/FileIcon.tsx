import React from 'react';
import { FileIcon, Button } from 'mygoodbooks-ds';

// Icons inherit color from `currentColor` and default to 16px; pass width/height to resize.
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20, color: 'var(--text)' }}>
    <FileIcon />
    <FileIcon width={24} height={24} />
    <FileIcon width={32} height={32} />
    <FileIcon width={48} height={48} strokeWidth={1.4} />
  </div>
);

export const Tones = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <span style={{ color: 'var(--ink-strong)' }}><FileIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--gold-deep)' }}><FileIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--good)' }}><FileIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--bad)' }}><FileIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--text-muted)' }}><FileIcon width={28} height={28} /></span>
  </div>
);

export const InButton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    <Button variant="secondary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <FileIcon /> Bank statement.pdf
      </span>
    </Button>
    <Button variant="primary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <FileIcon /> Bank statement.pdf
      </span>
    </Button>
  </div>
);
