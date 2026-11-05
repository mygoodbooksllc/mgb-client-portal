// ----------------------------------------------------------------------------
// RB_api: the Review board's reads and its one write (docs/review-board-spec.md
// sections 3a, 4b and 5). Every call goes through window.mgbSupabase at call
// time and resolves to { data, error, forbidden } (never rejects), so callers
// can render nothing on a 42501 without a try/catch.
//
//   rbApi.board(period)            rpc rb_board (admin-only, definer)
//   rbApi.listDigests()            my deadline_digest rows (last 14 days, max 6)
//                                  plus the month_rhythm setting for the titles
//   rbApi.draftRecipients(taskId)  rpc rb_draft_recipients (staff with access
//                                  to the client; includes sent {by, by_name, at})
//   rbApi.markSent(taskId, n)      rpc rb_mark_email_sent -> { by, at }
//   rbApi.unmarkSent(taskId)       rpc rb_unmark_email_sent
//
// Callers only use these behind RB_on(). No rb_* RPC is on the View as
// read allow-list (MGB_VIEW_AS_READ_RPCS), so View as blocks them as well.
// Browser file (plain JS); loads after RB_gate.js and RB_logic.js.
// ----------------------------------------------------------------------------

var RB_DIGEST_DAYS = 14;
var RB_DIGEST_MAX = 6;

function RB__client() {
  return typeof window !== "undefined" ? window.mgbSupabase : null;
}

function RB__forbidden(err) {
  return !!(err && (err.code === "42501" || /rb_forbidden|permission denied/i.test(String(err.message || ""))));
}

// A query or rpc promise -> { data, error, forbidden }.
function RB__wrap(p) {
  return Promise.resolve(p).then(
    function (res) {
      var err = (res && res.error) || null;
      return { data: err ? null : res ? res.data : null, error: err, forbidden: RB__forbidden(err) };
    },
    function (err) {
      return { data: null, error: err || { message: "failed" }, forbidden: RB__forbidden(err) };
    },
  );
}

function RB__none() {
  return Promise.resolve({ data: null, error: { message: "Supabase isn't configured." }, forbidden: false });
}

// The month_rhythm setting, read once per page load for the digest titles
// (the board gets it from rb_board). undefined until read; null = missing.
var RB__rhythm = { value: undefined, promise: null };
function RB__readRhythm(c) {
  if (RB__rhythm.value !== undefined) return Promise.resolve(RB__rhythm.value);
  if (RB__rhythm.promise) return RB__rhythm.promise;
  RB__rhythm.promise = RB__wrap(c.from("tk_settings").select("value").eq("key", "month_rhythm").maybeSingle()).then(function (r) {
    RB__rhythm.promise = null;
    if (r.error) return null;
    RB__rhythm.value = r.data ? r.data.value : null;
    return RB__rhythm.value;
  });
  return RB__rhythm.promise;
}

var rbApi = {
  // period: "YYYY-MM-01" or null (the server then picks last month).
  board: function (period) {
    var c = RB__client();
    if (!c) return RB__none();
    return RB__wrap(c.rpc("rb_board", { p_period: period || null }));
  },

  // { data: { rows, rhythm } }. RLS limits rows to my own (recipient = me).
  listDigests: function () {
    var c = RB__client();
    if (!c) return RB__none();
    var since = new Date(Date.now() - RB_DIGEST_DAYS * 24 * 3600 * 1000).toISOString();
    var rows = RB__wrap(
      c
        .from("tk_rhythm_notices")
        .select("id, period, part, counts, created_at, updated_at")
        .eq("kind", "deadline_digest")
        .gt("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(RB_DIGEST_MAX),
    );
    return rows.then(function (r) {
      if (r.error || !r.data || !r.data.length) return { data: { rows: r.data || [], rhythm: null }, error: r.error, forbidden: r.forbidden };
      return RB__readRhythm(c).then(function (rhythm) {
        return { data: { rows: r.data, rhythm: rhythm }, error: null, forbidden: false };
      });
    });
  },

  draftRecipients: function (taskId) {
    var c = RB__client();
    if (!c || !taskId) return RB__none();
    return RB__wrap(c.rpc("rb_draft_recipients", { p_task_id: taskId }));
  },

  markSent: function (taskId, toCount) {
    var c = RB__client();
    if (!c || !taskId) return RB__none();
    var n = Math.max(0, Math.min(50, Number(toCount) || 0));
    return RB__wrap(c.rpc("rb_mark_email_sent", { p_task_id: taskId, p_to_count: n }));
  },

  unmarkSent: function (taskId) {
    var c = RB__client();
    if (!c || !taskId) return RB__none();
    return RB__wrap(c.rpc("rb_unmark_email_sent", { p_task_id: taskId }));
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { rbApi: rbApi, RB_DIGEST_DAYS: RB_DIGEST_DAYS, RB_DIGEST_MAX: RB_DIGEST_MAX, RB__forbidden: RB__forbidden };
}
