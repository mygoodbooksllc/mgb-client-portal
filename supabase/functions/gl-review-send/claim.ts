// ----------------------------------------------------------------------------
// gl-review-send: claim a row BEFORE emailing, so a double click or a second
// tab can't send the same question or summary twice. No Deno APIs here, so
// tests/edge/gl_review_send_claim.test.mjs can run it under node.
//
// Summary: an atomic conditional UPDATE of the draft's own sent_at/sent_by
// (both are free while status = 'draft'; the sent_shape check only applies
// once status = 'sent'). Only one request's UPDATE can match
// "draft and (sent_at is null or the old claim is stale)". The claim is rolled
// back (only if it's still ours) when the send fails or was a test copy;
// on success gl_review_record_summary_email overwrites both with the final
// values.
//
// Question: transaction_questions has no free column (its stamp trigger
// refuses arbitrary updates), so the claim is a client_email_log row with
// status 'sent' and the usual reason "question <id>", inserted BEFORE the
// send. Then: is there any OTHER 'sent' row for that reason in the guard
// window? If yes, ours steps aside (marked 'skipped') and, after a short wait,
// the caller learns whether the other request really sent ("already_sent") or
// also stepped aside (rare tie: "try again"). The row is finished afterwards
// with the provider id, or turned into error / not_configured.
// ----------------------------------------------------------------------------

export const CLAIM_STALE_MS = 10 * 60 * 1000;
export const TIE_WAIT_MS = 1500;

type Admin = any;

export type SummaryClaim = { claimed: true; claimIso: string } | { claimed: false; error?: string };

export async function claimSummary(admin: Admin, id: string, by: string, now = Date.now(), staleMs = CLAIM_STALE_MS): Promise<SummaryClaim> {
  const claimIso = new Date(now).toISOString();
  const stale = new Date(now - staleMs).toISOString();
  const { data, error } = await admin.from("gl_review_summaries")
    .update({ sent_at: claimIso, sent_by: by })
    .eq("id", id)
    .eq("status", "draft")
    .or(`sent_at.is.null,sent_at.lt."${stale}"`)
    .select("id");
  if (error) return { claimed: false, error: String(error.message || error) };
  return Array.isArray(data) && data.length > 0 ? { claimed: true, claimIso } : { claimed: false };
}

// Undo our claim, only if it is still ours and the summary is still a draft.
// Never throws; returns false when the release failed (the claim then simply
// expires after CLAIM_STALE_MS).
export async function releaseSummary(admin: Admin, id: string, claimIso: string, logTag = "gl-review-send"): Promise<boolean> {
  try {
    const { error } = await admin.from("gl_review_summaries")
      .update({ sent_at: null, sent_by: null })
      .eq("id", id)
      .eq("status", "draft")
      .eq("sent_at", claimIso);
    if (error) {
      console.log(`${logTag}: could not release the summary send claim — ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.log(`${logTag}: could not release the summary send claim — ${(e as Error)?.message || e}`);
    return false;
  }
}

export type QuestionClaim =
  | { claimed: true; logId: string }
  | { claimed: false; status: "already_sent" }
  | { claimed: false; status: "error"; error: string };

export type ClaimDeps = { now?: () => number; sleep?: (ms: number) => Promise<void>; guardMs?: number; tieWaitMs?: number };

async function otherSent(admin: Admin, feature: string, reason: string, mine: string, since: string): Promise<{ n: number; error?: string }> {
  const { data, error } = await admin.from("client_email_log")
    .select("id")
    .eq("feature", feature)
    .eq("reason", reason)
    .eq("status", "sent")
    .gte("created_at", since)
    .neq("id", mine)
    .limit(5);
  if (error) return { n: 0, error: String(error.message || error) };
  return { n: Array.isArray(data) ? data.length : 0 };
}

// `row` is the client_email_log row (feature, client_id, requested_by,
// trigger, recipients, period, subject...). Its reason is the guard key.
export async function claimQuestion(admin: Admin, row: Record<string, unknown> & { feature: string; reason: string }, deps: ClaimDeps = {}): Promise<QuestionClaim> {
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const guardMs = deps.guardMs ?? CLAIM_STALE_MS;
  const tieWaitMs = deps.tieWaitMs ?? TIE_WAIT_MS;
  const since = new Date(now() - guardMs).toISOString();

  const { data: mine, error: insErr } = await admin.from("client_email_log")
    .insert({ ...row, status: "sent" })
    .select("id")
    .single();
  // Fail closed: without a claim row there is no double-send guard.
  if (insErr || !mine?.id) return { claimed: false, status: "error", error: "Couldn't start the send. Try again in a minute." };
  const logId = String(mine.id);

  const first = await otherSent(admin, row.feature, row.reason, logId, since);
  if (first.error) {
    await finishQuestion(admin, logId, { status: "error", reason: `${row.reason}: send guard check failed` });
    return { claimed: false, status: "error", error: "Couldn't start the send. Try again in a minute." };
  }
  if (first.n === 0) return { claimed: true, logId };

  // Someone else holds (or already used) the claim. Step aside, then see
  // whether they really sent or stepped aside too.
  await finishQuestion(admin, logId, { status: "skipped", reason: `${row.reason}: duplicate send blocked` });
  await sleep(tieWaitMs);
  const again = await otherSent(admin, row.feature, row.reason, logId, since);
  if (!again.error && again.n > 0) return { claimed: false, status: "already_sent" };
  return { claimed: false, status: "error", error: "Another send of this question was starting at the same moment. Try again." };
}

// Update our claim row. Never throws.
export async function finishQuestion(admin: Admin, logId: string, patch: Record<string, unknown>, logTag = "gl-review-send"): Promise<boolean> {
  try {
    const { error } = await admin.from("client_email_log").update(patch).eq("id", logId);
    if (error) {
      console.log(`${logTag}: could not update the email log — ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.log(`${logTag}: could not update the email log — ${(e as Error)?.message || e}`);
    return false;
  }
}
