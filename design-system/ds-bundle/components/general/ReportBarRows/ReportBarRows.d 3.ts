import * as React from 'react';

/**
 * ReportBarRows — from mygoodbooks-ds@0.1.0.
 */
export interface ReportBarRowsProps {
  /** Rows to render, each as a label + horizontal bar + trailing amount. */
  items: ReportBarRowItem[];
}

export declare const ReportBarRows: React.ComponentType<ReportBarRowsProps>;
