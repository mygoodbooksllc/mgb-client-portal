// Team Reviews & Team Survey (staff only, #/reviews). Owner request 2026-10-07.
//
// One "Reviews" page in the staff sidebar. Tabs:
//   everyone        My review (current cycle) · History
//   admins also     Team status · Reviews I'm giving · Survey results · Year-end
// An admin sees My review only when they are a reviewee this cycle.
//
// Routes (hash, kept by app.jsx buildHashRoute):
//   #/reviews                 default tab
//   #/reviews/<tab>           my | history | team | giving | results | year-end
//   #/reviews/survey          this quarter's team survey
//   #/reviews/r/<review id>   one review: the form you owe, or the comparison
//
// Everything is enforced in the database (supabase/team-reviews-*.sql): the
// blind rule, who can see or edit what, locks after signing, no deletes. The
// UI only mirrors those rules (teamReviewsLogic.js) for instant feedback.
// Files: TeamReviews.jsx (shell, overview, form, badge, Home notice),
// TeamReviewsCompare.jsx (comparison + signing), TeamReviewsSurvey.jsx,
// TeamReviewsAdmin.jsx (history, team status, results, year-end).

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------
const TR_FN = "team-reviews";
const TR_CHANGED_EVENT = "tr:changed";

function TR_errText(err) {
  const m = (err && (err.message || err.error_description || err.msg)) || String(err || "");
  return m.replace(/^ERROR:\s*/i, "") || "Something went wrong. Try again.";
}

