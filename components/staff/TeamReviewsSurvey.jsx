// Team survey (#/reviews/survey) and the admin "Survey results" tab.
// Loaded after TeamReviews.jsx; uses its TR_* helpers.
//
// Q7 and Q10 are anonymous: tr_survey_submit stores them without a name or
// time, and tr_survey_results returns them only once 3 or more people have
// answered that question. Everything else is visible to all admins by name.

const TR_SURVEY_QUESTIONS = [
  { id: "q1", text: "Are the expectations for your role clear? If not, what’s unclear?" },
  { id: "q2", text: "Do you get feedback on your work that is constructive and comes soon enough to use?" },
  { id: "q3", text: "What is the biggest obstacle in your role right now?", ph: "Tools, processes, client issues, bottlenecks" },
  { id: "q4", text: "If you could eliminate or change one task, meeting, or process from your week, what would it be?" },
  { id: "q5", text: "Do you have the autonomy you need to own your client work, or do you ever feel micromanaged?" },
  { id: "q6", text: "On a scale of 1–5, how would you rate team morale right now, and what’s driving that number?", kind: "rating", ph: "What’s driving that number?" },
  { id: "q7", text: "Do you feel comfortable sharing ideas or disagreeing without negative consequences?", anon: true },
  { id: "q8", text: "Is your workload manageable? Do you want more work, less, or about the same?", kind: "workload", ph: "Anything to add?" },
  { id: "q9", text: "What training, resources, or support would help you succeed next quarter?" },
  { id: "q10", text: "What is one thing I should start, stop, or continue doing to be a better leader for you?", anon: true },
];
const TR_WORKLOAD = [
  { value: "more", label: "More" },
  { value: "same", label: "About the same" },
  { value: "less", label: "Less" },
];
const TR_WORKLOAD_LABEL = { more: "More", same: "About the same", less: "Less" };

// "Holden, Jesse, Jeff and Bailey"
function TR_andList(names) {
  const n = (names || []).filter(Boolean);
  if (n.length <= 1) return n.join("");
  return n.slice(0, -1).join(", ") + " and " + n[n.length - 1];
}

