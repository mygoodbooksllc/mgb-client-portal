import * as React from 'react';

/**
 * Badge — from mygoodbooks-ds@0.1.0.
 */
export interface BadgeProps {
  /** Text shown next to the status dot (e.g. "Prototype · Sample Data"). */
  label: string;
  /** Additional class name(s) appended to the root element. */
  className?: string;
}

export declare const Badge: React.ComponentType<BadgeProps>;
