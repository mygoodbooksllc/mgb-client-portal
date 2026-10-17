// ----------------------------------------------------------------------------
// TK_Templates.jsx — recurring templates at #/tasks/templates (Tasks Phase 2, S4).
//
// TK_Templates({ staffUser, clients, isAdmin })
//   Admins: every template grouped (standard sets first, then the firm's own),
//   the editor with a due-rule builder and a live "next due" preview, status
//   steps (Turn on / Pause / Resume / Retire / Back to draft), a server preview
//   of the next 30 days, Generate now, missed periods (past the 7-day grace:
//   listed, never created on their own), "Save as template" suggestions from
//   staff, and the last runs.
//   Everyone else (temporary admins too): read-only list, plus the per-client panel (what's coming
//   for a client they can see, and per-client changes they may make).
//
// The pure parts are in TK_templateLogic.js (tested in node). Every write is an
// RPC in supabase/tasks-p2-4-recurring.sql; the server decides who may call it.
// New templates always start as drafts; the standard close set only reaches
// real clients after the owner turns standard_set_live on.
// ----------------------------------------------------------------------------

var TK_TPL_PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
];
var TK_TPL_TIERS = ["basic", "premium"];

function TK_tplPlanLabel(p) {
  try {
    if (typeof planLabel === "function") return planLabel(p) || p;
  } catch (e) {}
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function TK_tplFmtDate(ymd) {
  if (!ymd) return "";
  var p = String(ymd).slice(0, 10).split("-");
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  try {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  } catch (e) {
    return String(ymd).slice(0, 10);
  }
}

function TK_tplFmtTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return String(ts);
  }
}

function TK_tplErr(err) {
  var t = typeof TK_tplErrorText === "function" ? TK_tplErrorText(err) : null;
  return t || TK_vErrText(err);
}

