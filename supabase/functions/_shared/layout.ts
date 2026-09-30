// Shared email layout: one header, card, button, type scale and footer for
// every MyGoodBooks email (client-facing and admin). Only the look lives here;
// each function keeps its own wording, plain-text body, unsubscribe handling
// and escaping (callers pass already-escaped HTML; plain strings passed as
// `text` arguments are escaped here with esc()).
//
// Values are the design system's tokens (client-dashboard/design-system/
// src/styles.css :root and its dark-mode block; brand guide in
// design-system/guides/brand-guide.md):
//   cream ground, white surface with a hairline border, 12px card radius,
//   999px pill button in navy chrome, Bitter headings (italic serif subtitle
//   is the house voice), IBM Plex Sans body and figures, muted ink >= 12.5px.
//
// Email-safe: table layout and inline styles. A small <style> block only adds
// progressive enhancements (web fonts, <600px padding, dark mode in clients
// that support prefers-color-scheme); everything reads correctly without it.
// No images (no PNG logo is publicly served), no SVG, no JS.
//
// Deploying: a function importing "../_shared/layout.ts" must upload this file
// (and ../_shared/email.ts, which it imports) alongside its index.ts.

import { esc } from "./email.ts";

// Light tokens (design-system :root).
export const T = {
  bg: "#faf9f6", // --bg (cream ground)
  surface: "#ffffff", // --surface
  border: "#e8e2d6", // --border
  surface2: "#f0ece3", // --surface-2
  text: "#26343d", // --text
  muted: "#6b655c", // --text-muted
  ink: "#05080d", // --ink-strong (headings)
  navy: "#05080d", // --navy (chrome: primary button)
  logoNavy: "#233746", // the logo's own navy (styles.css .auth-wordmark)
  gold: "#c7ae86", // --gold / --accent
  goldDeep: "#8a6d34", // --gold-deep / --warm-text (links, warnings)
  warmBg: "#fbf6ea", // --warm-bg
  warmBorder: "#e3d3ab", // --warm-border
  good: "#3f6b52", // --good
  bad: "#a4442c", // --bad
} as const;

// Dark tokens (design-system dark-mode block).
export const TD = {
  bg: "#0f1512",
  surface: "#161d1a",
  border: "#293530",
  surface2: "#1c2420",
  text: "#e9ece6",
  muted: "#9aa59c",
  ink: "#f2f5ef",
  gold: "#c7ae86",
  goldDeep: "#d8c39f",
  warmBg: "#1f2a22",
  warmBorder: "#3f4f42",
  warmText: "#d8c9a4",
  good: "#5fbf7a",
  bad: "#e2635f",
  onGold: "#0b100e",
} as const;

// Font stacks: brand web font first, then a solid system fallback. Outlook
// desktop is pinned to the fallbacks by the mso block in the <head>.
export const FONT_BODY = "font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
export const FONT_HEAD = "font-family:Bitter,Georgia,'Times New Roman',serif;";
const NUM = "font-variant-numeric:tabular-nums;";

type Tone = "text" | "muted" | "ink" | "warn" | "bad" | "good";
const TONE_COLOR: Record<Tone, string> = {
  text: T.text,
  muted: T.muted,
  ink: T.ink,
  warn: T.goldDeep,
  bad: T.bad,
  good: T.good,
};

/** Wrap already-escaped HTML in a coloured span (dark mode follows). */
export function tone(html: string, t: Tone): string {
  return `<span class="mgb-${t}" style="color:${TONE_COLOR[t]};">${html}</span>`;
}

/** Body paragraph. `html` must already be escaped. */
export function p(html: string, opts: { tone?: Tone; size?: number; margin?: string } = {}): string {
  const t = opts.tone || "text";
  const size = opts.size ?? 15;
  return `<p class="mgb-${t}" style="${FONT_BODY}font-size:${size}px;line-height:1.6;color:${TONE_COLOR[t]};margin:${opts.margin ?? "0 0 16px 0"};">${html}</p>`;
}

/** Serif section heading (plain text; escaped here). */
export function heading(text: string, opts: { size?: number; margin?: string } = {}): string {
  return `<h2 class="mgb-ink" style="${FONT_HEAD}font-size:${opts.size ?? 18}px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:${T.ink};margin:${opts.margin ?? "0 0 10px 0"};">${esc(text)}</h2>`;
}

/** Small uppercase label above a list or table (plain text; escaped here). */
export function label(text: string, margin = "4px 0 8px 0"): string {
  return `<p class="mgb-muted" style="${FONT_BODY}font-size:12.5px;line-height:1.4;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${T.muted};margin:${margin};">${esc(text)}</p>`;
}

