// Staff Handbook part 4: the batched "drafts to approve" email
// (kind handbook_approval_needed, queued by hb_queue_approval_notice() in
// supabase/staff-handbook-4-approvals.sql). Pure helpers, so they can be
// tested in Node (tests/edge/hb_approval_email.test.mjs).
//
// Batching rule (the SQL side queues; this side holds and checks):
//   * at most one unsent row per approver (the SQL won't add a second);
//   * the row carries payload.not_before = 30 minutes after the last notice
//     that was sent to them (or now). The sender leaves the row unprocessed
//     until then, so the approver gets at most one email per 30 minutes;
//   * at send time the email reads the live count of drafts waiting, so one
//     email covers every draft created or edited since the row was queued.
//     Nothing waiting (all approved meanwhile) means no email.
// The email never names a policy or quotes its text: a count and a link.

export const APPROVAL_KIND = "handbook_approval_needed";
export const APPROVAL_HASH = "#/team/handbook?item=handbook:approvals";

/** The time (ms) a queued row may go out, or null when it isn't held. */
export function notBefore(row: { payload?: Record<string, unknown> | null } | null | undefined): number | null {
  const raw = row?.payload?.not_before;
  if (raw == null || raw === "") return null;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

/** True while an approval notice is still inside its batching window. */
export function isHeld(row: { kind?: string; payload?: Record<string, unknown> | null }, now: number): boolean {
  if (row?.kind !== APPROVAL_KIND) return false;
  const t = notBefore(row);
  return t != null && t > now;
}

export type ApprovalCheck = {
  to: string;                      // recipient on the row (lower case)
  approverSetting: string | null;  // handbook_settings.policy_approver_email
  isActiveAdmin: boolean;          // the recipient is an active admin
  pending: number | null;          // live count of drafts waiting (null: unknown)
};

/** Why the notice should be skipped, or null to send it. */
export function approvalSkipReason(c: ApprovalCheck): string | null {
  const to = String(c.to || "").trim().toLowerCase();
  const set = String(c.approverSetting || "").trim().toLowerCase();
  if (!set || to !== set) return "No longer the policy approver";
  if (!c.isActiveAdmin) return "The policy approver is not an active admin";
  if (c.pending == null) return "Could not count the drafts waiting";
  if (c.pending <= 0) return "No handbook drafts are waiting for approval";
  return null;
}

/** The email body for n drafts waiting. Count and link only. */
export function approvalEmail(n: number, appUrl: string) {
  const count = Math.max(1, Math.floor(Number(n) || 0));
  const what = count === 1 ? "1 handbook policy needs" : `${count} handbook policies need`;
  const them = count === 1 ? "it" : "them";
  return {
    subject: `${what} your approval`,
    preheader: `Drafts in Team › Handbook are waiting for you to approve ${them}.`,
    lines: [
      `${what} your approval before ${count === 1 ? "it" : "they"} can be published.`,
      `Open the drafts in the portal under Team › Handbook to read ${them}, then approve or ask for changes.`,
    ],
    textLines: [
      `${what} your approval before ${count === 1 ? "it" : "they"} can be published.`,
      `Open the drafts in the portal under Team › Handbook to read ${them}, then approve or ask for changes.`,
    ],
    cta: "Open the drafts",
    href: `${appUrl}${APPROVAL_HASH}`,
  };
}
