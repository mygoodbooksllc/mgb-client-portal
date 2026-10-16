// Pure: who gets which email for one staff send/resend (tk-client-requests).
// No Deno or network APIs; tests/edge/tk_client_requests.test.mjs runs it
// under node.
//
// The plan comes from rpc tk_client_request_send (the database decides the
// mode). This only turns it into envelopes:
//   dry_run / preview / off  -> nothing (the RPC already logged the dry run)
//   test   -> ONE [Test] copy to the caller. If the request has a contact,
//             the copy carries a real test link (token minted for the
//             caller's own email, is_test) so the whole /respond flow can be
//             tried on a test client; else a portal link.
//   live   -> one email per target: contacts get their own link token,
//             portal users the sign-in deep link.

export type Target = { type: "portal" | "contact"; email: string; name?: string | null; contact_id?: string | null };
export type Plan = {
  mode: string;
  needs_sender?: boolean;
  targets?: Target[];
  client_id: string;
};
export type Envelope = {
  to: string;
  name: string | null;
  via: "link" | "portal";
  contactId: string | null; // token minted for this contact (null: portal)
  test: boolean;
};

export function envelopes(plan: Plan, callerEmail: string): Envelope[] {
  if (!plan || !plan.needs_sender) return [];
  const targets = (plan.targets || []).filter((t) => t && t.email);
  if (plan.mode === "test") {
    const contact = targets.find((t) => t.type === "contact" && t.contact_id);
    return [{
      to: callerEmail,
      name: null,
      via: contact ? "link" : "portal",
      contactId: contact ? String(contact.contact_id) : null,
      test: true,
    }];
  }
  if (plan.mode !== "live") return [];
  const seen = new Set<string>();
  const out: Envelope[] = [];
  for (const t of targets) {
    const key = `${t.type}:${t.contact_id || ""}:${t.email.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      to: t.email.toLowerCase(),
      name: t.name || null,
      via: t.type === "contact" ? "link" : "portal",
      contactId: t.type === "contact" ? String(t.contact_id || "") || null : null,
      test: false,
    });
  }
  return out.filter((e) => e.via === "portal" || e.contactId);
}

/** Maps an RPC error message to a short code for the staff UI. */
export function rpcErrorCode(message: string | null | undefined): string {
  const m = String(message || "");
  for (const c of ["tk_email_off", "tk_not_open", "tk_bad_recipient", "tk_too_soon", "tk_mode_changed", "tk_forbidden", "tk_not_found", "tk_bad_request"]) {
    if (m.includes(c)) return c.replace(/^tk_/, "");
  }
  return "error";
}