/** Inline text link. `labelHtml` must already be escaped. */
export function link(href: string, labelHtml: string, t: "gold" | "muted" = "gold"): string {
  const color = t === "gold" ? T.goldDeep : T.muted;
  return `<a class="mgb-link-${t}" href="${esc(href)}" style="color:${color};text-decoration:underline;">${labelHtml}</a>`;
}

/**
 * Primary pill button (navy chrome, white ink; gold with dark ink in dark
 * mode). Bulletproof: VML round-rect for Outlook desktop, padded <a> elsewhere.
 * `href` is a trusted constant; `text` is escaped here.
 */
export function button(text: string, href: string, margin = "8px 0 24px 0"): string {
  const w = Math.max(160, Math.round(text.length * 8.4 + 56));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${margin};"><tr><td class="mgb-btn" align="center" bgcolor="${T.navy}" style="background:${T.navy};border-radius:999px;mso-padding-alt:0;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:44px;v-text-anchor:middle;width:${w}px;" arcsize="50%" stroke="f" fillcolor="${T.navy}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${esc(text)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a class="mgb-btn-a" href="${href}" style="${FONT_BODY}display:inline-block;padding:12px 26px;font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(text)}</a><!--<![endif]-->
</td></tr></table>`;
}

/** Row list with hairline separators (e.g. the documents we need). */
export function ruledList(itemsHtml: string[]): string {
  const rows = itemsHtml
    .map((h, i) =>
      `<tr><td class="mgb-text mgb-line" style="${FONT_BODY}font-size:15px;line-height:1.5;color:${T.text};padding:12px 0;border-top:${i === 0 ? `1px solid ${T.border}` : "0"};border-bottom:1px solid ${T.border};">${h}</td></tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;border-collapse:collapse;">${rows}</table>`;
}

/** Bulleted list. Items must already be escaped. */
export function bullets(itemsHtml: string[], size = 14.5): string {
  return `<ul class="mgb-text" style="${FONT_BODY}font-size:${size}px;line-height:1.6;color:${T.text};margin:0 0 18px 0;padding-left:20px;">${itemsHtml.map((h) => `<li style="margin:0 0 4px 0;">${h}</li>`).join("")}</ul>`;
}

/** Row of KPI tiles (warm soft ground, sans figures). Values/labels escaped here. */
export function statTiles(stats: { value: string; label: string }[]): string {
  const pct = Math.floor(100 / stats.length);
  const cells = stats
    .map((s, i) =>
      `<td class="mgb-stack" width="${pct}%" valign="top" style="padding:0 ${i === stats.length - 1 ? 0 : 4}px 0 ${i === 0 ? 0 : 4}px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="mgb-warm" align="left" style="background:${T.warmBg};border:1px solid ${T.warmBorder};border-radius:12px;padding:14px 16px;">
    <div class="mgb-ink" style="${FONT_BODY}${NUM}font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-0.01em;color:${T.ink};">${esc(s.value)}</div>
    <div class="mgb-muted" style="${FONT_BODY}font-size:12.5px;line-height:1.35;color:${T.muted};margin-top:4px;">${esc(s.label)}</div>
  </td></tr></table>
</td>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px 0;"><tr>${cells}</tr></table>`;
}

/** Data table (digest). Header cells are plain text; body cells are HTML. */
export function dataTable(head: string[], rows: string[][], alignRight: number[] = []): string {
  const al = (i: number) => (alignRight.includes(i) ? "right" : "left");
  const th = head
    .map((h, i) =>
      `<th class="mgb-muted mgb-line" align="${al(i)}" style="${FONT_BODY}font-size:12px;line-height:1.3;font-weight:600;color:${T.muted};text-transform:uppercase;letter-spacing:.05em;padding:0 8px 8px ${i === 0 ? 0 : 8}px;border-bottom:1px solid ${T.border};">${esc(h)}</th>`
    )
    .join("");
  const tr = rows
    .map((r) =>
      `<tr>${r
        .map((cell, i) =>
          `<td class="mgb-text mgb-line" align="${al(i)}" style="${FONT_BODY}${NUM}font-size:13.5px;line-height:1.45;color:${T.text};padding:9px 8px 9px ${i === 0 ? 0 : 8}px;border-bottom:1px solid ${T.border};vertical-align:top;">${cell}</td>`
        )
        .join("")}</tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 6px 0;"><tr>${th}</tr>${tr}</table>`;
}

/** A card: opaque surface, hairline border, 12px radius. `variant: "warm"` for a callout. */
export function card(inner: string, opts: { variant?: "plain" | "warm"; padding?: string; gap?: number } = {}): string {
  const warm = opts.variant === "warm";
  const bg = warm ? T.warmBg : T.surface;
  const bd = warm ? T.warmBorder : T.border;
  return `<tr><td style="padding:0 0 ${opts.gap ?? 16}px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td class="${warm ? "mgb-warm" : "mgb-card"} mgb-pad" bgcolor="${bg}" style="background:${bg};border:1px solid ${bd};border-radius:12px;padding:${opts.padding ?? "32px 32px 16px 32px"};">
${inner}
</td></tr></table>
</td></tr>`;
}

const HEAD_STYLE = `
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table{border-collapse:collapse;}
a{text-decoration:underline;}
@media only screen and (max-width:600px){
  .mgb-outer{padding:20px 12px 28px 12px !important;}
  .mgb-pad{padding:24px 20px 8px 20px !important;}
  .mgb-stack{display:block !important;width:100% !important;padding:0 0 8px 0 !important;}
  .mgb-h1{font-size:24px !important;}
}
@media (prefers-color-scheme:dark){
  .mgb-bg{background:${TD.bg} !important;}
  .mgb-card{background:${TD.surface} !important;border-color:${TD.border} !important;}
  .mgb-warm{background:${TD.warmBg} !important;border-color:${TD.warmBorder} !important;}
  .mgb-line{border-color:${TD.border} !important;}
  .mgb-rule{background:${TD.gold} !important;}
  .mgb-text{color:${TD.text} !important;}
  .mgb-muted{color:${TD.muted} !important;}
  .mgb-ink,.mgb-word{color:${TD.ink} !important;}
  .mgb-warn{color:${TD.warmText} !important;}
  .mgb-bad{color:${TD.bad} !important;}
  .mgb-good{color:${TD.good} !important;}
  .mgb-link-gold{color:${TD.goldDeep} !important;}
  .mgb-link-muted{color:${TD.muted} !important;}
  .mgb-btn{background:${TD.gold} !important;}
  .mgb-btn-a{color:${TD.onGold} !important;}
}`;

/**
 * Full email document.
 *   subtitle  : italic serif line under the wordmark (plain text; escaped here)
 *   intro     : optional HTML between header and cards (e.g. a page title)
 *   cards     : HTML from card() calls
 *   footer    : footer HTML (already escaped; may contain links)
 */
export function emailDocument(opts: {
  title: string;
  preheader: string;
  subtitle?: string;
  intro?: string;
  cards: string;
  footer: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,address=no,email=no,date=no"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(opts.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>body,table,td,p,a,li,h1,h2,div,span{font-family:'Segoe UI',Arial,sans-serif !important;}.mgb-serif{font-family:Georgia,serif !important;}</style><![endif]-->
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Bitter:ital,wght@0,600;0,700;1,400&family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet"><!--<![endif]-->
<style>${HEAD_STYLE}</style>
</head>
<body class="mgb-bg" style="margin:0;padding:0;background:${T.bg};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${T.bg};">${esc(opts.preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" class="mgb-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.bg}" style="background:${T.bg};"><tr><td class="mgb-outer" align="center" style="padding:32px 16px 40px 16px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
  <tr><td align="left" style="padding:0 4px 22px 4px;">
    <div class="mgb-word mgb-serif" style="${FONT_HEAD}font-size:24px;line-height:1.1;font-weight:700;letter-spacing:-0.01em;color:${T.logoNavy};">MyGoodBooks</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0 0;"><tr><td class="mgb-rule" width="36" height="2" bgcolor="${T.gold}" style="width:36px;height:2px;line-height:2px;font-size:2px;background:${T.gold};">&nbsp;</td></tr></table>
    ${opts.subtitle ? `<div class="mgb-muted mgb-serif" style="${FONT_HEAD}font-style:italic;font-size:14.5px;line-height:1.4;color:${T.muted};margin:10px 0 0 0;">${esc(opts.subtitle)}</div>` : ""}
  </td></tr>
  ${opts.intro || ""}
  ${opts.cards}
  <tr><td class="mgb-line" style="padding:8px 4px 0 4px;border-top:1px solid ${T.border};">
    <p class="mgb-muted" style="${FONT_BODY}font-size:12.5px;line-height:1.6;color:${T.muted};margin:12px 0 0 0;">${opts.footer}</p>
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

/** Page title for emails that have one (digest). Plain text; escaped here. */
export function pageTitle(text: string): string {
  return `<tr><td style="padding:0 4px 16px 4px;"><h1 class="mgb-ink mgb-h1 mgb-serif" style="${FONT_HEAD}font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:${T.ink};margin:0;">${esc(text)}</h1></td></tr>`;
}
