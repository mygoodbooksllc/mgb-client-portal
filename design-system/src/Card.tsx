import React from "react";

/** Props for {@link Card}. */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

/**
 * Generic glass-surface container used throughout the app for KPI tiles,
 * page sections, and grid items. Synthesized from the `.card` class shared
 * by dozens of `className="card"` divs in app.jsx — this is not a single
 * original component but the canonical wrapper for that pattern.
 */
export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div className={"card" + (className ? " " + className : "")} {...rest}>
      {children}
    </div>
  );
}

/** Props for {@link CardTitle}. */
export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children?: React.ReactNode;
}

/** Card heading — renders an `<h3 className="card-title">`, matching every usage site in app.jsx. */
export function CardTitle({ className, children, ...rest }: CardTitleProps) {
  return (
    <h3 className={"card-title" + (className ? " " + className : "")} {...rest}>
      {children}
    </h3>
  );
}

/** Props for {@link CardSubtitle}. */
export interface CardSubtitleProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children?: React.ReactNode;
}

/** Card subheading — renders a `<p className="card-subtitle">` directly below {@link CardTitle}. */
export function CardSubtitle({ className, children, ...rest }: CardSubtitleProps) {
  return (
    <p className={"card-subtitle" + (className ? " " + className : "")} {...rest}>
      {children}
    </p>
  );
}
