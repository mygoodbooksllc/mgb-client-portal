// Who the scheduled qbo-sync run syncs once QuickBooks webhooks are on
// (supabase/qbo-webhooks.sql, function qbo-webhook). Pure; tested in
// tests/edge/qbo_webhook.test.mjs.
//
// webhooks_enabled = false (the default): nothing changes, the plan schedule
// alone decides (isDueForPlan in index.ts).
//
// webhooks_enabled = true:
//   Pro (premium): due when QuickBooks said the company changed
//     (webhook_dirty_at set) and the last sync is at least
//     WEBHOOK_MIN_GAP_MS old (so a bookkeeper entering 40 transactions causes
//     a few syncs, not 40). Otherwise only the safety-net poll:
//     webhook_fallback_min (default 6 hours) since the last sync.
//   Plus and Basic keep their weekly / monthly schedule; a webhook does not
//     make them sync sooner (cadence is part of the plan).
//   A connection that never synced is always due.
//   Usage guard "throttled": webhooks are ignored and the plan schedule
//     applies, so the guard still slows things down.

export const WEBHOOK_MIN_GAP_MS = 5 * 60 * 1000;
export const DEFAULT_FALLBACK_MIN = 360;

export type WebhookSettings = { enabled: boolean; fallbackMin: number };

export function webhookSettingsFrom(row: any): WebhookSettings {
  const enabled = row?.webhooks_enabled === true;
  const n = Number(row?.webhook_fallback_min);
  return { enabled, fallbackMin: Number.isFinite(n) && n >= 60 ? n : DEFAULT_FALLBACK_MIN };
}

/**
 * Returns null when webhooks don't apply (caller uses the plan schedule),
 * otherwise whether the connection is due and why.
 */
export function webhookDue(
  plan: string | null,
  conn: { last_synced_at?: string | null; webhook_dirty_at?: string | null },
  now: Date,
  settings: WebhookSettings,
  usageMode: string | null,
  premiumIntervalMin: number,
): { due: boolean; reason: "never" | "webhook" | "fallback" | "not_due" } | null {
  if (!settings.enabled || usageMode === "throttled") return null;
  if (plan === "basic" || plan === "standard") return null;
  if (!conn.last_synced_at) return { due: true, reason: "never" };
  const since = now.getTime() - new Date(conn.last_synced_at).getTime();
  if (conn.webhook_dirty_at && since >= WEBHOOK_MIN_GAP_MS) return { due: true, reason: "webhook" };
  const fallbackMs = Math.max(settings.fallbackMin, premiumIntervalMin) * 60 * 1000;
  // Same 3-minute slack as isDueForPlan for the 5-minute cron tick.
  if (since >= fallbackMs - 3 * 60 * 1000) return { due: true, reason: "fallback" };
  return { due: false, reason: "not_due" };
}
