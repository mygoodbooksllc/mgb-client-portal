// ----------------------------------------------------------------------------
// LR_api: Supabase calls for Ledger review (docs/gl-review-spec.md).
//
// Reads go straight to the gl_review_* tables (staff SELECT through RLS).
// Every write is an RPC (no direct table writes from the browser), and the
// two edge functions are:
//   qbo-gl-review   { action:'pull', client_id, window?, force? }
//                   window is 'rolling14' | 'ytd' | { start, end } (YYYY-MM-DD)
//   gl-review-send  { kind:'question'|'summary', id }
//
// Errors come back as Error objects with a plain-language message (the RPCs
// raise readable text) and `code` (Postgres errcode, e.g. '23505').
//
// GL lines are never written anywhere by this file. Only window.mgbSupabase
// is touched, and only at call time.
// ----------------------------------------------------------------------------

const LR_FLAG_COLS =
  "id, client_id, period, txn_key, flag_type, severity, why, txn_date, amount, name, memo, account_name, " +
  "account_qbo_id, other_side, class_name, location_name, status, cleared_reason, note, stop_flagging, reviewer, " +
  "cleared_by, cleared_at, question_id, sent_back_note, first_period, first_seen_at, last_seen_at, last_pull_at, " +
  "fixed_at, checks_version";
const LR_RULE_COLS =
  "id, client_id, kind, status, flag_type, match_name, account_qbo_id, account_name, account_type_override, params, source, note, created_by, created_at";
const LR_PULL_COLS = "client_id, pull_id, status, window_kind, window_start, window_end, started_at, finished_at, calls, line_count, error, pulled_by";
const LR_SIGNOFF_COLS =
  "client_id, period, status, reviewed_by, reviewed_at, high_open_at_review, approved_by, approved_at, sent_back_by, sent_back_at, sent_back_note, override_by, override_note, override_at";
const LR_SUMMARY_COLS = "id, client_id, period, variant, body, findings, status, sent_via, sent_to, sent_by, sent_at, updated_at";
const LR_QUESTION_COLS = "id, flag_id, note, answer, status, asked_via, asked_of_email, created_by, created_at, answered_at";
const LR_GENERIC_ERR = "Something went wrong. Try again in a minute.";
// Fired after a sign-off or flag change so other views (the Close card) can
// reload their counts. detail: { clientId, period }.
const LR_CHANGED_EVENT = "mgb:ledger-review-changed";

function LR_sb() {
  const sb = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!sb) throw new Error("Can't reach the database right now. Refresh and try again.");
  return sb;
}

function LR_toError(e) {
  if (e instanceof Error && !e.details) return e;
  const msg = String((e && e.message) || LR_GENERIC_ERR);
  const err = new Error(/permission denied|not allowed|jwt/i.test(msg) ? "You don't have access to do that for this client." : msg);
  err.code = e && e.code;
  return err;
}

// A select that never throws: { data, error }.
async function LR_soft(p) {
  try {
    const r = await p;
    return { data: r && r.data != null ? r.data : null, error: (r && r.error) || null };
  } catch (e) {
    return { data: null, error: e };
  }
}

async function LR_rpc(name, args) {
  const { data, error } = await LR_sb().rpc(name, args || {});
  if (error) throw LR_toError(error);
  return data;
}

// Edge function call. Returns the JSON body even on a non-2xx answer (the
// functions put {status:'error', error} in the body).
async function LR_invoke(fn, body) {
  const sb = LR_sb();
  if (!sb.functions) throw new Error(LR_GENERIC_ERR);
  const { data, error } = await sb.functions.invoke(fn, { body });
  if (!error) return data || {};
  let parsed = null;
  if (error.context && typeof error.context.json === "function") {
    try {
      parsed = await error.context.clone().json();
    } catch (e) {}
  }
  const status = error.context && error.context.status;
  if (parsed && (parsed.error || parsed.status)) return Object.assign({ http_status: status }, parsed);
  if (status === 401 || status === 403) return { status: "error", error: "You don't have access to this client's ledger.", http_status: status };
  return { status: "error", error: LR_GENERIC_ERR, http_status: status };
}

