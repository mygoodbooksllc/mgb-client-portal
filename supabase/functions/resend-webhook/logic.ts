// Pure helpers for resend-webhook. No Deno APIs, so
// tests/edge/resend_webhook.test.mjs runs them under plain node.
//
// S6 review MAJOR 2: answer links carry their token in the URL (#t=...). If
// click tracking were ever turned on for the sending domain, Resend's
// "clicked" event would echo the full link back here. We never store a link:
// click.link / click.url are dropped, and any t= fragment or query value
// left anywhere in what we keep is redacted. Click tracking must stay OFF for
// the sending domain regardless (it also rewrites the link through Resend).

const TOKEN_PARAM = /([#?&;]t=)[^&#\s"'<>]+/gi;

/** Replaces the value of any t= fragment/query parameter. */
export function redactTokens(s: string): string {
  return s.replace(TOKEN_PARAM, "$1[redacted]");
}

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (typeof v === "string") return redactTokens(v).slice(0, 2000);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = scrub(x, depth + 1);
    return out;
  }
  return v;
}

/** The click block without the link: only when it happened and the client. */
export function safeClick(click: unknown): Record<string, unknown> | undefined {
  if (!click || typeof click !== "object" || Array.isArray(click)) return undefined;
  const c = click as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (c.timestamp != null) out.timestamp = String(c.timestamp).slice(0, 64);
  if (c.userAgent != null) out.userAgent = String(c.userAgent).slice(0, 300);
  return out;
}

/** What goes into email_events.payload. Never a clicked link or a token. */
export function safePayload(evt: any): Record<string, unknown> {
  const data = evt?.data || {};
  return scrub({
    type: evt?.type,
    from: data.from,
    tags: data.tags,
    click: safeClick(data.click),
    bounce: data.bounce,
  }) as Record<string, unknown>;
}

export function safeSubject(s: unknown): string | null {
  return s ? redactTokens(String(s)).slice(0, 300) : null;
}
