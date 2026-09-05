import React from 'react';
import { MockBanner } from 'mygoodbooks-ds';

export const Default = () => (
  <MockBanner text="Every number on this page is sample data for prototyping — no QuickBooks or bank connection yet." />
);

export const ReportContext = () => (
  <MockBanner text="Reports are generated as real PDFs from this client's mock data — once QuickBooks is connected in Phase 2, these will reflect live books." />
);

export const LongText = () => (
  <MockBanner text="Uploaded files stay in your browser for this session only — nothing is actually stored yet." />
);