function TR_fmtDay(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Staff: the survey
// ---------------------------------------------------------------------------
function TR_SurveyPage({ onBack }) {
  const toast = TR_useToastSafe();
  const [state, setState] = React.useState({ data: null, error: "", loading: true });
  const [ver, setVer] = React.useState(0);
  const [answers, setAnswers] = React.useState({});
  const [tried, setTried] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    TR_api
      .rpc("tr_survey_get", {})
      .then((d) => alive && setState({ data: d, error: "", loading: false }))
      .catch((e) => alive && setState({ data: null, error: TR_errText(e), loading: false }));
    return () => {
      alive = false;
    };
  }, [ver]);

  const back = (
    <button type="button" className="link-btn tr-back" onClick={onBack}>
      ← Back
    </button>
  );
  const d = state.data;
  if (state.loading) return <p className="tr-muted">Loading…</p>;
  if (state.error) return <div className="tr-review">{back}<TR_Error text={state.error} /></div>;
  if (!d || !d.cycle)
    return (
      <div className="tr-review">
        {back}
        <div className="card"><p className="tr-muted" style={{ margin: 0 }}>No survey is open right now.</p></div>
      </div>
    );

  const submitted = !!d.submitted_at;
  const closed = d.cycle.status !== "open";
  const readOnly = submitted || closed || !d.eligible;
  const shown = submitted ? d.answers || {} : answers;
  const count = TR_surveyAnsweredCount(shown);
  const admins = TR_andList(d.admins || []);

  const set = (k, v) => {
    if (readOnly) return;
    setError("");
    setAnswers((a) => Object.assign({}, a, { [k]: v }));
  };

  const trySubmit = () => {
    setTried(true);
    if (count < TR_SURVEY_MIN) return;
    setConfirming(true);
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await TR_api.rpc("tr_survey_submit", { p_cycle: d.cycle.id, p_answers: answers });
      setConfirming(false);
      toast("Survey submitted. Thank you.");
      TR_changed();
      setAnswers({});
      setVer((v) => v + 1);
    } catch (e) {
      setError(TR_errText(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tr-review tr-survey">
      {back}
      <div className="tr-form-head">
        <div>
          <h2 className="card-title">Team survey · {d.cycle.label}</h2>
          <p className="card-subtitle">Ten questions, about ten minutes</p>
        </div>
      </div>
      {submitted && (
        <div className="tr-banner good" role="status">
          Survey submitted {TR_fmtDay(d.submitted_at)}. Thank you.
        </div>
      )}
      {!submitted && closed && (
        <div className="tr-banner" role="status">
          The survey for {d.cycle.label} is closed.
        </div>
      )}
      {!d.eligible && !submitted && (
        <div className="tr-banner" role="status">
          The survey is for team members in this review cycle.
        </div>
      )}

      <div className="card tr-survey-intro">
        <div className="tr-card-head">
          <h3 className="card-title tr-survey-min">Answer at least 3 of the 10 questions, or as many as you like.</h3>
          {!submitted && <TR_Pill tone={count >= TR_SURVEY_MIN ? "good" : "neutral"}>{count} of 10 answered</TR_Pill>}
        </div>
        <p className="tr-muted" style={{ margin: 0 }}>
          Your answers are visible to all admins{admins ? ` (${admins})` : ""}.
        </p>
        <p className="tr-muted" style={{ margin: "6px 0 0" }}>
          Questions 7 and 10 are anonymous: those answers are saved without your name and are shown to admins only once 3 or more
          people have answered.
        </p>
      </div>

      {TR_SURVEY_QUESTIONS.map((q, i) => {
        const id = "tr-s-" + q.id;
        const anonHidden = submitted && q.anon;
        return (
          <div className="card tr-q" key={q.id}>
            <label className="tr-q-label" htmlFor={anonHidden ? undefined : id}>
              <span className="tr-q-num">{String(i + 1).padStart(2, "0")}</span>
              <span>
                {q.text}
                {q.anon && (
                  <span className="tr-anon-tag">
                    <TR_Pill tone="neutral">Anonymous</TR_Pill>
                  </span>
                )}
              </span>
            </label>
            {q.kind === "rating" && (
              <div className="tr-chip-row" role="group" aria-label="Morale rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={"tr-chip" + (shown.q6_rating === n ? " on" : "")}
                    aria-pressed={shown.q6_rating === n}
                    aria-label={`Morale ${n} of 5`}
                    disabled={readOnly}
                    onClick={() => set("q6_rating", shown.q6_rating === n ? null : n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
            {q.kind === "workload" && (
              <div className="tr-chip-row" role="group" aria-label="Workload preference">
                {TR_WORKLOAD.map((w) => (
                  <button
                    key={w.value}
                    type="button"
                    className={"tr-chip" + (shown.q8_choice === w.value ? " on" : "")}
                    aria-pressed={shown.q8_choice === w.value}
                    disabled={readOnly}
                    onClick={() => set("q8_choice", shown.q8_choice === w.value ? null : w.value)}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            )}
            {anonHidden ? (
              <p className="tr-muted" style={{ margin: 0 }}>
                Anonymous answers aren’t linked to you, so they aren’t shown here.
              </p>
            ) : (
              <textarea
                id={id}
                className="tr-ta"
                value={shown[q.id] || ""}
                placeholder={q.ph || ""}
                readOnly={readOnly}
                maxLength={5000}
                onChange={(e) => set(q.id, e.target.value)}
              />
            )}
          </div>
        );
      })}

      {!readOnly && (
        <div className="tr-actions">
          <button type="button" className="btn-primary" onClick={trySubmit} disabled={busy}>
            Submit survey
          </button>
          {tried && count < TR_SURVEY_MIN && (
            <span role="alert">
              <TR_Pill tone="bad">Answer at least 3 questions to submit</TR_Pill>
            </span>
          )}
        </div>
      )}
      <TR_Error text={error} />

      {confirming && (
        <TR_Confirm
          title="Submit the survey?"
          confirmLabel="Submit survey"
          busy={busy}
          onConfirm={submit}
          onClose={() => setConfirming(false)}
        >
          <p>
            You answered {count} of 10. You can’t change your answers after you submit.
          </p>
        </TR_Confirm>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: survey results
// ---------------------------------------------------------------------------
function TR_SurveyResultsTab() {
  const [cycleId, setCycleId] = React.useState(null);
  const [state, setState] = React.useState({ data: null, error: "", loading: true });

  React.useEffect(() => {
    let alive = true;
    setState((s) => Object.assign({}, s, { loading: true }));
    TR_api
      .rpc("tr_survey_results", { p_cycle: cycleId })
      .then((d) => alive && setState({ data: d, error: "", loading: false }))
      .catch((e) => alive && setState({ data: null, error: TR_errText(e), loading: false }));
    return () => {
      alive = false;
    };
  }, [cycleId]);

  const d = state.data;
  if (state.loading && !d) return <p className="tr-muted">Loading…</p>;
  if (state.error) return <TR_Error text={state.error} />;
  if (!d || !d.cycle)
    return (
      <div className="card">
        <p className="tr-muted" style={{ margin: 0 }}>No review cycles yet. Survey results appear here once a cycle is open.</p>
      </div>
    );

  const responses = d.responses || [];
  const wl = d.workload || { more: 0, same: 0, less: 0 };
  let moraleSub = null;
  let moraleTone = "neutral";
  if (d.morale != null && d.morale_prev != null) {
    const diff = Math.round((Number(d.morale) - Number(d.morale_prev)) * 10) / 10;
    moraleSub = (diff > 0 ? "↑ " : diff < 0 ? "↓ " : "") + Math.abs(diff).toFixed(1) + " vs. " + String(d.prev_label || "").split(" ")[0];
    moraleTone = diff > 0 ? "good" : diff < 0 ? "bad" : "neutral";
  }

  return (
    <div className="tr-tab">
      <div className="tr-toolbar">
        <div className="al-field">
          <label htmlFor="tr-res-cycle">Quarter</label>
          <select id="tr-res-cycle" className="tr-sel" value={d.cycle.id} onChange={(e) => setCycleId(e.target.value)}>
            {(d.cycles || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="kpi-grid tr-kpis">
        <TR_Kpi label="Responses" value={`${responses.length} / ${d.eligible || 0}`} />
        <TR_Kpi label="Team morale" value={d.morale != null ? `${Number(d.morale).toFixed(1)} / 5` : "—"} sub={moraleSub} subTone={moraleTone} />
        <TR_Kpi label="Want more work" value={String(wl.more || 0)} sub={`${wl.same || 0} same · ${wl.less || 0} less`} />
      </div>

      {TR_SURVEY_QUESTIONS.map((q, i) => {
        const head = (
          <h3 className="tr-q-label" style={{ margin: "0 0 4px" }}>
            <span className="tr-q-num">{String(i + 1).padStart(2, "0")}</span>
            <span>
              {q.text}
              {q.anon && (
                <span className="tr-anon-tag">
                  <TR_Pill tone="neutral">Anonymous</TR_Pill>
                </span>
              )}
            </span>
          </h3>
        );
        if (q.anon) {
          const g = (d.anonymous || {})[q.id] || { shown: false };
          return (
            <div className="card tr-q" key={q.id}>
              {head}
              {g.shown ? (
                <>
                  <p className="tr-muted" style={{ margin: 0 }}>
                    {g.count} anonymous answers, in no particular order.
                  </p>
                  <ul className="tr-answers">
                    {(g.answers || []).map((a, k) => (
                      <li key={k}>{a}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="tr-muted" style={{ margin: 0 }}>
                  Shown once 3 or more people answer.
                </p>
              )}
            </div>
          );
        }
        const rows = responses
          .map((r) => {
            const a = r.answers || {};
            const extra = q.kind === "rating" && a.q6_rating ? `Morale ${a.q6_rating} / 5` : q.kind === "workload" && a.q8_choice ? TR_WORKLOAD_LABEL[a.q8_choice] : "";
            return { who: r.staff_name, extra, text: a[q.id] || "" };
          })
          .filter((r) => r.extra || String(r.text).trim());
        return (
          <div className="card tr-q" key={q.id}>
            {head}
            {rows.length ? (
              <ul className="tr-answers">
                {rows.map((r, k) => (
                  <li key={k}>
                    <span className="tr-answer-who">
                      {r.who}
                      {r.extra ? " · " + r.extra : ""}
                    </span>
                    {r.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="tr-muted" style={{ margin: 0 }}>
                No answers yet.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