function TK_tplLen(v) {
  if (Array.isArray(v)) return v.length;
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

// Old "Save as template" drafts (TaskTemplates.jsx shape) -> the editor's draft.
function TK_tplFromLegacyDraft(d) {
  var x = TK_tplBlank();
  var src = d || {};
  x.title = TK_tplStripPeriod(src.title || "");
  x.client_ids = Array.isArray(src.client_ids) ? src.client_ids.slice() : [];
  x.priority = ["low", "normal", "high"].indexOf(src.priority) >= 0 ? src.priority : "normal";
  x.checklist = Array.isArray(src.checklist) ? src.checklist.slice(0, 50) : [];
  x._prefilled = true;
  if (src._suggestionId) x._suggestionId = src._suggestionId;
  return x;
}

// ---- The due-rule builder (shared by the editor and the client override) --------------

function TK_tplNumSelect(props) {
  var opts = [];
  for (var i = props.from; i <= props.to; i++) opts.push(i);
  return (
    <select
      className="tk-select"
      value={String(props.value)}
      aria-label={props.label}
      disabled={props.disabled}
      onChange={function (e) {
        props.onChange(Number(e.target.value));
      }}
    >
      {props.extra ? props.extra.map(function (o) {
        return (
          <option key={o.value} value={String(o.value)}>
            {o.label}
          </option>
        );
      }) : null}
      {opts.map(function (n) {
        return (
          <option key={n} value={String(n)}>
            {props.fmt ? props.fmt(n) : n}
          </option>
        );
      })}
    </select>
  );
}

function TK_tplRuleBuilder(props) {
  var cadence = props.cadence;
  var rule = props.rule || TK_tplDefaultRule("offset", cadence);
  var types = TK_TPL_RULES_BY_CADENCE[cadence] || [];
  var set = function (patch) {
    var next = {};
    for (var k in rule) next[k] = rule[k];
    for (var j in patch) next[j] = patch[j];
    props.onChange(next);
  };
  var maxMo = cadence === "annually" ? 12 : 3;
  var period = cadence === "weekly" ? "week" : cadence === "quarterly" ? "quarter" : cadence === "annually" ? "year" : "month";
  var moSelect = (
    <TK_tplNumSelect
      label="Which month"
      from={0}
      to={maxMo}
      value={rule.month_offset == null ? 1 : rule.month_offset}
      disabled={props.disabled}
      fmt={function (n) {
        if (n === 0) return cadence === "monthly" ? "the same month" : "the " + period + "'s last month";
        if (n === 1) return "the month after it ends";
        return "the " + TK_tplOrdinal(n) + " month after it ends";
      }}
      onChange={function (n) {
        set({ month_offset: n });
      }}
    />
  );
  var rollSelect = (
    <select
      className="tk-select"
      aria-label="If it lands on a weekend or holiday"
      value={rule.roll == null ? (rule.type === "day_of_month" ? "next" : "none") : rule.roll}
      disabled={props.disabled}
      onChange={function (e) {
        set({ roll: e.target.value });
      }}
    >
      <option value="next">move to the next business day</option>
      <option value="prev">move to the business day before</option>
      <option value="none">keep the date</option>
    </select>
  );
  var dowSelect = (
    <TK_tplNumSelect
      label="Day of the week"
      from={1}
      to={7}
      value={rule.dow || 5}
      disabled={props.disabled}
      fmt={function (n) {
        return TK_TPL_DOW[n];
      }}
      onChange={function (n) {
        set({ dow: n });
      }}
    />
  );

  var fields = null;
  if (rule.type === "business_day") {
    fields = (
      <div className="tk-tpl-rule-row">
        <TK_tplNumSelect
          label="Which business day"
          from={1}
          to={23}
          value={rule.n}
          disabled={props.disabled}
          extra={[{ value: -1, label: "Last" }]}
          fmt={TK_tplOrdinal}
          onChange={function (n) {
            set({ n: n });
          }}
        />
        <span>business day of</span>
        {moSelect}
      </div>
    );
  } else if (rule.type === "eom") {
    fields = (
      <div className="tk-tpl-rule-row">
        <TK_tplNumSelect
          label="Business days before the last business day"
          from={0}
          to={10}
          value={rule.offset_bd || 0}
          disabled={props.disabled}
          fmt={function (n) {
            return n === 0 ? "The last business day" : n + " business day" + (n === 1 ? "" : "s") + " before the last";
          }}
          onChange={function (n) {
            set({ offset_bd: n });
          }}
        />
        <span>of</span>
        {moSelect}
      </div>
    );
  } else if (rule.type === "day_of_month") {
    fields = (
      <div className="tk-tpl-rule-row">
        <span>The</span>
        <TK_tplNumSelect
          label="Day of the month"
          from={1}
          to={31}
          value={rule.day || 15}
          disabled={props.disabled}
          fmt={TK_tplOrdinal}
          onChange={function (n) {
            set({ day: n });
          }}
        />
        <span>of</span>
        {moSelect}
        <span>and</span>
        {rollSelect}
      </div>
    );
  } else if (rule.type === "nth_weekday") {
    fields = (
      <div className="tk-tpl-rule-row">
        <span>The</span>
        <TK_tplNumSelect
          label="Which one"
          from={1}
          to={5}
          value={rule.n}
          disabled={props.disabled}
          extra={[{ value: -1, label: "last" }]}
          fmt={TK_tplOrdinal}
          onChange={function (n) {
            set({ n: n });
          }}
        />
        {dowSelect}
        <span>of</span>
        {moSelect}
        <span>and</span>
        {rollSelect}
      </div>
    );
  } else if (rule.type === "weekday") {
    fields = (
      <div className="tk-tpl-rule-row">
        <span>Every</span>
        {dowSelect}
        <span>(a holiday moves it to the next business day)</span>
      </div>
    );
  } else if (rule.type === "offset") {
    fields = (
      <div className="tk-tpl-rule-row">
        <input
          className="tk-input tk-tpl-num"
          type="number"
          min={-90}
          max={120}
          step={1}
          aria-label="Days after the period ends"
          value={rule.days == null ? "" : String(rule.days)}
          disabled={props.disabled}
          onChange={function (e) {
            var v = e.target.value;
            set({ days: v === "" || v === "-" ? 0 : Math.trunc(Number(v)) || 0 });
          }}
        />
        <span>days after the {period} ends (use a minus number for before)</span>
      </div>
    );
  }

  return (
    <div className="tk-field tk-tpl-rule" role="group" aria-labelledby={props.id + "-label"}>
      <span className="tk-field-label" id={props.id + "-label"}>
        Due
      </span>
      <select
        className="tk-select"
        aria-label="Kind of due date"
        value={rule.type}
        disabled={props.disabled}
        onChange={function (e) {
          props.onChange(TK_tplDefaultRule(e.target.value, cadence));
        }}
      >
        {types.map(function (t) {
          return (
            <option key={t} value={t}>
              {TK_TPL_RULE_LABELS[t]}
            </option>
          );
        })}
      </select>
      {fields}
      <p className="tk-field-help">{TK_dueRuleText(rule, cadence)}</p>
      {props.error ? (
        <p className="tk-field-error" role="alert">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

// The next due dates for a draft, worked out in the browser.
function TK_tplNextList(props) {
  var list = TK_tplUpcoming(props.tpl, {
    today: props.today,
    holidays: props.holidays,
    count: props.count || 3,
    activatedOn: props.activatedOn || props.today,
    override: props.override || null,
    fye: props.fye || "12-31",
  });
  if (!list) return <p className="tk-field-help">Pick a due date that works to see the next ones.</p>;
  if (!list.length) return <p className="tk-field-help">No upcoming dates.</p>;
  return (
    <ul className="tk-tpl-next-list">
      {list.map(function (p) {
        return (
          <li key={p.start}>
            <strong>{p.label}</strong>
            {" · due " + TK_tplFmtDate(p.due)}
            <span className="tk-muted">{p.when === "now" ? " · made on the next run" : " · shows up " + TK_tplFmtDate(p.startOn)}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ---- The editor (admins) -------------------------------------------------------------

function TK_tplEditor(props) {
  var dPair = React.useState(function () {
    return props.draft;
  });
  var d = dPair[0];
  var setD = dPair[1];
  var clPair = React.useState(function () {
    return (props.draft.checklist || []).join("\n");
  });
  var clText = clPair[0];
  var setClText = clPair[1];
  var errPair = React.useState(null);
  var errs = errPair[0];
  var setErrs = errPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var mPair = React.useState("");
  var msg = mPair[0];
  var setMsg = mPair[1];
  var fPair = React.useState("");
  var filter = fPair[0];
  var setFilter = fPair[1];

  var titleId = "tk-tpl-ed-title";
  var isNew = !d.id;
  var inSet = !!d.template_set_id;
  var status = TK_tplStatus(d);
  // once it has been on, cadence + year basis are fixed (the server refuses a change)
  var cadenceLocked = TK_tplCadenceLocked(d, props.issuedCount);

  var set = function (patch) {
    setD(function (cur) {
      var next = {};
      for (var k in cur) next[k] = cur[k];
      for (var j in patch) next[j] = patch[j];
      return next;
    });
  };

  var full = function () {
    var x = {};
    for (var k in d) x[k] = d[k];
    x.checklist = TK_tplChecklistLines(clText);
    return x;
  };

  var save = function (e) {
    if (e) e.preventDefault();
    if (busy) return;
    var x = full();
    var v = TK_tplValidate(x);
    if (String(clText).split("\n").filter(function (s) { return s.trim(); }).length > 50) {
      v = v || {};
      v.checklist = "Keep it to 50 steps.";
    }
    setErrs(v);
    if (v) {
      setMsg("Fix the marked fields first.");
      return;
    }
    setBusy(true);
    setMsg("");
    TK_api.saveTemplate(x.id, TK_tplToPayload(x)).then(
      function (id) {
        setBusy(false);
        props.onSaved(id || x.id, x);
      },
      function (err) {
        setBusy(false);
        setMsg(TK_tplErr(err));
      },
    );
  };

  var clients = Array.isArray(props.clients) ? props.clients : [];
  var q = filter.trim().toLowerCase();
  var picked = d.client_ids || [];
  var shownClients = clients
    .filter(function (c) {
      if (!c || !c.id) return false;
      if (picked.indexOf(c.id) >= 0) return true;
      return !q || String(c.name || c.id).toLowerCase().indexOf(q) >= 0;
    })
    .slice(0, 200);

  var tplForPreview = { cadence: d.cadence, due_rule: d.rule, lead_days: d.lead_days, period_basis: d.period_basis };

  return (
    <TK_vModal onClose={props.onClose} labelledBy={titleId} className="tk-modal tk-tpl-editor">
      <form onSubmit={save} noValidate>
        <div className="modal-header">
          <h3 className="card-title" id={titleId} style={{ margin: 0 }}>
            {isNew ? "New recurring template" : "Edit template"}
          </h3>
          <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body tk-form">
          {isNew ? (
            <p className="tk-form-note">
              {d._prefilled ? "Filled in from the task. " : ""}New templates start as drafts. Nothing is created until you turn it on.
            </p>
          ) : status === "active" ? (
            <p className="tk-form-note">It's on. Changes apply to periods that haven't been created yet.</p>
          ) : null}

          <label className="tk-field">
            <span className="tk-field-label">Title</span>
            <input
              className={"tk-input" + (errs && errs.title ? " is-invalid" : "")}
              type="text"
              maxLength={200}
              value={d.title}
              autoFocus
              placeholder="Monthly close"
              aria-invalid={errs && errs.title ? "true" : "false"}
              onChange={function (e) {
                set({ title: e.target.value });
              }}
            />
            <span className="tk-field-help">Each task gets the period added, like "Monthly close · Sep 2026".</span>
          </label>
          {errs && errs.title ? (
            <p className="tk-field-error" role="alert">
              {errs.title}
            </p>
          ) : null}

          <div className="tk-tpl-grid">
            <label className="tk-field">
              <span className="tk-field-label">Repeats</span>
              <select
                className="tk-select"
                value={d.cadence}
                disabled={cadenceLocked}
                aria-describedby={cadenceLocked ? "tk-tpl-ed-lock" : undefined}
                onChange={function (e) {
                  var c = e.target.value;
                  var allowed = TK_TPL_RULES_BY_CADENCE[c] || [];
                  var r = d.rule && allowed.indexOf(d.rule.type) >= 0 ? d.rule : TK_tplDefaultRule(allowed[0], c);
                  set({ cadence: c, rule: r });
                }}
              >
                {TK_TPL_CADENCES.map(function (c) {
                  return (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  );
                })}
              </select>
            </label>
            {d.cadence === "annually" ? (
              <label className="tk-field">
                <span className="tk-field-label">Year</span>
                <select
                  className="tk-select"
                  value={d.period_basis}
                  disabled={cadenceLocked}
                  aria-describedby={cadenceLocked ? "tk-tpl-ed-lock" : undefined}
                  onChange={function (e) {
                    set({ period_basis: e.target.value });
                  }}
                >
                  <option value="calendar">Calendar year</option>
                  <option value="fiscal">Each client's fiscal year</option>
                </select>
              </label>
            ) : null}
          </div>
          {cadenceLocked ? (
            <p className="tk-field-help" id="tk-tpl-ed-lock">
              {TK_TPL_CADENCE_LOCK_NOTE}
            </p>
          ) : null}

          <TK_tplRuleBuilder
            id="tk-tpl-ed-rule"
            cadence={d.cadence}
            rule={d.rule}
            error={errs && errs.rule}
            onChange={function (r) {
              set({ rule: r });
            }}
          />

          <div className="tk-tpl-grid">
            <label className="tk-field">
              <span className="tk-field-label">Show it this many days early</span>
              <input
                className={"tk-input tk-tpl-num" + (errs && errs.lead_days ? " is-invalid" : "")}
                type="number"
                min={0}
                max={90}
                value={String(d.lead_days)}
                onChange={function (e) {
                  set({ lead_days: e.target.value === "" ? "" : Math.trunc(Number(e.target.value)) });
                }}
              />
              {errs && errs.lead_days ? <span className="tk-field-error">{errs.lead_days}</span> : null}
            </label>
            <label className="tk-field" data-tour="tk-tpl-assign">
              <span className="tk-field-label">Assign to</span>
              <select
                className="tk-select"
                value={d.assign_mode === "person" ? "person" : d.assign_mode === "unassigned" ? "unassigned" : "role:" + d.assignee_role}
                onChange={function (e) {
                  var v = e.target.value;
                  if (v === "person") set({ assign_mode: "person" });
                  else if (v === "unassigned") set({ assign_mode: "unassigned", assignee_email: "" });
                  else set({ assign_mode: "role", assignee_email: "", assignee_role: v.slice(5) });
                }}
              >
                {TK_TPL_ROLES.map(function (r) {
                  return (
                    <option key={r.value} value={"role:" + r.value}>
                      {"The client's " + r.label.toLowerCase()}
                    </option>
                  );
                })}
                <option value="person">A named person</option>
                <option value="unassigned">Leave unassigned (anyone on the client can claim it)</option>
              </select>
              <span className="tk-field-help">
                {d.assign_mode === "person"
                  ? "Every client's task goes to this person."
                  : d.assign_mode === "unassigned"
                    ? "Tasks show as Unassigned. Anyone on the client's team can claim one from Slate."
                    : "If nobody has that role, it goes to the bookkeeper, then the account manager."}
              </span>
            </label>
            {d.assign_mode === "person" ? (
              <label className="tk-field">
                <span className="tk-field-label">Person</span>
                <select
                  className="tk-select"
                  value={d.assignee_email || ""}
                  aria-invalid={errs && errs.assignee_email ? "true" : undefined}
                  onChange={function (e) {
                    set({ assignee_email: e.target.value });
                  }}
                >
                  <option value="">Pick someone</option>
                  {(function () {
                    var people = (props.staff || []).filter(function (s) {
                      return s && s.email && s.active !== false;
                    });
                    var cur = String(d.assignee_email || "").toLowerCase();
                    if (cur && !people.some(function (s) { return String(s.email).toLowerCase() === cur; })) {
                      people = [{ email: cur, name: cur + " (not active)" }].concat(people);
                    }
                    return people
                      .slice()
                      .sort(function (a, b) {
                        var x = String(a.name || a.email).toLowerCase();
                        var y = String(b.name || b.email).toLowerCase();
                        return x < y ? -1 : x > y ? 1 : 0;
                      })
                      .map(function (s) {
                        var em = String(s.email).toLowerCase();
                        return (
                          <option key={em} value={em}>
                            {s.name || em}
                          </option>
                        );
                      });
                  })()}
                </select>
                {errs && errs.assignee_email ? <span className="tk-field-error">{errs.assignee_email}</span> : null}
              </label>
            ) : null}
            <label className="tk-field">
              <span className="tk-field-label">Priority</span>
              <select
                className="tk-select"
                value={d.priority}
                onChange={function (e) {
                  set({ priority: e.target.value });
                }}
              >
                {TK_TPL_PRIORITIES.map(function (p) {
                  return (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="tk-field">
              <span className="tk-field-label">Minutes it takes (optional)</span>
              <input
                className={"tk-input tk-tpl-num" + (errs && errs.estimate_minutes ? " is-invalid" : "")}
                type="number"
                min={1}
                max={10000}
                value={d.estimate_minutes}
                onChange={function (e) {
                  set({ estimate_minutes: e.target.value });
                }}
              />
              {errs && errs.estimate_minutes ? <span className="tk-field-error">{errs.estimate_minutes}</span> : null}
            </label>
            <label className="tk-field">
              <span className="tk-field-label">Client SOP section (optional)</span>
              <select
                className="tk-select"
                value={d.sop_section || ""}
                onChange={function (e) {
                  set({ sop_section: e.target.value });
                }}
              >
                <option value="">None</option>
                {TK_TPL_SOP.map(function (s) {
                  return (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <div className="tk-field tk-field-switch">
            <TK_vSwitch
              checked={!!d.review_required}
              label="An admin approves it before it counts as done"
              onChange={function (v) {
                set({ review_required: v });
              }}
            />
          </div>

          <fieldset className="tk-field tk-tpl-applies">
            <legend className="tk-field-label">Which clients</legend>
            <div className="tk-tpl-tiers">
              {TK_TPL_TIERS.map(function (tier) {
                var on = (d.plan_tiers || []).indexOf(tier) >= 0;
                return (
                  <label key={tier} className="tk-tpl-check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={function () {
                        var cur = (d.plan_tiers || []).slice();
                        if (on) cur = cur.filter(function (x) { return x !== tier; });
                        else cur.push(tier);
                        set({ plan_tiers: cur });
                      }}
                    />
                    {"Every " + TK_tplPlanLabel(tier) + " client"}
                  </label>
                );
              })}
            </div>
            {inSet ? (
              <p className="tk-field-help">Standard templates reach clients by plan. Skip one client from the client panel.</p>
            ) : (
              <div className="tk-tpl-clients">
                <input
                  className="tk-input"
                  type="search"
                  placeholder="Find a client"
                  aria-label="Find a client"
                  value={filter}
                  onChange={function (e) {
                    setFilter(e.target.value);
                  }}
                />
                <div className="tk-tpl-client-list" role="group" aria-label="Clients">
                  {shownClients.map(function (c) {
                    var on = picked.indexOf(c.id) >= 0;
                    return (
                      <label key={c.id} className="tk-tpl-check">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={function () {
                            var cur = picked.slice();
                            if (on) cur = cur.filter(function (x) { return x !== c.id; });
                            else cur.push(c.id);
                            set({ client_ids: cur });
                          }}
                        />
                        {c.name || c.id}
                        {c.test_only ? <span className="tk-muted"> (test)</span> : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="tk-field-help">
              {!(d.plan_tiers || []).length && !picked.length ? "Nothing ticked means every client." : picked.length ? picked.length + " client" + (picked.length === 1 ? "" : "s") + " picked." : ""}
            </p>
          </fieldset>

          <label className="tk-field">
            <span className="tk-field-label">Checklist (optional, one step per line)</span>
            <textarea
              className={"tk-input tk-textarea" + (errs && errs.checklist ? " is-invalid" : "")}
              rows={4}
              value={clText}
              onChange={function (e) {
                setClText(e.target.value);
              }}
            />
            {errs && errs.checklist ? <span className="tk-field-error">{errs.checklist}</span> : null}
          </label>

          <div className="tk-field tk-tpl-preview" aria-live="polite">
            <span className="tk-field-label">Next due dates</span>
            <TK_tplNextList tpl={tplForPreview} today={props.today} holidays={props.holidays} activatedOn={props.today} />
            {d.cadence === "annually" && d.period_basis === "fiscal" ? (
              <p className="tk-field-help">Shown for a December 31 year end. Each client uses its own.</p>
            ) : null}
          </div>

          {msg ? (
            <p className="tk-field-error" role="alert">
              {msg}
            </p>
          ) : null}
        </div>
        <div className="modal-footer tk-modal-footer">
          <button type="button" className="btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !props.online}>
            {busy ? "Saving…" : isNew ? "Save draft" : "Save"}
          </button>
        </div>
      </form>
    </TK_vModal>
  );
}

// ---- A server preview (dry run) in a modal -------------------------------------------------

function TK_tplPreviewModal(props) {
  var sPair = React.useState({ loading: true, data: null, error: null });
  var st = sPair[0];
  var setSt = sPair[1];
  React.useEffect(
    function () {
      var live = true;
      TK_api.generatePreview(props.clientId || null, props.days || 30, props.templateId || null).then(
        function (data) {
          if (live) setSt({ loading: false, data: data || {}, error: null });
        },
        function (err) {
          if (live) setSt({ loading: false, data: null, error: TK_tplErr(err) });
        },
      );
      return function () {
        live = false;
      };
    },
    [props.clientId, props.days, props.templateId],
  );
  var titleId = "tk-tpl-pv-title";
  return (
    <TK_vModal onClose={props.onClose} labelledBy={titleId} className="tk-modal tk-tpl-preview-modal">
      <div className="modal-header">
        <h3 className="card-title" id={titleId} style={{ margin: 0 }}>
          {props.title || "Preview"}
        </h3>
        <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        {props.note ? <p className="tk-form-note">{props.note}</p> : null}
        {st.loading ? (
          <TK_vSkeletonRows count={3} />
        ) : st.error ? (
          <p className="tk-field-error" role="alert">
            {st.error}
          </p>
        ) : (
          <TK_tplResultTables data={st.data} clientNames={props.clientNames} nameOf={props.nameOf} />
        )}
      </div>
      <div className="modal-footer tk-modal-footer">
        <button type="button" className="btn-secondary" onClick={props.onClose}>
          Close
        </button>
      </div>
    </TK_vModal>
  );
}

function TK_tplResultTables(props) {
  var r = props.data || {};
  var cn = props.clientNames || {};
  var nameOf = props.nameOf || function (e) { return e || ""; };
  var would = Array.isArray(r.would_create) ? r.would_create : [];
  var up = Array.isArray(r.upcoming) ? r.upcoming : [];
  var skipped = Array.isArray(r.skipped) ? r.skipped : [];
  var missed = Array.isArray(r.missed) ? r.missed : [];
  var warn = Array.isArray(r.warnings) ? r.warnings : [];
  var table = function (key, caption, rows, cols) {
    if (!rows.length) return null;
    return (
      <div className="tk-tpl-result" key={key}>
        <h4 className="tk-tpl-result-title">{caption + " (" + rows.length + ")"}</h4>
        <div className="tk-rq-table-wrap">
          <table className="tk-rq-table">
            <thead>
              <tr>
                {cols.map(function (c) {
                  return <th key={c.h}>{c.h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map(function (row, i) {
                return (
                  <tr key={i}>
                    {cols.map(function (c) {
                      return <td key={c.h}>{c.v(row)}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  var client = { h: "Client", v: function (x) { return cn[String(x.client)] || x.client; } };
  var task = { h: "Task", v: function (x) { return (x.title || "") + (x.label ? " · " + x.label : ""); } };
  var due = { h: "Due", v: function (x) { return TK_tplFmtDate(x.due); } };
  return (
    <div className="tk-tpl-results">
      <p className="tk-tpl-summary">{TK_tplRunSummary(r)}</p>
      {warn.map(function (w, i) {
        return (
          <div key={i} className="tk-banner" role="status">
            {String(w)}
          </div>
        );
      })}
      {table("would", "Made on the next run", would, [client, task, due, { h: "Goes to", v: function (x) { return nameOf(x.assignee); } }])}
      {table("up", "Coming up", up, [client, task, { h: "Shows up", v: function (x) { return TK_tplFmtDate(x.start_on); } }, due])}
      {table("skip", "Skipped", skipped, [client, task, { h: "Why", v: function (x) { return TK_tplSkipReasonText(x.reason); } }])}
      {table("miss", "Missed (listed, not made)", missed, [client, task, due])}
      {!would.length && !up.length && !skipped.length && !missed.length ? (
        <p className="tk-muted">Nothing to show. Only templates that are on make tasks.</p>
      ) : null}
    </div>
  );
}

// ---- Per-client override modal ----------------------------------------------------------------

function TK_tplOverrideModal(props) {
  var t = props.template;
  var o = props.override || {};
  var rPair = React.useState(function () {
    return o.due_rule || null;
  });
  var rule = rPair[0];
  var setRule = rPair[1];
  var tPair = React.useState(o.title || "");
  var title = tPair[0];
  var setTitle = tPair[1];
  var aPair = React.useState(o.assignee_role || "");
  var role = aPair[0];
  var setRole = aPair[1];
  var vPair = React.useState(o.review_required == null ? "" : o.review_required ? "yes" : "no");
  var review = vPair[0];
  var setReview = vPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var mPair = React.useState("");
  var msg = mPair[0];
  var setMsg = mPair[1];
  var titleId = "tk-tpl-ov-title";

  // an admin turned approval off for this client: only an admin changes that
  var reviewLocked = !props.isAdmin && o.review_required === false;
  // approval is on for this client: a non-admin can't pick anything weaker
  var reviewKeptOn = !props.isAdmin && o.review_required === true;

  var save = function (e) {
    e.preventDefault();
    var next = TK_tplOverridePayload({ title: title, rule: rule, role: role, review: review }, { isAdmin: props.isAdmin, stored: o });
    setBusy(true);
    setMsg("");
    TK_api.setClientOverride(props.clientId, t.id, !!props.skip, next).then(
      function () {
        setBusy(false);
        props.onSaved();
      },
      function (err) {
        setBusy(false);
        setMsg(TK_tplErr(err));
      },
    );
  };

  return (
    <TK_vModal onClose={props.onClose} labelledBy={titleId} className="tk-modal tk-tpl-editor">
      <form onSubmit={save} noValidate>
        <div className="modal-header">
          <h3 className="card-title" id={titleId} style={{ margin: 0 }}>
            {"Change for " + (props.clientName || "this client")}
          </h3>
          <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body tk-form">
          <p className="tk-form-note">{"Only " + (props.clientName || "this client") + "'s tasks from “" + t.title + "” change. Leave a field blank to use the template's."}</p>
          <label className="tk-field">
            <span className="tk-field-label">Title for this client</span>
            <input
              className="tk-input"
              type="text"
              maxLength={200}
              placeholder={t.title}
              value={title}
              onChange={function (e) {
                setTitle(e.target.value);
              }}
            />
          </label>
          <div className="tk-field tk-field-switch">
            <TK_vSwitch
              checked={!!rule}
              label="Use a different due date for this client"
              onChange={function (v) {
                setRule(v ? TK_tplEffectiveRule(t, null) : null);
              }}
            />
          </div>
          {rule ? (
            <TK_tplRuleBuilder
              id="tk-tpl-ov-rule"
              cadence={t.cadence}
              rule={rule}
              onChange={function (r) {
                setRule(r);
              }}
            />
          ) : (
            <p className="tk-field-help">{"Due: " + TK_dueRuleText(TK_tplEffectiveRule(t, null), t.cadence)}</p>
          )}
          <label className="tk-field">
            <span className="tk-field-label">Who does it</span>
            <select
              className="tk-select"
              value={role}
              onChange={function (e) {
                setRole(e.target.value);
              }}
            >
              <option value="">{"Same as the template (" + TK_tplLabelOf(TK_TPL_ROLES, t.assignee_role).toLowerCase() + ")"}</option>
              {TK_TPL_ROLES.map(function (r) {
                return (
                  <option key={r.value} value={r.value}>
                    {"The client's " + r.label.toLowerCase()}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="tk-field">
            <span className="tk-field-label">Admin approval</span>
            <select
              className="tk-select"
              value={review}
              disabled={reviewLocked}
              onChange={function (e) {
                setReview(e.target.value);
              }}
            >
              <option value="" disabled={reviewKeptOn && !t.review_required}>
                {"Same as the template (" + (t.review_required ? "needs approval" : "no approval") + ")"}
              </option>
              <option value="yes">Needs an admin to approve</option>
              {props.isAdmin || reviewLocked ? <option value="no">No approval for this client</option> : null}
            </select>
            {reviewLocked ? (
              <span className="tk-field-help">An admin turned approval off for this client. Only an admin can change that; your other changes still save.</span>
            ) : reviewKeptOn ? (
              <span className="tk-field-help">Approval is on for this client. Only an admin can turn it off; your other changes still save.</span>
            ) : !props.isAdmin ? (
              <span className="tk-field-help">Only an admin can turn approval off.</span>
            ) : null}
          </label>
          {rule ? (
            <div className="tk-field tk-tpl-preview" aria-live="polite">
              <span className="tk-field-label">Next due dates for this client</span>
              <TK_tplNextList tpl={t} override={{ due_rule: rule }} today={props.today} holidays={props.holidays} fye={props.fye} />
            </div>
          ) : null}
          {msg ? (
            <p className="tk-field-error" role="alert">
              {msg}
            </p>
          ) : null}
        </div>
        <div className="modal-footer tk-modal-footer">
          <button type="button" className="btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !props.online}>
            {busy ? "Saving…" : "Save for this client"}
          </button>
        </div>
      </form>
    </TK_vModal>
  );
}

// ---- Per-client panel -------------------------------------------------------------------

// P4-2: the per-client "Create month-end tasks from the Close checklist"
// switch (tk_client_close_optin). Admin or that client's account manager can
// change it; everyone else sees it read-only. Turning it on makes bank feed,
// bank rec, card rec, entries and review tasks each month (from next month,
// or this one with "Also this month") even while the standard set is off for
// everyone else. Warns when the client already has recurring templates that
// look like month-end work.
function TK_tplCloseOptin(props) {
  var status = props.status;
  var aPair = React.useState(false);
  var alsoThis = aPair[0];
  var setAlsoThis = aPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  if (!status) return null;
  var on = !!status.enabled;
  var canEdit = !!status.can_edit;
  var overlaps = Array.isArray(status.overlaps) ? status.overlaps : [];
  var change = function (v) {
    if (busy || !canEdit) return;
    setBusy(true);
    TK_api.setCloseOptin(props.clientId, v, v && alsoThis).then(
      function (next) {
        setBusy(false);
        setAlsoThis(false);
        try {
          if (typeof MGB_track === "function") MGB_track("tasks-close-optin", { on: !!v });
        } catch (e) {}
        var n = next && Array.isArray(next.overlaps) ? next.overlaps.length : 0;
        TK_vToast(
          v
            ? "Month-end tasks on for " + (props.clientName || "this client") + "." + (n ? " " + TK_closeOverlapText(n) : "")
            : "Month-end tasks off for " + (props.clientName || "this client") + ". Tasks already made stay.",
        );
        props.onChanged(next || null);
      },
      function (err) {
        setBusy(false);
        TK_vToast(TK_tplErr(err));
      },
    );
  };
  return (
    <div className="tk-tpl-close-optin" data-tour="tk-close-optin">
      <TK_vSwitch
        checked={on}
        disabled={!canEdit || !props.online || busy}
        label="Create month-end tasks from the Close checklist"
        onChange={change}
      />
      {!on && canEdit ? (
        <label className="tk-tpl-close-also">
          <input
            type="checkbox"
            checked={alsoThis}
            disabled={!props.online || busy}
            onChange={function (e) {
              setAlsoThis(!!e.target.checked);
            }}
          />{" "}
          Also this month
        </label>
      ) : null}
      <p className="tk-muted tk-tpl-close-note">
        {on
          ? TK_closeOptinStartsText(status) || "On."
          : "Off. When on, bank feed, bank rec, card rec, entries and review become tasks each month, and ticking a step on the Close tab moves its task."}
        {!canEdit ? " Only an admin or this client's account manager can change this." : ""}
      </p>
      {on && overlaps.length ? (
        <div className="tk-tpl-close-warn" role="note">
          <p>
            {TK_closeOverlapText(overlaps.length)}{" "}
            <a
              href="#tk-tpl-client-rows"
              className="link-btn"
              onClick={function (e) {
                var el = document.getElementById("tk-tpl-client-rows");
                if (!el) return;
                e.preventDefault();
                el.scrollIntoView({ block: "start", behavior: "smooth" });
              }}
            >
              See this client's templates
            </a>
          </p>
          <ul>
            {overlaps.slice(0, 8).map(function (o) {
              return <li key={o.id}>{o.title}</li>;
            })}
            {overlaps.length > 8 ? <li>{"and " + (overlaps.length - 8) + " more"}</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TK_tplClientPanel(props) {
  var clients = Array.isArray(props.clients) ? props.clients : [];
  var cPair = React.useState("");
  var clientId = cPair[0];
  var setClientId = cPair[1];
  var oPair = React.useState({ loading: false, rows: [], fye: null, error: null });
  var st = oPair[0];
  var setSt = oPair[1];
  var ePair = React.useState(null);
  var editing = ePair[0];
  var setEditing = ePair[1];
  var pPair = React.useState(false);
  var preview = pPair[0];
  var setPreview = pPair[1];
  var kPair = React.useState(0);
  var tick = kPair[0];
  var setTick = kPair[1];
  // P4-2: { forId, status } from tk_close_optin_status (null before the SQL runs)
  var coPair = React.useState({ forId: null, status: null });
  var optin = coPair[0].forId === clientId ? coPair[0].status : null;
  var setOptin = coPair[1];

  React.useEffect(
    function () {
      if (!clientId || typeof TK_api.closeOptinStatus !== "function") return undefined;
      var live = true;
      TK_api.closeOptinStatus(clientId).then(
        function (res) {
          if (live) setOptin({ forId: clientId, status: res || null });
        },
        function () {
          if (live) setOptin({ forId: clientId, status: null });
        },
      );
      return function () {
        live = false;
      };
    },
    [clientId, tick],
  );

  React.useEffect(
    function () {
      if (!clientId) return undefined;
      var live = true;
      setSt({ loading: true, rows: [], fye: null, error: null });
      Promise.all([TK_api.listOverrides(clientId), TK_api.clientFiscalYearEnd(clientId).catch(function () { return null; })]).then(
        function (res) {
          if (live) setSt({ loading: false, rows: res[0] || [], fye: res[1] || null, error: null });
        },
        function (err) {
          if (live) setSt({ loading: false, rows: [], fye: null, error: TK_tplErr(err) });
        },
      );
      return function () {
        live = false;
      };
    },
    [clientId, tick],
  );

  var client = null;
  for (var i = 0; i < clients.length; i++) if (clients[i] && clients[i].id === clientId) client = clients[i];
  // tk__generate's "named test client": test-only or the internal company
  var testClient = !!(client && (client.test_only || client.testOnly || client.is_internal || client.isInternal));
  var setById = {};
  (props.sets || []).forEach(function (s) {
    if (s && s.id) setById[s.id] = s;
  });
  var byTpl = {};
  st.rows.forEach(function (r) {
    byTpl[r.template_id] = r;
  });
  var tpls = client
    ? (props.templates || []).filter(function (t) {
        return TK_tplStatus(t) !== "retired" && TK_tplAppliesTo(t, client);
      })
    : [];

  var setSkip = function (t, skip) {
    var cur = byTpl[t.id];
    var ov = {};
    var stored = cur ? cur.override || {} : {};
    for (var k in stored) {
      // an admin's "no approval" is admin-only; a non-admin's save leaves it as it is on the server
      if (k !== "review_required" || props.isAdmin || stored[k] !== false) ov[k] = stored[k];
    }
    TK_api.setClientOverride(clientId, t.id, skip, ov).then(
      function () {
        TK_vToast(skip ? "Skipped for " + (client.name || "this client") + "." : "Back on for " + (client.name || "this client") + ".");
        setTick(tick + 1);
      },
      function (err) {
        TK_vToast(TK_tplErr(err));
      },
    );
  };

  return (
    <section className="tk-tpl-card tk-tpl-client" aria-labelledby="tk-tpl-client-title" data-tour="tk-recurring-client">
      <h3 className="tk-group-head" id="tk-tpl-client-title">
        <span className="tk-group-name">One client</span>
      </h3>
      <div className="tk-tpl-client-head">
        <select
          className="tk-select"
          aria-label="Pick a client"
          value={clientId}
          onChange={function (e) {
            setClientId(e.target.value);
          }}
        >
          <option value="">Pick a client…</option>
          {clients
            .filter(function (c) {
              return c && c.id;
            })
            .map(function (c) {
              return (
                <option key={c.id} value={c.id}>
                  {(c.name || c.id) + (c.test_only ? " (test)" : "")}
                </option>
              );
            })}
        </select>
        {clientId ? (
          <button
            type="button"
            className="tk-tool-btn"
            onClick={function () {
              setPreview(true);
            }}
          >
            Preview 60 days
          </button>
        ) : null}
        {clientId && props.isAdmin ? (
          <button
            type="button"
            className="tk-tool-btn"
            disabled={!props.online}
            onClick={function () {
              props.onGenerateClient(client);
            }}
          >
            Make due tasks now
          </button>
        ) : null}
      </div>
      {clientId && optin ? (
        <TK_tplCloseOptin
          status={optin}
          clientId={clientId}
          clientName={client ? client.name : ""}
          online={props.online}
          onChanged={function (next) {
            if (next) setOptin({ forId: clientId, status: next });
            setTick(tick + 1);
          }}
        />
      ) : null}
      {!clientId ? (
        <p className="tk-muted">Pick a client to see which templates reach them, when the next ones are due, and to skip or change one just for them.</p>
      ) : st.loading ? (
        <TK_vSkeletonRows count={2} />
      ) : st.error ? (
        <p className="tk-field-error" role="alert">
          {st.error}
        </p>
      ) : !tpls.length ? (
        <p className="tk-muted">No templates reach this client.</p>
      ) : (
        <ul className="tk-tpl-rows" id="tk-tpl-client-rows">
          {tpls.map(function (t) {
            var ov = byTpl[t.id];
            var skip = !!(ov && ov.skip);
            var override = ov ? ov.override || {} : {};
            var changed = Object.keys(override).length > 0;
            var next = TK_tplUpcoming(t, {
              today: props.today,
              holidays: props.holidays,
              count: 1,
              override: override,
              fye: st.fye || "12-31",
              // Central date; a standard-set member reaches a real client from when the set went live
              activatedOn: t.activated_at ? TK_tplActivatedOn(t, { set: setById[t.template_set_id], testClient: testClient }) || props.today : props.today,
              // P4-2: an opted-in client gets set members from its first close month on
              periodFloor:
                t.template_set_id && optin && optin.enabled && !optin.set_live && !testClient && optin.starts ? String(optin.starts).slice(0, 10) : null,
            });
            return (
              <li key={t.id} className={"tk-tpl-row" + (skip ? " is-skipped" : "")}>
                <div className="tk-tpl-main">
                  <div className="tk-tpl-title-line">
                    <span className="tk-tpl-title">{override.title || t.title}</span>
                    <span className={"tk-tpl-status is-" + TK_tplStatus(t)}>{TK_TPL_STATUS_LABELS[TK_tplStatus(t)]}</span>
                    {changed ? <span className="tk-tpl-status is-changed">Changed for this client</span> : null}
                  </div>
                  <div className="tk-tpl-meta tk-muted">
                    {TK_tplLabelOf(TK_TPL_CADENCES, t.cadence) + " · " + TK_dueRuleText(TK_tplEffectiveRule(t, override), t.cadence)}
                  </div>
                  <div className="tk-tpl-meta">
                    {skip
                      ? "Skipped for this client."
                      : next && next.length
                        ? "Next: " + next[0].label + ", due " + TK_tplFmtDate(next[0].due)
                        : ""}
                  </div>
                </div>
                <div className="tk-tpl-actions">
                  <TK_vSwitch
                    checked={!skip}
                    disabled={!props.online}
                    label={skip ? "Skipped" : "On for this client"}
                    onChange={function (v) {
                      setSkip(t, !v);
                    }}
                  />
                  <button
                    type="button"
                    className="tk-tool-btn"
                    disabled={!props.online}
                    onClick={function () {
                      setEditing({ template: t, override: override, skip: skip });
                    }}
                  >
                    Change
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing ? (
        <TK_tplOverrideModal
          template={editing.template}
          override={editing.override}
          skip={editing.skip}
          clientId={clientId}
          clientName={client ? client.name : ""}
          isAdmin={props.isAdmin}
          online={props.online}
          today={props.today}
          holidays={props.holidays}
          fye={st.fye || "12-31"}
          onClose={function () {
            setEditing(null);
          }}
          onSaved={function () {
            setEditing(null);
            TK_vToast("Saved for " + (client ? client.name : "this client") + ".");
            setTick(tick + 1);
          }}
        />
      ) : null}
      {preview ? (
        <TK_tplPreviewModal
          clientId={clientId}
          days={60}
          title={"Next 60 days for " + (client ? client.name : "this client")}
          note="Only templates that are on. Nothing is created by this preview."
          clientNames={props.clientNames}
          nameOf={props.nameOf}
          onClose={function () {
            setPreview(false);
          }}
        />
      ) : null}
    </section>
  );
}

// ---- The page ------------------------------------------------------------------------------

function TK_Templates(props) {
  var schema = TK_vUseSchema();
  if (schema === "missing") return <TK_SetupCard />;
  if (schema !== "ok") {
    return (
      <div className="tk-view tk-templates">
        <h2 className="tk-view-title">Recurring</h2>
        <TK_vSkeletonRows count={4} />
      </div>
    );
  }
  return <TK_vTemplatesBody {...props} />;
}

function TK_vTemplatesBody(props) {
  var staffUser = props.staffUser || {};
  // The template RPCs need a full admin (is_active_staff_admin); temporary
  // admins get the read-only page, like other staff.
  var isAdmin = !!props.isAdmin && staffUser.role === "admin";
  var isTempAdmin = !!props.isAdmin && !isAdmin;
  var isOwner = isAdmin && !!staffUser.isInternalOwner;
  var me = TK_vLower(staffUser.email);
  var today = TK_vToday();
  var online = TK_vUseOnline();
  var staff = TK_vUseStaff(true);

  var dPair = React.useState({ loading: true, error: null, templates: [], sets: [], counts: {}, settings: {}, holidays: [] });
  var data = dPair[0];
  var setData = dPair[1];
  var kPair = React.useState(0);
  var tick = kPair[0];
  var setTick = kPair[1];
  var reload = function () {
    setTick(function (n) {
      return n + 1;
    });
  };

  var ePair = React.useState(null);
  var editing = ePair[0];
  var setEditing = ePair[1];
  var cPair = React.useState(null);
  var confirm = cPair[0];
  var setConfirm = cPair[1];
  var pPair = React.useState(null);
  var preview = pPair[0];
  var setPreview = pPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];

  var aPair = React.useState({ missed: [], suggestions: [], runs: [] });
  var adminData = aPair[0];
  var setAdminData = aPair[1];

  React.useEffect(
    function () {
      var live = true;
      Promise.all([
        TK_api.listTemplates(),
        TK_api.listTemplateSets().catch(function () { return []; }),
        TK_api.templateIssuedCounts().catch(function () { return {}; }),
        TK_api.getSettings().catch(function () { return {}; }),
        TK_api.holidays().catch(function () { return []; }),
      ]).then(
        function (res) {
          if (!live) return;
          setData({ loading: false, error: null, templates: res[0], sets: res[1], counts: res[2], settings: res[3], holidays: res[4] });
        },
        function (err) {
          if (!live) return;
          setData(function (d) {
            return { loading: false, error: err, templates: d.templates, sets: d.sets, counts: d.counts, settings: d.settings, holidays: d.holidays };
          });
        },
      );
      if (isAdmin) {
        Promise.all([
          TK_api.listMissed().catch(function () { return []; }),
          TK_api.listSuggestions().catch(function () { return []; }),
          TK_api.listRuns(10).catch(function () { return []; }),
        ]).then(function (res) {
          if (live) setAdminData({ missed: res[0], suggestions: res[1], runs: res[2] });
        });
      }
      return function () {
        live = false;
      };
    },
    [tick, isAdmin],
  );

  // "Save as template" from a task: TaskTemplates.jsx parks a draft and fires
  // TT_DRAFT_EVENT; open the editor with it (admins only).
  React.useEffect(
    function () {
      if (!isAdmin) return undefined;
      var take = function () {
        var d = typeof TT_takePendingDraft === "function" ? TT_takePendingDraft() : null;
        if (d) setEditing(TK_tplFromLegacyDraft(d));
      };
      take();
      var ev = typeof TT_DRAFT_EVENT === "string" ? TT_DRAFT_EVENT : "mgb:tt-open-draft";
      window.addEventListener(ev, take);
      return function () {
        window.removeEventListener(ev, take);
      };
    },
    [isAdmin],
  );

  var clientNames = React.useMemo(
    function () {
      return TK_vNameMap(props.clients, "id", "name");
    },
    [props.clients],
  );
  var staffNames = React.useMemo(
    function () {
      var m = {};
      (Array.isArray(staff) ? staff : []).forEach(function (s) {
        if (s && s.email) m[String(s.email).toLowerCase()] = s.name || s.email;
      });
      return m;
    },
    [staff],
  );
  var nameOf = function (email) {
    var k = String(email || "").toLowerCase();
    if (!k) return "";
    if (k === me) return "You";
    return staffNames[k] || k.split("@")[0];
  };

  // read the way the generator reads it (tk__jsonb_bool): anything not a yes/no counts as off
  var setLive = !!data.settings && TK_tplBool(data.settings.standard_set_live) === true;
  var setById = {};
  (data.sets || []).forEach(function (s) {
    if (s && s.id) setById[s.id] = s;
  });
  var groups = TK_tplGroups(data.templates, data.sets);
  var tplById = {};
  data.templates.forEach(function (t) {
    tplById[t.id] = t;
  });

  var doStatus = function (t, action) {
    setBusy(true);
    TK_api.setTemplateStatus(t.id, action).then(
      function () {
        setBusy(false);
        var words = { activate: "Turned on", pause: "Paused", resume: "Resumed", retire: "Retired", draft: "Moved back to draft" };
        TK_vToast((words[action] || "Saved") + ": " + t.title + ".");
        reload();
      },
      function (err) {
        setBusy(false);
        TK_vToast(TK_tplErr(err));
      },
    );
  };

  var askStatus = function (t, action, askOpts) {
    var opts = askOpts || {};
    if (action === "pause" || action === "draft") {
      doStatus(t, action);
      return;
    }
    // P4-2: turning on something that looks like month-end work for a client
    // that already gets month-end tasks from the Close checklist: warn first.
    if ((action === "activate" || action === "resume") && TK_closeOverlaps(t) && !opts.optinChecked && typeof TK_api.closeOptinClients === "function") {
      TK_api.closeOptinClients().then(
        function (ids) {
          var want = {};
          (ids || []).forEach(function (id) {
            want[String(id)] = true;
          });
          var names = (Array.isArray(props.clients) ? props.clients : [])
            .filter(function (c) {
              return c && want[String(c.id)] && TK_tplAppliesTo(t, c);
            })
            .map(function (c) {
              return c.name || c.id;
            });
          askStatus(t, action, { optinChecked: true, closeWarn: TK_closeActivateWarning(t, names) });
        },
        function () {
          askStatus(t, action, { optinChecked: true });
        },
      );
      return;
    }
    var inSet = !!t.template_set_id;
    var body;
    var title;
    var label;
    if (action === "activate" || action === "resume") {
      title = (action === "activate" ? "Turn on " : "Resume ") + "“" + t.title + "”?";
      label = action === "activate" ? "Turn on" : "Resume";
      body =
        "The daily run makes tasks for matching clients from now on, each one showing up " +
        (Number(t.lead_days) || 0) +
        " days before it's due. Periods due more than 7 days ago aren't made; they're listed under Missed periods for you to decide." +
        (inSet && !setLive ? " This is a standard template: it only reaches real clients once the owner turns the standard set on. Test clients can try it now." : "") +
        " Nothing is emailed to clients." +
        (opts.closeWarn ? " " + opts.closeWarn : "");
    } else {
      title = "Retire “" + t.title + "”?";
      label = "Retire";
      body = "It stops making tasks. Tasks it already made stay as they are. You can move it back to draft later.";
    }
    setConfirm({
      title: title,
      body: body,
      confirmLabel: label,
      run: function () {
        doStatus(t, action);
      },
    });
  };

  var runNow = function (client) {
    setConfirm({
      title: client ? "Make due tasks for " + (client.name || "this client") + "?" : "Make due tasks now?",
      body:
        (client ? "Runs the daily job for " + (client.name || "this client") + " only" : "Runs the daily job now") +
        ": every template that's on makes the tasks that are due to show up by today. Anything already made is left alone. It runs by itself every morning, so you only need this after a change.",
      confirmLabel: "Make tasks",
      run: function () {
        setBusy(true);
        TK_api.generateNow(client ? client.id : null).then(
          function (res) {
            setBusy(false);
            TK_vToast(TK_tplRunSummary(res));
            reload();
          },
          function (err) {
            setBusy(false);
            TK_vToast(TK_tplErr(err));
          },
        );
      },
    });
  };

  var flipSetLive = function (v) {
    setConfirm({
      title: v ? "Turn on the standard set for real clients?" : "Turn off the standard set?",
      body: v
        ? "Standard templates that are on will start making tasks for every matching real client on the next daily run. Templates still in draft stay off."
        : "Standard templates stop making tasks for real clients. Test clients still get them.",
      confirmLabel: v ? "Turn on" : "Turn off",
      run: function () {
        TK_api.setSetting("standard_set_live", v).then(
          function () {
            TK_vToast(v ? "Standard set is on." : "Standard set is off.");
            reload();
          },
          function (err) {
            TK_vToast(TK_tplErr(err));
          },
        );
      },
    });
  };

  var onSaved = function (id, draft) {
    setEditing(null);
    TK_vToast(draft.id ? "Template saved." : "Saved as a draft. Turn it on when it's ready.");
    if (draft._suggestionId && id) {
      TK_api.resolveSuggestion(draft._suggestionId, { status: "created", template_id: id }).catch(function () {});
    }
    reload();
  };

  // Make task answers created / exists / skipped (review fix, major 4): a
  // skipped period stays listed with the reason on its row.
  var mnPair = React.useState({});
  var missedNote = mnPair[0];
  var setMissedNote = mnPair[1];
  var missedKey = function (m) {
    return m.template_id + "|" + m.client_id + "|" + m.period_start;
  };
  var missedAct = function (m, issue) {
    var key = missedKey(m);
    var p = issue ? TK_api.issueMissed(m.template_id, m.client_id, m.period_start) : TK_api.dismissMissed(m.template_id, m.client_id, m.period_start);
    p.then(
      function (res) {
        var out = issue ? TK_tplIssueOutcome(res) : { closed: true, text: "Dismissed." };
        TK_vToast(out.text);
        setMissedNote(function (cur) {
          var next = {};
          for (var k in cur) if (k !== key) next[k] = cur[k];
          if (!out.closed) next[key] = out.text;
          return next;
        });
        if (out.closed) reload();
      },
      function (err) {
        TK_vToast(TK_tplErr(err));
      },
    );
  };

  var err = data.error && !data.templates.length ? data.error : null;
  if (err && err.code === "tk_schema_missing") return <TK_SetupCard />;

  var renderRow = function (t) {
    var status = TK_tplStatus(t);
    var next =
      status === "retired"
        ? null
        : TK_tplUpcoming(t, {
            today: today,
            holidays: data.holidays,
            count: 1,
            fye: "12-31",
            // Central date, and for a standard-set member the later of that and when the set went live
            activatedOn: status === "active" && t.activated_at ? TK_tplActivatedOn(t, { set: setById[t.template_set_id] }) || today : today,
          });
    // the list has no client, so a fiscal-year template is shown for a Dec 31 year end
    var fyNote = t.cadence === "annually" && t.period_basis === "fiscal" ? " (for a Dec 31 year end)" : "";
    var tiers = t.plan_tiers || [];
    var ids = t.client_ids || [];
    var applies = !tiers.length && !ids.length ? "All clients" : "";
    if (tiers.length) applies = tiers.map(TK_tplPlanLabel).join(" and ") + " clients";
    if (ids.length) {
      var names = ids.slice(0, 2).map(function (id) {
        return clientNames[String(id)] || id;
      });
      applies = (applies ? applies + ", plus " : "") + names.join(", ") + (ids.length > 2 ? " +" + (ids.length - 2) : "");
    }
    var count = data.counts[t.id] || 0;
    return (
      <li key={t.id} className={"tk-tpl-row is-" + status}>
        <div className="tk-tpl-main">
          <div className="tk-tpl-title-line">
            {isAdmin ? (
              <button
                type="button"
                className="tk-tpl-title tk-tpl-title-btn"
                onClick={function () {
                  setEditing(TK_tplFromRow(t));
                }}
              >
                {t.title}
              </button>
            ) : (
              <span className="tk-tpl-title">{t.title}</span>
            )}
            <span className={"tk-tpl-status is-" + status}>{TK_TPL_STATUS_LABELS[status]}</span>
            {t.review_required ? <span className="tk-tpl-status is-review">Needs approval</span> : null}
            {t.source === "asana" ? (
              <span className="tk-tpl-tag-asana" title="Made from an Asana recurring task by the import. Check it, then turn it on.">
                From Asana
              </span>
            ) : null}
          </div>
          <div className="tk-tpl-meta tk-muted">
            {TK_tplLabelOf(TK_TPL_CADENCES, t.cadence) +
              " · " +
              TK_dueRuleText(TK_tplEffectiveRule(t, null), t.cadence) +
              " · " +
              applies +
              " · " +
              (typeof TK_tplAssignText === "function" ? TK_tplAssignText(t, nameOf) : TK_tplLabelOf(TK_TPL_ROLES, t.assignee_role || "bookkeeper"))}
          </div>
          <div className="tk-tpl-meta">
            {next && next.length ? (status === "active" ? "Next: " : "If turned on today, next: ") + next[0].label + ", due " + TK_tplFmtDate(next[0].due) + fyNote : ""}
            {count ? <span className="tk-muted">{(next && next.length ? " · " : "") + "Made " + count + " so far"}</span> : null}
          </div>
        </div>
        {isAdmin ? (
          <div className="tk-tpl-actions">
            {TK_tplActions(t).map(function (a) {
              return (
                <button
                  key={a.action}
                  type="button"
                  className={"tk-tool-btn" + (a.action === "activate" || a.action === "resume" ? " is-primary" : "")}
                  disabled={busy || !online}
                  onClick={function () {
                    askStatus(t, a.action);
                  }}
                >
                  {a.label}
                </button>
              );
            })}
            {status !== "retired" ? (
              <button
                type="button"
                className="tk-tool-btn"
                onClick={function () {
                  setPreview({ templateId: t.id, days: 60, title: "“" + t.title + "” for every client", note: "As if it were on today. Nothing is created by this preview." });
                }}
              >
                Preview
              </button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  var body;
  if (data.loading && !data.templates.length) body = <TK_vSkeletonRows count={4} />;
  else if (err) body = <TK_vErrorState onRetry={reload} text={TK_tplErr(err)} />;
  else {
    body = (
      <div className="tk-groups" data-tour="tk-recurring-list">
        {groups.map(function (g) {
          if (!g.templates.length && g.set) return null;
          var gid = "tk-tpl-g-" + g.key.replace(/[^a-z0-9]/gi, "");
          return (
            <section key={g.key} className="tk-group tk-tpl-group" aria-labelledby={gid}>
              <h3 className="tk-group-head" id={gid}>
                <span className="tk-group-name">{g.label}</span>
                <span className="tk-count">{g.templates.length}</span>
              </h3>
              {g.set && g.set.is_standard ? (
                <div className="tk-tpl-set-note" data-tour="tk-recurring-standard">
                  {isOwner ? (
                    <TK_vSwitch checked={!!setLive} disabled={!online} label="Live for real clients (owner only)" onChange={flipSetLive} />
                  ) : (
                    <span className={"tk-tpl-status is-" + (setLive ? "active" : "draft")}>{setLive ? "Live for real clients" : "Test clients only"}</span>
                  )}
                  <span className="tk-muted">
                    {setLive
                      ? " The owner turned the standard set on. Templates that are on reach every matching client."
                      : " Until the owner turns the set on, these only reach test clients and clients with month-end tasks turned on (One client below), even when turned on."}
                  </span>
                </div>
              ) : null}
              {g.templates.length ? (
                <ul className="tk-tpl-rows">{g.templates.map(renderRow)}</ul>
              ) : (
                <div className="tk-empty">
                  <p>{isAdmin ? "No templates yet. New template makes one; it starts as a draft." : "No templates yet."}</p>
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  var openMissed = adminData.missed || [];
  var suggestions = adminData.suggestions || [];
  var runs = adminData.runs || [];

  return (
    <div className="tk-view tk-templates">
      <div className="tk-view-head">
        <h2 className="tk-view-title">Recurring</h2>
        {isAdmin ? (
          <div className="tk-toolbar" data-tour="tk-recurring-actions">
            <button
              type="button"
              className="btn-primary tk-add-btn"
              disabled={!online}
              onClick={function () {
                setEditing(TK_tplBlank());
              }}
            >
              <TK_vIcon name="plus" size={16} />
              New template
            </button>
            <button
              type="button"
              className="tk-tool-btn"
              onClick={function () {
                setPreview({ days: 30, title: "Next 30 days, every client", note: "Only templates that are on. Nothing is created by this preview." });
              }}
            >
              Preview 30 days
            </button>
            <button
              type="button"
              className="tk-tool-btn"
              disabled={busy || !online}
              onClick={function () {
                runNow(null);
              }}
            >
              Make due tasks now
            </button>
          </div>
        ) : null}
        <p className="tk-muted tk-view-sub">
          {isAdmin
            ? "Work that repeats. Each template makes one task per client per period, on the client's bookkeeper's list, a set number of days before it's due. It runs every morning."
            : (isTempAdmin ? "Temporary admins can see templates but not change them. " : "") +
              "Work that repeats for your clients. Only admins change templates; you can see what's coming for a client and skip or change one for them below."}
        </p>
      </div>
      {!online ? <TK_vOfflineBanner /> : null}

      {isAdmin && suggestions.length ? (
        <section className="tk-tpl-card" aria-labelledby="tk-tpl-sugg-title">
          <h3 className="tk-group-head" id="tk-tpl-sugg-title">
            <span className="tk-group-name">Suggested by staff</span>
            <span className="tk-count">{suggestions.length}</span>
          </h3>
          <ul className="tk-tpl-rows">
            {suggestions.map(function (s) {
              return (
                <li key={s.id} className="tk-tpl-row">
                  <div className="tk-tpl-main">
                    <span className="tk-tpl-title">{s.title}</span>
                    <div className="tk-tpl-meta tk-muted">
                      {(s.client_id ? (clientNames[String(s.client_id)] || s.client_id) + " · " : "") + "from " + nameOf(s.suggested_by) + " · " + TK_tplFmtTime(s.created_at)}
                    </div>
                  </div>
                  <div className="tk-tpl-actions">
                    <button
                      type="button"
                      className="tk-tool-btn is-primary"
                      disabled={!online}
                      onClick={function () {
                        setEditing(TK_tplFromLegacyDraft({ title: s.title, priority: s.priority, client_ids: s.client_id ? [s.client_id] : [], _suggestionId: s.id }));
                      }}
                    >
                      Make template
                    </button>
                    <button
                      type="button"
                      className="tk-tool-btn"
                      disabled={!online}
                      onClick={function () {
                        TK_api.resolveSuggestion(s.id, { status: "dismissed" }).then(reload, function (e) {
                          TK_vToast(TK_tplErr(e));
                        });
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {isAdmin && openMissed.length ? (
        <section className="tk-tpl-card tk-tpl-missed" aria-labelledby="tk-tpl-missed-title" data-tour="tk-recurring-missed">
          <h3 className="tk-group-head" id="tk-tpl-missed-title">
            <span className="tk-group-name">Missed periods</span>
            <span className="tk-count">{openMissed.length}</span>
          </h3>
          <p className="tk-muted tk-tpl-card-sub">Due more than 7 days ago, so they weren't made on their own. Make the task if the work still needs doing, or dismiss it.</p>
          <ul className="tk-tpl-rows">
            {openMissed.slice(0, 100).map(function (m) {
              var t = tplById[m.template_id];
              return (
                <li key={m.template_id + m.client_id + m.period_start} className="tk-tpl-row">
                  <div className="tk-tpl-main">
                    <span className="tk-tpl-title">{(t ? t.title : "Template") + " · " + (m.label || m.period_start)}</span>
                    <div className="tk-tpl-meta tk-muted">{(clientNames[String(m.client_id)] || m.client_id) + " · was due " + TK_tplFmtDate(m.due_date)}</div>
                    {missedNote[missedKey(m)] ? (
                      <div className="tk-tpl-meta tk-field-error" role="status">
                        {missedNote[missedKey(m)]}
                      </div>
                    ) : null}
                  </div>
                  <div className="tk-tpl-actions">
                    <button
                      type="button"
                      className="tk-tool-btn is-primary"
                      disabled={!online}
                      onClick={function () {
                        missedAct(m, true);
                      }}
                    >
                      Make task
                    </button>
                    <button
                      type="button"
                      className="tk-tool-btn"
                      disabled={!online}
                      onClick={function () {
                        missedAct(m, false);
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {body}

      <TK_tplClientPanel
        clients={props.clients}
        templates={data.templates}
        sets={data.sets}
        isAdmin={isAdmin}
        online={online}
        today={today}
        holidays={data.holidays}
        clientNames={clientNames}
        nameOf={nameOf}
        onGenerateClient={runNow}
      />

      {isAdmin && runs.length ? (
        <section className="tk-tpl-card" aria-labelledby="tk-tpl-runs-title">
          <h3 className="tk-group-head" id="tk-tpl-runs-title">
            <span className="tk-group-name">Recent runs</span>
          </h3>
          <div className="tk-rq-table-wrap">
            <table className="tk-rq-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>How</th>
                  <th>Made</th>
                  <th>Skipped</th>
                  <th>Missed</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(function (r) {
                  return (
                    <tr key={r.id}>
                      <th scope="row">{TK_tplFmtTime(r.ran_at)}</th>
                      <td>{r.trigger === "cron" ? "Daily run" : r.ran_by ? nameOf(r.ran_by) : "By hand"}</td>
                      <td>{Number(r.created) || 0}</td>
                      <td>{TK_tplLen(r.skipped)}</td>
                      <td>{TK_tplLen(r.missed)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {editing ? (
        <TK_tplEditor
          draft={editing}
          issuedCount={editing.id ? data.counts[editing.id] || 0 : 0}
          clients={props.clients}
          today={today}
          holidays={data.holidays}
          online={online}
          staff={staff}
          onClose={function () {
            setEditing(null);
          }}
          onSaved={onSaved}
        />
      ) : null}
      {preview ? (
        <TK_tplPreviewModal
          clientId={null}
          templateId={preview.templateId || null}
          days={preview.days}
          title={preview.title}
          note={preview.note}
          clientNames={clientNames}
          nameOf={nameOf}
          onClose={function () {
            setPreview(null);
          }}
        />
      ) : null}
      {confirm ? (
        <TK_vConfirm
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          onCancel={function () {
            setConfirm(null);
          }}
          onConfirm={function () {
            var c = confirm;
            setConfirm(null);
            c.run();
          }}
        />
      ) : null}
    </div>
  );
}
