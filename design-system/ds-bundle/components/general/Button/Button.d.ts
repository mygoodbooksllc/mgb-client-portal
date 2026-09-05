import * as React from 'react';

/**
 * Button — from mygoodbooks-ds@0.1.0.
 * @replaces button
 */
export interface ButtonProps {
  /** Visual style — "primary" is the solid navy pill (`.btn-primary`), "secondary" the outlined pill (`.btn-secondary`). Defa */
  variant?: "primary" | "secondary";
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const Button: React.ComponentType<ButtonProps>;
