import React from 'react';
import { UploadIcon, Button } from 'mygoodbooks-ds';

// Icons inherit color from `currentColor` and default to 16px; pass width/height to resize.
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20, color: 'var(--text)' }}>
    <UploadIcon />
    <UploadIcon width={24} height={24} />
    <UploadIcon width={32} height={32} />
    <UploadIcon width={48} height={48} strokeWidth={1.4} />
  </div>
);

export const Tones = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <span style={{ color: 'var(--ink-strong)' }}><UploadIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--gold-deep)' }}><UploadIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--good)' }}><UploadIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--bad)' }}><UploadIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--text-muted)' }}><UploadIcon width={28} height={28} /></span>
  </div>
);

export const InButton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    <Button variant="secondary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <UploadIcon /> Upload documents
      </span>
    </Button>
    <Button variant="primary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <UploadIcon /> Upload documents
      </span>
    </Button>
  </div>
);
