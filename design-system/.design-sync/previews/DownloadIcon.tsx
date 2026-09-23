import React from 'react';
import { DownloadIcon, Button } from 'mygoodbooks-ds';

// Icons inherit color from `currentColor` and default to 16px; pass width/height to resize.
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20, color: 'var(--text)' }}>
    <DownloadIcon />
    <DownloadIcon width={24} height={24} />
    <DownloadIcon width={32} height={32} />
    <DownloadIcon width={48} height={48} strokeWidth={1.4} />
  </div>
);

export const Tones = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <span style={{ color: 'var(--ink-strong)' }}><DownloadIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--gold-deep)' }}><DownloadIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--good)' }}><DownloadIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--bad)' }}><DownloadIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--text-muted)' }}><DownloadIcon width={28} height={28} /></span>
  </div>
);

export const InButton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    <Button variant="secondary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <DownloadIcon /> Download PDF
      </span>
    </Button>
    <Button variant="primary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <DownloadIcon /> Download PDF
      </span>
    </Button>
  </div>
);
