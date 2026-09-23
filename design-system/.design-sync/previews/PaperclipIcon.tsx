import React from 'react';
import { PaperclipIcon, Button } from 'mygoodbooks-ds';

// Icons inherit color from `currentColor` and default to 16px; pass width/height to resize.
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20, color: 'var(--text)' }}>
    <PaperclipIcon />
    <PaperclipIcon width={24} height={24} />
    <PaperclipIcon width={32} height={32} />
    <PaperclipIcon width={48} height={48} strokeWidth={1.4} />
  </div>
);

export const Tones = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <span style={{ color: 'var(--ink-strong)' }}><PaperclipIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--gold-deep)' }}><PaperclipIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--good)' }}><PaperclipIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--bad)' }}><PaperclipIcon width={28} height={28} /></span>
    <span style={{ color: 'var(--text-muted)' }}><PaperclipIcon width={28} height={28} /></span>
  </div>
);

export const InButton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    <Button variant="secondary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <PaperclipIcon /> Attach file
      </span>
    </Button>
    <Button variant="primary">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <PaperclipIcon /> Attach file
      </span>
    </Button>
  </div>
);
