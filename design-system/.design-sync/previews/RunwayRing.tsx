import React from 'react';
import { RunwayRing, Card } from 'mygoodbooks-ds';

export const Positive = () => (
  <Card className="runway-ring-card" style={{ width: 220 }}>
    <RunwayRing pct={0.78} tone="positive">
      <div className="runway-ring-value">9.4 mo</div>
      <div className="runway-ring-status positive">Healthy</div>
    </RunwayRing>
  </Card>
);

export const Negative = () => (
  <Card className="runway-ring-card" style={{ width: 220 }}>
    <RunwayRing pct={0.18} tone="negative">
      <div className="runway-ring-value">2.1 mo</div>
      <div className="runway-ring-status negative">Low</div>
    </RunwayRing>
  </Card>
);

export const NearFull = () => (
  <Card className="runway-ring-card" style={{ width: 220 }}>
    <RunwayRing pct={0.98} tone="positive">
      <div className="runway-ring-value">11.7 mo</div>
      <div className="runway-ring-status positive">Strong</div>
    </RunwayRing>
  </Card>
);
