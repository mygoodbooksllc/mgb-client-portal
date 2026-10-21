// Staff Handbook part 5: the "changes requested" email (kind
// handbook_changes_requested, queued by hb_request_changes() in
// supabase/staff-handbook-5-approver-tweaks.sql). Pure helpers, so they can be
// tested in Node (tests/edge/hb_changes_email.test.mjs).
//
// One email per request (no batching): the approver asked for changes to a
// draft, and the person who last edited it gets the note and a link. The
// recipient is always an admin, who can read the draft anyway, so the email
// names the draft and quotes the note (never the policy text).
// At send time: still an active admin, not the approver who asked
// (payload.by_email), and the draft is still a draft waiting on changes
// (otherwise skipped).

export const CHANGES_KIND = "handbook_changes_requested";

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type ChangesCheck = {
  to: string;                  // recipient on the row (lower case)
  byEmail: string | null;      // payload.by_email (the approver who asked)
  isActiveAdmin: boolean;      // the recipient is an active admin
  policy: { status?: string | null; active?: boolean | null; approval_status?: string | null } | null; // live row, null: gone
};

/** Why the email should be skipped, or null to send it. */
export function changesSkipReason(c: ChangesCheck): string | null {
  const to = String(c.to || "").trim().toLowerCase();
  const by = String(c.byEmail || "").trim().toLowerCase();
  if (!c.isActiveAdmin) return "Not an active admin";
  if (by && to === by) return "The approver edited it last";
  const p = c.policy;
  if (!p || p.active === false) return "The policy no longer exists";
  if (p.status !== "draft") return "The policy was already published";
  if (p.approval_status !== "changes_requested") return "The draft was edited or approved since";
  return null;
}

/** The email for one request. Title, the note and a link; never the policy text. */
export function changesEmail(payload: Record<string, unknown> | null | undefined, appUrl: string) {
  const pl = payload || {};
  const title = String(pl.policy_title || "A handbook draft").trim().slice(0, 200) || "A handbook draft";
  const by = String(pl.by || "The policy approver").trim().slice(0, 120) || "The policy approver";
  const note = String(pl.note || "").trim().slice(0, 2000);
  const slug = String(pl.policy_slug || "").trim();
  const href = slug ? `${appUrl}#/hr/handbook?item=handbook:${encodeURIComponent(slug)}` : `${appUrl}#/hr/handbook`;
  const noteHtml = escHtml(note).replace(/\r?\n/g, "<br>");
  return {
    subject: `Changes requested: ${title}`,
    preheader: note ? `${by}: ${note}`.slice(0, 140) : `${by} asked for changes to ${title}`.slice(0, 140),
    lines: [
      `${escHtml(by)} asked for changes to <b>${escHtml(title)}</b> before approving it. You edited it last.`,
      ...(note ? [`<i>${noteHtml}</i>`] : []),
      "Edit the draft in the portal under HR › Handbook. Then it goes back for approval.",
    ],
    textLines: [
      `${by} asked for changes to ${title} before approving it. You edited it last.`,
      ...(note ? ["", note, ""] : []),
      "Edit the draft in the portal under HR › Handbook. Then it goes back for approval.",
    ],
    cta: "Open the draft",
    href,
  };
}