const LR_api = {
  // ---- Reads ----------------------------------------------------------------
  // Everything the tab needs besides flags and the month rows. Each part is
  // soft: a missing table or a failed read leaves that part null.
  async loadContext(clientId) {
    const sb = LR_sb();
    const [conn, settings, watch, rules, pull, users, profile] = await Promise.all([
      LR_soft(sb.from("qbo_connections").select("client_id, status").eq("client_id", clientId).maybeSingle()),
      LR_soft(sb.from("gl_review_settings").select("done_gate, pull_window, effective_from, updated_by, updated_at").maybeSingle()),
      LR_soft(sb.from("gl_review_watch_vendors").select("id, pattern, category, note, active").order("pattern")),
      LR_soft(sb.from("gl_review_rules").select(LR_RULE_COLS).eq("client_id", clientId).order("created_at")),
      LR_soft(sb.from("gl_review_pulls").select(LR_PULL_COLS).eq("client_id", clientId).maybeSingle()),
      LR_api.loadPortalAddressees(clientId),
      LR_soft(sb.from("client_profile").select("greeting_name, contact_email").eq("client_id", clientId).maybeSingle()),
    ]);
    return {
      connected: !!(conn.data && conn.data.status === "connected"),
      connStatus: (conn.data && conn.data.status) || null,
      settings: settings.data || { done_gate: "warn", pull_window: "rolling14" },
      watchVendors: watch.error ? null : (watch.data || []).filter((w) => w.active !== false),
      rules: rules.data || [],
      rulesError: rules.error ? LR_toError(rules.error).message : null,
      pull: pull.data || null,
      portalUsers: users.list,
      portalUsersMissing: users.missing,
      profile: profile.data || {},
      schemaMissing: !!(rules.error && /relation .* does not exist|could not find/i.test(String(rules.error.message || ""))),
    };
  },

  // Portal users staff may address (Ask client, summary send). The RPC
  // gl_review_portal_addressees leaves out scoped users, so nobody who can't
  // see the whole ledger is ever offered. If the RPC isn't there yet (SQL not
  // applied) or fails, the list is empty and only email is offered:
  // { list: [{ email, name }], missing: bool }.
  async loadPortalAddressees(clientId) {
    const r = await LR_soft(LR_sb().rpc("gl_review_portal_addressees", { p_client_id: clientId }));
    if (r.error) return { list: [], missing: true };
    const seen = new Set();
    const list = (Array.isArray(r.data) ? r.data : [])
      .filter((u) => u && u.email)
      .map((u) => ({ email: String(u.email), name: u.name || "" }))
      .filter((u) => {
        const k = u.email.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.email.localeCompare(b.email));
    return { list, missing: false };
  },

  async loadRules(clientId) {
    const { data, error } = await LR_sb().from("gl_review_rules").select(LR_RULE_COLS).eq("client_id", clientId).order("created_at");
    if (error) throw LR_toError(error);
    return data || [];
  },

  async loadPullRow(clientId) {
    const r = await LR_soft(LR_sb().from("gl_review_pulls").select(LR_PULL_COLS).eq("client_id", clientId).maybeSingle());
    return r.data || null;
  },

  // Flags from `sincePeriod` ('YYYY-MM-01') on, plus anything still open or
  // asked from before it.
  async loadFlags(clientId, sincePeriod) {
    const sb = LR_sb();
    const [recent, older] = await Promise.all([
      sb.from("gl_review_flags").select(LR_FLAG_COLS).eq("client_id", clientId).gte("period", sincePeriod).order("txn_date", { ascending: false }).limit(5000),
      sb
        .from("gl_review_flags")
        .select(LR_FLAG_COLS)
        .eq("client_id", clientId)
        .lt("period", sincePeriod)
        .in("status", ["open", "asked"])
        .order("txn_date")
        .limit(1000),
    ]);
    if (recent.error) throw LR_toError(recent.error);
    // Newest first so the 5000 cap cuts the oldest; hand back oldest first.
    return (older.data || []).concat((recent.data || []).slice().reverse());
  },

  async loadQuestions(ids) {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return {};
    const r = await LR_soft(LR_sb().from("transaction_questions").select(LR_QUESTION_COLS).in("id", list.slice(0, 500)));
    const out = {};
    (r.data || []).forEach((q) => {
      out[q.id] = q;
    });
    return out;
  },

  async loadMonth(clientId, period) {
    const sb = LR_sb();
    const [signoff, summary] = await Promise.all([
      LR_soft(sb.from("gl_review_signoffs").select(LR_SIGNOFF_COLS).eq("client_id", clientId).eq("period", period).maybeSingle()),
      LR_soft(sb.from("gl_review_summaries").select(LR_SUMMARY_COLS).eq("client_id", clientId).eq("period", period).maybeSingle()),
    ]);
    return { signoff: signoff.data || null, summary: summary.data || null, error: signoff.error || summary.error || null };
  },

  async loadSettings() {
    const sb = LR_sb();
    const [settings, watch] = await Promise.all([
      LR_soft(sb.from("gl_review_settings").select("done_gate, pull_window, effective_from, updated_by, updated_at").maybeSingle()),
      LR_soft(sb.from("gl_review_watch_vendors").select("id, pattern, category, note, active, updated_by, updated_at").order("pattern")),
    ]);
    if (settings.error && watch.error) throw LR_toError(settings.error);
    return { settings: settings.data || null, watch: watch.data || [] };
  },

  // Firm-wide watch list for Review a file (active entries); null on error so
  // the checks fall back to the built-in starter list.
  async loadWatchVendors() {
    const r = await LR_soft(LR_sb().from("gl_review_watch_vendors").select("pattern, category, active").eq("active", true));
    return r.error ? null : r.data || [];
  },

  // ---- Pull -----------------------------------------------------------------
  pull(clientId, windowKind, force) {
    const body = { action: "pull", client_id: clientId, force: !!force };
    if (windowKind) body.window = windowKind; // a name, or { start, end } for a custom range
    return LR_invoke("qbo-gl-review", body);
  },

  // The pull_id gl_review_mark_fixed needs: from the response when the
  // function returns it, else from gl_review_pulls when that row is this pull.
  async pullIdFor(clientId, res) {
    // qbo-gl-review returns pull_id and window as { kind, start, end }.
    if (res && res.pull_id) {
      const w = res.window;
      const kind = res.window_kind || (typeof w === "string" ? w : w && w.kind) || null;
      return { pull_id: res.pull_id, window_kind: kind };
    }
    const row = await LR_api.loadPullRow(clientId);
    if (!row || row.status !== "ok" || !res || !res.pulled_at) return null;
    if (Math.abs(new Date(row.started_at).getTime() - new Date(res.pulled_at).getTime()) > 1000) return null;
    return { pull_id: row.pull_id, window_kind: row.window_kind };
  },

  // ---- Flag writes ----------------------------------------------------------
  // Upsert in chunks of 2,000 (the RPC's limit), all tagged with the pull
  // (gl_review_pulls.pull_id returned by qbo-gl-review).
  async upsertFlags(clientId, pullId, checksVersion, rows) {
    const total = { inserted: 0, updated: 0, reopened: 0 };
    for (const part of LR_logic.chunk(rows || [], 2000)) {
      const r = await LR_rpc("gl_review_upsert_flags", {
        p_client_id: clientId,
        p_pull_id: pullId,
        p_checks_version: checksVersion,
        p_flags: part,
      });
      total.inserted += (r && r.inserted) || 0;
      total.updated += (r && r.updated) || 0;
      total.reopened += (r && r.reopened) || 0;
    }
    return total;
  },
  markFixed(clientId, pullId, checksVersion) {
    return LR_rpc("gl_review_mark_fixed", { p_client_id: clientId, p_pull_id: pullId, p_checks_version: checksVersion });
  },
  clear(flagId, reason, note, stopFlagging) {
    return LR_rpc("gl_review_clear", { p_flag_id: flagId, p_reason: reason, p_note: note || null, p_stop_flagging: !!stopFlagging });
  },
  sendBackFlag(flagId, note) {
    return LR_rpc("gl_review_send_back_flag", { p_flag_id: flagId, p_note: note });
  },
  ask(flagId, via, toEmail, question) {
    return LR_rpc("gl_review_ask", { p_flag_id: flagId, p_asked_via: via, p_asked_of_email: toEmail, p_question: question });
  },
  answer(flagId, text) {
    return LR_rpc("gl_review_answer", { p_flag_id: flagId, p_answer: text });
  },

  // ---- Rules ----------------------------------------------------------------
  saveRule(clientId, r) {
    return LR_rpc("gl_review_save_rule", {
      p_client_id: clientId,
      p_kind: r.kind,
      p_flag_type: r.flag_type || null,
      p_match_name: r.match_name || null,
      p_account_qbo_id: r.account_qbo_id != null && r.account_qbo_id !== "" ? String(r.account_qbo_id) : null,
      p_account_name: r.account_name || null,
      p_account_type_override: r.account_type_override || null,
      p_params: r.params || {},
      p_status: r.status || "active",
      p_source: r.source || "manual",
      p_note: r.note || null,
    });
  },
  setRuleStatus(ruleId, status) {
    return LR_rpc("gl_review_set_rule_status", { p_rule_id: ruleId, p_status: status });
  },

  // ---- Summary --------------------------------------------------------------
  saveSummary(clientId, period, variant, body, findings) {
    return LR_rpc("gl_review_save_summary", {
      p_client_id: clientId,
      p_period: period,
      p_variant: variant,
      p_body: body,
      p_findings: findings || {},
    });
  },
  sendSummaryPortal(summaryId, toEmails) {
    return LR_rpc("gl_review_send_summary_portal", { p_summary_id: summaryId, p_to: toEmails });
  },
  // kind 'question' (id = transaction_questions.id) or 'summary'.
  // Resolves { status: 'sent' | 'test_sent' | 'already_sent', to }; throws
  // when nothing went out (error, skipped, not_configured).
  async sendEmail(kind, id) {
    const res = await LR_invoke("gl-review-send", { kind, id });
    const s = res && res.status;
    if (s === "sent" || s === "test_sent" || s === "already_sent") return res;
    if (s === "skipped") throw new Error("It wasn't emailed" + (res.reason ? ": " + res.reason : "."));
    if (s === "not_configured") throw new Error("Email isn't set up yet, so nothing was sent.");
    throw new Error((res && res.error) || "The email didn't send.");
  },

  // ---- Sign-off -------------------------------------------------------------
  markReviewed(clientId, period) {
    return LR_rpc("gl_review_mark_reviewed", { p_client_id: clientId, p_period: period });
  },
  approve(clientId, period) {
    return LR_rpc("gl_review_approve", { p_client_id: clientId, p_period: period });
  },
  sendBack(clientId, period, note) {
    return LR_rpc("gl_review_send_back", { p_client_id: clientId, p_period: period, p_note: note });
  },

  // ---- Admin settings -------------------------------------------------------
  saveWatchVendor(id, pattern, category, note, active) {
    return LR_rpc("gl_review_save_watch_vendor", {
      p_id: id || null,
      p_pattern: pattern,
      p_category: category || "other",
      p_note: note || null,
      p_active: active !== false,
    });
  },
  saveSettings(doneGate, pullWindow, effectiveFrom) {
    return LR_rpc("gl_review_save_settings", {
      p_done_gate: doneGate || null,
      p_pull_window: pullWindow || null,
      p_effective_from: effectiveFrom || null,
    });
  },

  notifyChanged(clientId, period) {
    try {
      window.dispatchEvent(new CustomEvent(LR_CHANGED_EVENT, { detail: { clientId, period } }));
      // The Close card and Close steps listen for GL_REVIEW_EVENT (app.jsx).
      window.dispatchEvent(new Event("mgb:gl-review-changed"));
    } catch (e) {}
    // Top bar, Today and other staff tools refresh their counts.
    try {
      if (typeof notifyStaffTools === "function") notifyStaffTools();
    } catch (e) {}
  },
};