// window.TR_DEMO_API lets the local preview harness (kept outside the app
// folder) feed sample data. It only changes what this browser shows; the
// database still decides everything.
const TR_api = {
  async rpc(fn, args) {
    const demo = window.TR_DEMO_API;
    if (demo && typeof demo.rpc === "function") return demo.rpc(fn, args || {});
    const sb = window.mgbSupabase;
    if (!sb) throw new Error("Sign in again.");
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw new Error(TR_errText(error));
    return data;
  },
  // The team-reviews edge function: PDFs and Drive export.
  async call(body, wantBlob) {
    const demo = window.TR_DEMO_API;
    if (demo && typeof demo.call === "function") return demo.call(body, wantBlob);
    const sb = window.mgbSupabase;
    const cfg = window.SUPABASE_CONFIG || {};
    if (!sb) throw new Error("Sign in again.");
    const { data } = await sb.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error("Sign in again.");
    const res = await fetch(`${cfg.url}/functions/v1/${TR_FN}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: cfg.anonKey || "", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const type = res.headers.get("content-type") || "";
    if (res.ok && wantBlob && type.indexOf("application/pdf") === 0) return res.blob();
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      json = null;
    }
    if (!res.ok) throw new Error((json && json.message) || `Reviews service error (HTTP ${res.status}).`);
    return json || {};
  },
};

async function TR_downloadPdf(body, filename) {
  const blob = await TR_api.call(body, true);
  if (!(blob instanceof Blob)) throw new Error("The PDF is not ready yet.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function TR_changed() {
  TR_store.at = 0;
  window.dispatchEvent(new CustomEvent(TR_CHANGED_EVENT));
}

function TR_useToastSafe() {
  return typeof useToast === "function" ? useToast() : (m) => window.alert(m);
}

function TR_first(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

// Possessive for a first name: "Jesse’s".
function TR_poss(name) {
  const f = TR_first(name) || "Reviewer";
  return f + (/s$/i.test(f) ? "’" : "’s");
}

// ---------------------------------------------------------------------------
// Shared overview (tr_my_overview): powers the page, the sidebar badge and
// the Home "Review due" card. One request serves all three.
// ---------------------------------------------------------------------------
const TR_store = { data: null, error: "", at: 0, pending: null, subs: new Set() };

function TR_loadOverview(force) {
  if (!force && TR_store.pending) return TR_store.pending;
  if (!force && TR_store.data && Date.now() - TR_store.at < 60000) return Promise.resolve(TR_store.data);
  TR_store.pending = TR_api
    .rpc("tr_my_overview")
    .then((d) => {
      TR_store.data = d;
      TR_store.error = "";
      return d;
    })
    .catch((e) => {
      TR_store.error = TR_errText(e);
      return null;
    })
    .finally(() => {
      TR_store.at = Date.now();
      TR_store.pending = null;
      TR_store.subs.forEach((f) => f());
    });
  return TR_store.pending;
}

function TR_useOverview() {
  const [, bump] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    TR_store.subs.add(bump);
    TR_loadOverview(false);
    const onChange = () => TR_loadOverview(true);
    const t = setInterval(() => TR_loadOverview(true), 5 * 60 * 1000);
    window.addEventListener(TR_CHANGED_EVENT, onChange);
    return () => {
      TR_store.subs.delete(bump);
      clearInterval(t);
      window.removeEventListener(TR_CHANGED_EVENT, onChange);
    };
  }, []);
  return { data: TR_store.data, error: TR_store.error, loading: !TR_store.data && !TR_store.error };
}

function TR_dueCount(ov) {
  return (ov && ov.due && ov.due.due_at && ov.due.count) || 0;
}

// Sidebar badge: how many review things you have due this cycle.
function TR_NavBadge({ expanded }) {
  const { data } = TR_useOverview();
  const n = TR_dueCount(data);
  if (!n) return null;
  const label = `${n} review item${n === 1 ? "" : "s"} due`;
  if (!expanded) return <span className="nav-badge-dot staff-rail-dot" aria-label={label} />;
  return (
    <span className="nav-due-counts" role="img" aria-label={label} title={label}>
      <span className="nav-due-count">{n}</span>
    </span>
  );
}

function TR_goReviews(path) {
  const next = "#/reviews" + (path ? "/" + path : "");
  if (window.location.hash !== next) window.location.hash = next;
}

// Home: a small "Review due {date}" card while you owe something. Hidden
// during "View as" (the Home being shown belongs to someone else).
function TR_HomeDueNotice({ staffUser }) {
  const { data } = TR_useOverview();
  const n = TR_dueCount(data);
  if (!n) return null;
  if (staffUser && staffUser.name && data.me && data.me.name && staffUser.name !== data.me.name) return null;
  const items = data.due.items || [];
  return (
    <div className="card home-card home-tone-week tr-home-due" style={{ marginBottom: 20 }}>
      <div className="tr-home-due-main">
        <h3 className="card-title">Review due {TR_fmtDate(data.due.due_at)}</h3>
        <p className="card-subtitle">
          {data.cycle ? data.cycle.label + ": " : ""}
          {items.map((i) => i.label).join(" · ")}
        </p>
      </div>
      <button type="button" className="btn-primary" onClick={() => TR_goReviews("")}>
        Open Reviews
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------
function TR_Pill({ tone, children }) {
  return <span className={"pill " + (tone || "neutral")}>{children}</span>;
}

const TR_STATUS_PILL = {
  not_started: ["Not started", "warm"],
  in_progress: ["In progress", "neutral"],
  submitted: ["Submitted", "good"],
  not_submitted: ["Not submitted", "neutral"],
};
function TR_StatusPill({ status }) {
  const p = TR_STATUS_PILL[status] || [status, "neutral"];
  return <TR_Pill tone={p[1]}>{p[0]}</TR_Pill>;
}

const TR_REVIEW_STATUS = {
  open: ["Open", "neutral"],
  comparing: ["Ready to compare", "warm"],
  signed: ["Signed", "good"],
  closed_unsigned: ["Closed unsigned", "bad"],
};
function TR_ReviewStatusPill({ status }) {
  const p = TR_REVIEW_STATUS[status] || [status, "neutral"];
  return <TR_Pill tone={p[1]}>{p[0]}</TR_Pill>;
}

function TR_Kpi({ label, value, sub, subTone }) {
  return (
    <div className="card kpi-card">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub ? <span className={"kpi-sub " + (subTone || "neutral")}>{sub}</span> : null}
    </div>
  );
}

function TR_Error({ text }) {
  if (!text) return null;
  return (
    <p className="al-error" role="alert">
      {text}
    </p>
  );
}

// 1-5 rating with the owner's labels on every control.
function TR_Rating({ value, onChange, readOnly, label, name }) {
  return (
    <div className="tr-rating" role="radiogroup" aria-label={label}>
      {TR_SCALE.map((s) => {
        const on = value === s.value;
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${s.value} of 5, ${s.label}`}
            className={"tr-rate" + (on ? " on" : "")}
            disabled={readOnly}
            onClick={() => !readOnly && onChange(s.value)}
            name={name}
          >
            <span className="tr-rate-n">{s.value}</span>
            <span className="tr-rate-l">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Modal confirm built on the app's ModalShell.
function TR_Confirm({ title, children, confirmLabel, busy, onConfirm, onClose, danger, canConfirm }) {
  const id = React.useMemo(() => "tr-confirm-" + Math.random().toString(36).slice(2), []);
  const body = (
    <div>
      <div className="modal-header">
        <h3 className="card-title" id={id} style={{ margin: 0 }}>
          {title}
        </h3>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body tr-modal-body">{children}</div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={"btn-primary" + (danger ? " tr-danger" : "")}
          disabled={busy || canConfirm === false}
          onClick={onConfirm}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </div>
  );
  if (typeof ModalShell !== "function") return <div className="card">{body}</div>;
  return (
    <ModalShell onClose={onClose} labelledBy={id} className="confirm-modal">
      {body}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// The review form (self or manager)
// ---------------------------------------------------------------------------
const TR_FORM_KEYS = [
  "cam_behavior", "cam_success", "own_behavior", "own_success", "hh_behavior", "hh_success",
  "comment_camaraderie", "comment_ownership", "comment_healthy_hustle", "action_steps",
  "note_to_reviewer", "appreciation", "coaching", "evaluation",
];

function TR_pickForm(sub) {
  const out = {};
  TR_FORM_KEYS.forEach((k) => {
    if (sub && sub[k] != null) out[k] = sub[k];
  });
  return out;
}

function TR_ReviewForm({ review, kind, onDone }) {
  const toast = TR_useToastSafe();
  const mine = kind === "self" ? review.self : review.manager;
  const [form, setForm] = React.useState(() => TR_pickForm(mine && mine.visible ? mine : null));
  const [tried, setTried] = React.useState(false);
  const [problems, setProblems] = React.useState([]);
  const [saveState, setSaveState] = React.useState(""); // "", "saving", "saved", "error"
  const [savedAt, setSavedAt] = React.useState(null);
  const [error, setError] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const dirty = React.useRef(false);
  const formRef = React.useRef(form);
  formRef.current = form;

  const isSelf = kind === "self";
  const otherName = isSelf ? review.reviewer && review.reviewer.name : review.staff && review.staff.name;
  const reviewerFirst = TR_first(review.reviewer && review.reviewer.name) || "your reviewer";
  const staffFirst = TR_first(review.staff && review.staff.name) || "them";

  const save = React.useCallback(
    async (submit) => {
      setSaveState("saving");
      const res = await TR_api.rpc("tr_save_submission", {
        p_review: review.id,
        p_kind: kind,
        p_data: formRef.current,
        p_submit: !!submit,
      });
      dirty.current = false;
      setSaveState("saved");
      setSavedAt(new Date());
      return res;
    },
    [review.id, kind],
  );

  // Autosave a draft a moment after typing stops.
  React.useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      save(false).catch((e) => {
        setSaveState("error");
        setError(TR_errText(e));
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [form, save]);

  const set = (k, v) => {
    dirty.current = true;
    setError("");
    setForm((f) => Object.assign({}, f, { [k]: v }));
  };

  const req = TR_requiredComments(form);
  const rated = TR_ratedCount(form);
  const total = TR_total(form);
  const needsStep = TR_needsActionStep(form);
  const localProblems = TR_validateSubmission(form);

  let actionPill = ["No action step required", "good"];
  if (needsStep) actionPill = ["Action step required", "bad"];
  else if (rated < 6) actionPill = ["In progress", "neutral"];

  const trySubmit = () => {
    setTried(true);
    setProblems(localProblems);
    if (localProblems.length) return;
    setConfirming(true);
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await save(true);
      if (res && res.problems && res.problems.length) {
        setProblems(res.problems);
        setConfirming(false);
        return;
      }
      setConfirming(false);
      toast(isSelf ? "Self-review submitted" : `Review of ${staffFirst} submitted`);
      TR_changed();
      onDone && onDone();
    } catch (e) {
      setError(TR_errText(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  let prevSection = "";
  return (
    <div className="tr-form">
      <div className="tr-form-head">
        <div>
          <h2 className="card-title">
            {isSelf ? `${review.cycle.label} self-review` : `Review: ${review.staff ? review.staff.name : ""}`}
          </h2>
          <p className="card-subtitle">Camaraderie, Ownership, Healthy Hustle</p>
        </div>
        <span className="tr-save-state" aria-live="polite">
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved" && savedAt
              ? "Draft saved " + savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
              : saveState === "error"
                ? "Not saved"
                : ""}
        </span>
      </div>

      {TR_ITEMS.map((it, i) => {
        const showSection = it.section !== prevSection;
        prevSection = it.section;
        const sec = TR_SECTIONS.find((s) => s.key === it.section);
        const lastOfSection = i === TR_ITEMS.length - 1 || TR_ITEMS[i + 1].section !== it.section;
        const v = form[it.key];
        const low = TR_isRating(v) && v < TR_LOW;
        const required = req.indexOf(sec.key) >= 0;
        const missing = required && tried && !String(form[sec.comment] || "").trim();
        return (
          <React.Fragment key={it.key}>
            {showSection && <h3 className="tr-section-title">{sec.title}</h3>}
            <div className="card tr-item">
              <div className="tr-item-text">
                <span className="tr-eyebrow">{it.kind}</span>
                <span className="tr-item-title">{it.title}</span>
                {it.details.length > 0 && (
                  <ul className="tr-item-details">
                    {it.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="tr-item-rate">
                <TR_Rating
                  value={v}
                  label={`${sec.title} · ${it.kind}: ${it.title}`}
                  onChange={(n) => set(it.key, n)}
                />
                {low && <TR_Pill tone="bad">Below 3 · action step required</TR_Pill>}
              </div>
            </div>
            {lastOfSection && (
              <div className="card tr-comment">
                <div className="tr-comment-head">
                  <label htmlFor={"tr-c-" + sec.key}>Add comments · {sec.title}</label>
                  {required ? (
                    <TR_Pill tone="bad">Required · action step needed</TR_Pill>
                  ) : (
                    <TR_Pill tone="neutral">Optional</TR_Pill>
                  )}
                </div>
                <textarea
                  id={"tr-c-" + sec.key}
                  className="tr-ta"
                  value={form[sec.comment] || ""}
                  aria-required={required}
                  aria-invalid={missing || undefined}
                  placeholder="Examples, context, or what would help in this area"
                  onChange={(e) => set(sec.comment, e.target.value)}
                />
                {missing && (
                  <span className="tr-field-error" role="alert">
                    A comment is required because this section needs an action step.
                  </span>
                )}
              </div>
            )}
          </React.Fragment>
        );
      })}

      <div className="card tr-total">
        <div className="tr-total-head">
          <div>
            <span className="tr-eyebrow">Total score · {rated} of 6 rated</span>
            <span className="tr-total-n">{(total == null ? TR_partialTotal(form) : total) + " / " + TR_MAX_TOTAL}</span>
          </div>
          <TR_Pill tone={actionPill[1]}>{actionPill[0]}</TR_Pill>
        </div>
        <p className="tr-muted">Any individual rating below 3 or a total below 18 requires an action step.</p>
        <label className="tr-label" htmlFor="tr-action-steps">
          Action steps
        </label>
        <textarea
          id="tr-action-steps"
          className="tr-ta"
          value={form.action_steps || ""}
          aria-required={needsStep}
          placeholder="What will change next quarter, and how will we know?"
          onChange={(e) => set("action_steps", e.target.value)}
        />
        {isSelf ? (
          <>
            <label className="tr-label" htmlFor="tr-note">
              Anything you want {reviewerFirst} to know
            </label>
            <textarea
              id="tr-note"
              className="tr-ta"
              value={form.note_to_reviewer || ""}
              onChange={(e) => set("note_to_reviewer", e.target.value)}
            />
          </>
        ) : (
          <div className="tr-three">
            {[
              ["appreciation", "Appreciation"],
              ["coaching", "Coaching"],
              ["evaluation", "Evaluation"],
            ].map(([k, l]) => (
              <div key={k}>
                <label className="tr-label" htmlFor={"tr-" + k}>
                  {l}
                </label>
                <textarea id={"tr-" + k} className="tr-ta" value={form[k] || ""} onChange={(e) => set(k, e.target.value)} />
              </div>
            ))}
          </div>
        )}
        {tried && problems.length > 0 && (
          <div className="tr-problems" role="alert">
            {problems.map((p) => (
              <TR_Pill key={p} tone="bad">
                {p}
              </TR_Pill>
            ))}
          </div>
        )}
        <TR_Error text={error} />
        <div className="tr-actions">
          <button type="button" className="btn-primary" onClick={trySubmit} disabled={busy}>
            {isSelf ? "Submit self-review" : `Submit review of ${staffFirst}`}
          </button>
          <span className="tr-muted">
            {isSelf
              ? `${TR_first(otherName) || "Your reviewer"} will not see your scores until they submit theirs.`
              : `${staffFirst} will not see your scores until they submit theirs.`}
          </span>
        </div>
      </div>

      {confirming && (
        <TR_Confirm
          title={isSelf ? "Submit your self-review?" : `Submit your review of ${staffFirst}?`}
          confirmLabel="Submit"
          busy={busy}
          onConfirm={submit}
          onClose={() => setConfirming(false)}
        >
          <p>
            Once submitted it is read-only. Total {total} / {TR_MAX_TOTAL}.
          </p>
        </TR_Confirm>
      )}
    </div>
  );
}

// Read-only banner after your form is in.
function TR_SubmittedBanner({ review, kind }) {
  const isSelf = kind === "self";
  const other = isSelf ? review.manager : review.self;
  const otherIn = other && other.status === "submitted";
  const reviewerFirst = TR_first(review.reviewer && review.reviewer.name);
  const staffFirst = TR_first(review.staff && review.staff.name);
  let text;
  if (isSelf) text = otherIn ? "Self-review submitted and locked." : `Self-review submitted and locked. The comparison opens once ${reviewerFirst} submits.`;
  else text = otherIn ? `Your review of ${staffFirst} is submitted and locked.` : `Your review of ${staffFirst} is submitted and locked. The comparison opens once ${staffFirst} submits.`;
  return (
    <div className="tr-banner good" role="status">
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One review (#/reviews/r/<id>): the form you owe, else the comparison.
// ---------------------------------------------------------------------------
function TR_ReviewPage({ reviewId, onBack }) {
  const [state, setState] = React.useState({ review: null, error: "", loading: true });
  const [ver, setVer] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    setState((s) => Object.assign({}, s, { loading: true }));
    TR_api
      .rpc("tr_get_review", { p_review: reviewId })
      .then((r) => alive && setState({ review: r, error: "", loading: false }))
      .catch((e) => alive && setState({ review: null, error: TR_errText(e), loading: false }));
    return () => {
      alive = false;
    };
  }, [reviewId, ver]);
  const reload = () => setVer((v) => v + 1);
  const r = state.review;

  if (state.loading && !r) return <p className="tr-muted">Loading…</p>;
  if (state.error) return <TR_Error text={state.error} />;
  if (!r) return null;

  const formKind = r.my_role === "staff" ? "self" : r.my_role === "reviewer" ? "manager" : null;
  const mine = formKind ? r[formKind] : null;
  const canFill = formKind && r.status === "open" && r.cycle.status === "open" && (!mine || mine.status !== "submitted");

  return (
    <div className="tr-review">
      <button type="button" className="link-btn tr-back" onClick={onBack}>
        ← Back
      </button>
      {r.status === "closed_unsigned" && (
        <div className="tr-banner bad" role="status">
          Closed unsigned{r.closed_reason ? ": " + r.closed_reason : ""}. This review is read-only and kept.
        </div>
      )}
      {canFill ? (
        <TR_ReviewForm key={r.id + ":" + formKind} review={r} kind={formKind} onDone={reload} />
      ) : (
        <>
          {formKind && mine && mine.status === "submitted" && r.status === "open" && <TR_SubmittedBanner review={r} kind={formKind} />}
          {typeof TR_ComparePanel === "function" ? (
            <TR_ComparePanel review={r} onChanged={reload} />
          ) : (
            <p className="tr-muted">The comparison is not available yet.</p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My review (current cycle overview)
// ---------------------------------------------------------------------------
function TR_MyReviewTab({ ov }) {
  const c = ov.cycle;
  const my = ov.my_review;
  if (!c || !my) {
    return (
      <div className="card">
        <h2 className="card-title">No review for you this quarter</h2>
        <p className="card-subtitle">When an admin opens a review cycle with you in it, it shows up here.</p>
      </div>
    );
  }
  const last = ov.last_totals || [];
  const lastTotal = last[0] && last[0].manager_total;
  const prevTotal = last[1] && last[1].manager_total;
  const diff = lastTotal != null && prevTotal != null ? lastTotal - prevTotal : null;
  const steps = ov.open_steps || [];
  const reviewerFirst = TR_first(my.reviewer_name) || "Your reviewer";
  const both = my.self_status === "submitted" && my.manager_status === "submitted";
  const signed = my.status === "signed";
  const survey = ov.survey || {};
  const cycleOpen = c.status === "open";

  const checklist = [
    {
      label: "Self-review",
      note: "Rate yourself on the six review items",
      status: TR_STATUS_PILL[my.self_status] || TR_STATUS_PILL.not_started,
      go: my.self_status !== "submitted" && my.status === "open" && cycleOpen ? () => TR_goReviews("r/" + my.id) : null,
      action: my.self_status === "in_progress" ? "Continue" : "Start",
    },
    {
      label: "Team survey",
      note: "Ten questions on leadership, workload and morale",
      status: survey.submitted_at ? ["Submitted", "good"] : ["Not started", "warm"],
      go: cycleOpen ? () => TR_goReviews("survey") : null,
      action: survey.submitted_at ? "View" : "Start",
    },
    {
      label: `${TR_poss(my.reviewer_name)} review of you`,
      note: "Scores stay hidden until both reviews are in",
      status: my.manager_status === "submitted" ? ["Submitted", "good"] : ["In progress", "neutral"],
      go: null,
    },
    {
      label: "Review meeting and signature",
      note: "Compare results, agree action steps, sign",
      status:
        my.status === "closed_unsigned"
          ? ["Closed unsigned", "bad"]
          : signed
            ? ["Signed", "good"]
            : both
              ? my.staff_signed
                ? ["Waiting for " + reviewerFirst, "warm"]
                : ["Ready", "warm"]
              : ["Locked", "neutral"],
      go: both || signed || my.status === "closed_unsigned" ? () => TR_goReviews("r/" + my.id) : null,
      action: "Open",
    },
  ];

  return (
    <div className="tr-tab">
      <div className="kpi-grid">
        <TR_Kpi
          label={c.label + " cycle"}
          value={c.status === "open" && c.due_at ? "Due " + TR_fmtDate(c.due_at) : c.status === "open" ? "Open" : "Closed"}
          sub={c.opened_by ? `Opened ${TR_fmtDate(c.opens_at)} by ${TR_first(c.opened_by)}` : ""}
        />
        <TR_Kpi
          label={last[0] ? `Last quarter (${last[0].label})` : "Last quarter"}
          value={lastTotal != null ? `${lastTotal} / ${TR_MAX_TOTAL}` : "—"}
          sub={diff == null ? (last[0] ? "" : "No locked reviews yet") : `${diff > 0 ? "↑" : diff < 0 ? "↓" : "→"} ${Math.abs(diff)} vs. ${last[1].label}`}
          subTone={diff == null ? "neutral" : diff > 0 ? "positive" : diff < 0 ? "negative" : "neutral"}
        />
        <TR_Kpi
          label="Open action steps"
          value={steps.length}
          sub={steps.some((s) => s.from_label) ? "Includes steps carried forward" : ""}
        />
      </div>

      <div className="card">
        <h2 className="card-title">Your {c.label} checklist</h2>
        <ul className="tr-checklist">
          {checklist.map((row) => (
            <li key={row.label} className="tr-check-row">
              <div className="tr-check-text">
                <strong>{row.label}</strong>
                <span className="tr-muted">{row.note}</span>
              </div>
              <TR_Pill tone={row.status[1]}>{row.status[0]}</TR_Pill>
              {row.go ? (
                <button type="button" className="btn-secondary" onClick={row.go}>
                  {row.action}
                </button>
              ) : (
                <span className="tr-check-spacer" />
              )}
            </li>
          ))}
        </ul>
      </div>

      {steps.length > 0 && (
        <div className="card">
          <h2 className="card-title">Action steps</h2>
          <ul className="tr-steps-mini">
            {steps.map((s) => (
              <li key={s.id}>
                <span>{s.description}</span>
                <span className="tr-muted">
                  {[s.from_label ? "From " + s.from_label : "", s.section ? TR_sectionTitle(s.section) : "", s.due_date ? "Due " + TR_fmtDate(s.due_date) : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <TR_Pill tone={s.status === "in_progress" ? "warm" : "neutral"}>{TR_STEP_STATUS[s.status] || s.status}</TR_Pill>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const TR_STEP_STATUS = { open: "Open", in_progress: "In progress", done: "Done", carried: "Carried forward", removed: "Removed" };
function TR_sectionTitle(key) {
  const s = TR_SECTIONS.find((x) => x.key === key);
  return s ? s.title : "";
}

// Admin: the reviews you're writing this cycle.
function TR_GivingTab({ ov }) {
  const rows = ov.giving || [];
  if (!rows.length) {
    return (
      <div className="card">
        <h2 className="card-title">No reviews assigned to you</h2>
        <p className="card-subtitle">Reviews you give show up here once a cycle is opened with you as the reviewer.</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h2 className="card-title">Reviews I’m giving · {ov.cycle ? ov.cycle.label : ""}</h2>
      <div className="al-table-wrap">
        <table className="tx-table tx-table-labeled tr-table">
          <thead>
            <tr>
              <th scope="col">Team member</th>
              <th scope="col">Self-review</th>
              <th scope="col">Your review</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="tr-sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.review_id}>
                <td data-label="Team member">
                  <strong>{g.staff_name}</strong>
                </td>
                <td data-label="Self-review">
                  <TR_StatusPill status={g.self_status} />
                </td>
                <td data-label="Your review">
                  <TR_StatusPill status={g.manager_status} />
                </td>
                <td data-label="Status">
                  <TR_ReviewStatusPill status={g.status} />
                </td>
                <td className="row-remove-cell">
                  <button type="button" className="btn-secondary" onClick={() => TR_goReviews("r/" + g.review_id)} aria-label={"Open review for " + g.staff_name}>
                    {g.status === "open" && g.manager_status !== "submitted" ? (g.manager_status === "in_progress" ? "Continue" : "Start") : "Open"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------
function TR_parseRoute() {
  const h = String(window.location.hash || "");
  const m = /^#\/reviews(?:\/(.*))?$/.exec(h);
  const rest = m && m[1] ? m[1].split("/").filter(Boolean) : [];
  if (rest[0] === "r" && rest[1]) return { tab: null, reviewId: rest[1] };
  if (rest[0] === "survey") return { tab: null, survey: true };
  return { tab: rest[0] || null };
}

function TR_useRoute() {
  const [route, setRoute] = React.useState(TR_parseRoute);
  React.useEffect(() => {
    const on = () => setRoute(TR_parseRoute());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

function TR_TeamReviewsPage() {
  const { data: ov, error } = TR_useOverview();
  const route = TR_useRoute();
  const lastTab = React.useRef(null);

  if (error && !ov) return <TR_Error text={error} />;
  if (!ov) return <p className="tr-muted">Loading…</p>;

  const isAdmin = !!(ov.me && ov.me.is_admin);
  const tabs = [];
  if (!isAdmin || ov.my_review) tabs.push({ key: "my", label: "My review" });
  tabs.push({ key: "history", label: "History" });
  if (isAdmin) {
    tabs.push({ key: "team", label: "Team status" });
    tabs.push({ key: "giving", label: "Reviews I’m giving" });
    tabs.push({ key: "results", label: "Survey results" });
    tabs.push({ key: "year-end", label: "Year-end" });
  }
  const dueKinds = new Set(((ov.due && ov.due.items) || []).map((i) => i.kind));
  const defaultTab = isAdmin && !ov.my_review ? (dueKinds.has("manager") || dueKinds.has("sign") ? "giving" : "team") : "my";
  const inDetail = !!(route.reviewId || route.survey);
  const tab = inDetail
    ? lastTab.current || defaultTab
    : tabs.some((t) => t.key === route.tab)
      ? route.tab
      : defaultTab;
  if (!inDetail) lastTab.current = tab;

  const back = () => TR_goReviews(lastTab.current && lastTab.current !== defaultTab ? lastTab.current : "");
  const onKeyDown = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.key === tab);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    TR_goReviews(next.key);
    setTimeout(() => {
      const el = document.getElementById("tr-tab-" + next.key);
      if (el) el.focus();
    }, 0);
  };

  let body;
  if (route.reviewId) body = <TR_ReviewPage key={route.reviewId} reviewId={route.reviewId} onBack={back} />;
  else if (route.survey)
    body =
      typeof TR_SurveyPage === "function" ? <TR_SurveyPage onBack={back} /> : <p className="tr-muted">The survey is not available yet.</p>;
  else if (tab === "my") body = <TR_MyReviewTab ov={ov} />;
  else if (tab === "giving") body = <TR_GivingTab ov={ov} />;
  else if (tab === "history") body = typeof TR_HistoryTab === "function" ? <TR_HistoryTab ov={ov} /> : null;
  else if (tab === "team") body = typeof TR_TeamStatusTab === "function" ? <TR_TeamStatusTab ov={ov} /> : null;
  else if (tab === "results") body = typeof TR_SurveyResultsTab === "function" ? <TR_SurveyResultsTab /> : null;
  else if (tab === "year-end") body = typeof TR_YearEndTab === "function" ? <TR_YearEndTab ov={ov} /> : null;

  return (
    <div className="tr-page">
      <div className="tp-hub-tabs" role="tablist" aria-label="Reviews" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.key}
            id={"tr-tab-" + t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls="tr-panel"
            tabIndex={tab === t.key ? 0 : -1}
            className={"tp-hub-tab" + (tab === t.key ? " active" : "")}
            onClick={() => TR_goReviews(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="tr-panel" role="tabpanel" aria-labelledby={"tr-tab-" + tab}>
        {body}
      </div>
    </div>
  );
}

function TR_Icon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M9 3.5h6v3H9z" />
      <path d="m9 13 2 2 4-4" />
    </svg>
  );
}
