// Shared email sender (Resend). Used by weekly-admin-digest; meant to be
// reused by later client-facing emails.
//
// Secrets (set by the owner in Supabase > Edge Functions > Secrets; this code
// never logs or returns them):
//   RESEND_API_KEY   required. Missing -> { ok: false, notConfigured: true }.
//   DIGEST_FROM      optional default sender, e.g.
//                    "MyGoodBooks <reports@mygoodbooks.org>". The domain must
//                    be verified in Resend.
//
// Deploying: the Supabase MCP / CLI bundles relative imports, so a function
// that imports "../_shared/email.ts" must upload this file alongside its
// index.ts.

export const DEFAULT_FROM = "MyGoodBooks <reports@mygoodbooks.org>";

export type SendEmailInput = {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; notConfigured?: boolean; status?: number; error: string };

export function emailConfigured(): boolean {
  return !!Deno.env.get("RESEND_API_KEY");
}

export function defaultFrom(): string {
  return Deno.env.get("DIGEST_FROM") || DEFAULT_FROM;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, notConfigured: true, error: "email not configured (RESEND_API_KEY is not set)" };
  const to = (input.to || []).map((s) => s.trim()).filter(Boolean);
  if (!to.length) return { ok: false, error: "no recipients" };

  const body: Record<string, unknown> = {
    from: input.from || defaultFrom(),
    to,
    subject: input.subject,
    html: input.html,
  };
  if (input.text) body.text = input.text;
  if (input.replyTo) body.reply_to = input.replyTo;
  if (input.tags?.length) body.tags = input.tags;

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `email provider unreachable: ${(e as Error).message}` };
  }
  let payload: any = null;
  try {
    payload = await res.json();
  } catch (_e) {
    payload = null;
  }
  if (!res.ok) {
    // Resend error bodies are {name, message, statusCode}; no secrets in them.
    const msg = payload?.message || payload?.name || `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: `email provider rejected the send: ${String(msg).slice(0, 300)}` };
  }
  return { ok: true, id: payload?.id ?? null };
}

// Minimal HTML escaping for template values.
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
