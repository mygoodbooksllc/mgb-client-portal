// ----------------------------------------------------------------------------
// Pro Budget workspace — Budget vs. Actual for Pro clients.
//
// Replaces BudgetingToolPage for a Pro client's Budget tab. Everything that
// page showed is still here (Budget vs. Actual table, spending trend, the
// collaborative next-year draft with add/remove categories and a PDF), plus:
// year-end forecast, what-if scenarios, board approval with version history
// and comments, variance notes, seasonal (monthly) budgets, ministry owners,
// and "start from last year".
//
// Load order: this file is injected BEFORE app.jsx and shares its global
// scope, so app.jsx globals (fmtMoney, ModalShell, useState, …) are only ever
// referenced inside function bodies, and every top-level name here is
// prefixed ProBudget / pb / PB_ so nothing collides.
// ----------------------------------------------------------------------------

const PB_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const PB_SETUP_MSG =
  "Saving drafts, comments and notes needs supabase/pro-budget-reports.sql.";
const PB_LOCAL_MSG =
  "Changes here stay on this page for now — they aren't saved anywhere yet.";

const PB_STATUS_META = {
  draft: { label: "Draft", pill: "neutral" },
  submitted: { label: "Submitted for approval", pill: "warm" },
  changes_requested: { label: "Changes requested", pill: "bad" },
  approved: { label: "Approved", pill: "good" },
};

const PB_PRESETS = [
  { key: "even", label: "Even" },
  { key: "december", label: "Heavier in December" },
  { key: "summer", label: "Summer dip" },
  { key: "custom", label: "Custom" },
];

// ---------------------------------------------------------------- helpers

function pbNum(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v == null ? "" : v).replace(/[$,\s]/g, ""));
  return isFinite(n) ? n : 0;
}

function pbSum(arr) {
  return (arr || []).reduce((s, n) => s + pbNum(n), 0);
}

function pbPeriod(d) {
  const x = d || new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
}

function pbPeriodLabel(period) {
  const [y, m] = String(period).split("-");
  const idx = parseInt(m, 10) - 1;
  return `${PB_MONTHS[idx] || m} ${y}`;
}

// No fiscal-year convention is stored on the client object in this app
// (profile.fiscal_year_end exists but isn't loaded here), so next fiscal year
// = next calendar year, Jan–Dec.
function pbNextFiscalYear(d) {
  return (d || new Date()).getFullYear() + 1;
}

function pbPresetWeights(key) {
  const w = new Array(12).fill(1);
  if (key === "december") w[11] = 2;
  if (key === "summer") {
    w[5] = 0.7;
    w[6] = 0.7;
    w[7] = 0.7;
  }
  return w;
}

// Splits an annual amount across 12 months by weight, in whole dollars, with
// any rounding remainder landing on December so the months always add back
// up to the annual figure exactly.
function pbSpread(annual, weights) {
  const total = pbSum(weights);
  const target = Math.round(pbNum(annual));
  const w = total > 0 ? weights : new Array(12).fill(1);
  const wt = total > 0 ? total : 12;
  const out = w.map((x) => Math.round((target * pbNum(x)) / wt));
  out[11] += target - pbSum(out);
  return out;
}

function pbValidMonths(m) {
  return Array.isArray(m) && m.length === 12 ? m.map(pbNum) : null;
}

function pbMonthsOf(line) {
  return pbValidMonths(line.months) || pbSpread(line.proposed, pbPresetWeights("even"));
}

function pbDetectPreset(line) {
  const months = pbValidMonths(line.months);
  if (!months) return "even";
  for (const key of ["even", "december", "summer"]) {
    const ref = pbSpread(line.proposed, pbPresetWeights(key));
    if (ref.every((v, i) => v === months[i])) return key;
  }
  return "custom";
}

function pbCleanLines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l) => l && String(l.category || "").trim())
    .map((l) => {
      const months = pbValidMonths(l.months);
      return {
        category: String(l.category).trim(),
        proposed: months ? pbSum(months) : Math.round(pbNum(l.proposed)),
        months,
        owner_email: l.owner_email ? String(l.owner_email) : null,
      };
    });
}

function pbSameEmail(a, b) {
  return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
}

// What changed between two snapshots of `lines`.
function pbLinesDiff(prevLines, nextLines) {
  const prev = new Map(pbCleanLines(prevLines).map((l) => [l.category, l]));
  const next = new Map(pbCleanLines(nextLines).map((l) => [l.category, l]));
  const diff = { added: [], removed: [], changed: [], owners: [], monthly: [] };
  next.forEach((l, cat) => {
    const p = prev.get(cat);
    if (!p) {
      diff.added.push({ category: cat, amount: l.proposed });
      return;
    }
    if (p.proposed !== l.proposed)
      diff.changed.push({ category: cat, from: p.proposed, to: l.proposed });
    if ((p.owner_email || null) !== (l.owner_email || null))
      diff.owners.push({ category: cat, from: p.owner_email, to: l.owner_email });
    if (JSON.stringify(p.months) !== JSON.stringify(l.months))
      diff.monthly.push(cat);
  });
  prev.forEach((l, cat) => {
    if (!next.has(cat)) diff.removed.push({ category: cat, amount: l.proposed });
  });
  return diff;
}

function pbDiffIsEmpty(d) {
  return (
    !d.added.length && !d.removed.length && !d.changed.length &&
    !d.owners.length && !d.monthly.length
  );
}

function pbIsMissing(error) {
  if (!error) return false;
  if (typeof isMissingTableError === "function") return isMissingTableError(error);
  return /does not exist|schema cache/i.test(error.message || "");
}

// ---------------------------------------------------------------- data access
// Every call resolves to { data, error } and never throws.

async function pbSafe(fn) {
  try {
    const res = await fn();
    return { data: res ? res.data : null, error: res ? res.error : null };
  } catch (e) {
    return { data: null, error: e || new Error("Request failed") };
  }
}

const pbApi = {
  loadDraft: (sb, clientId, fy) =>
    pbSafe(() =>
      sb.from("client_budget_drafts").select("*")
        .eq("client_id", clientId).eq("fiscal_year", fy).maybeSingle(),
    ),
  insertDraft: (sb, row) =>
    pbSafe(() => sb.from("client_budget_drafts").insert(row).select().single()),
  updateDraft: (sb, id, patch) =>
    pbSafe(() =>
      sb.from("client_budget_drafts").update(patch).eq("id", id).select().single(),
    ),
  loadHistory: (sb, clientId, fy) =>
    pbSafe(() =>
      sb.from("client_budget_draft_history").select("*")
        .eq("client_id", clientId).eq("fiscal_year", fy)
        .order("version", { ascending: true }),
    ),
  insertHistory: (sb, row) =>
    pbSafe(() =>
      sb.from("client_budget_draft_history").insert(row).select().single(),
    ),
  loadComments: (sb, clientId, fy) =>
    pbSafe(() =>
      sb.from("client_budget_comments").select("*")
        .eq("client_id", clientId).eq("fiscal_year", fy)
        .order("created_at", { ascending: true }),
    ),
  addComment: (sb, row) =>
    pbSafe(() => sb.from("client_budget_comments").insert(row).select().single()),
  loadNotes: (sb, clientId, period) =>
    pbSafe(() =>
      sb.from("client_variance_notes").select("*")
        .eq("client_id", clientId).eq("period", period),
    ),
  deleteNote: (sb, clientId, period, category) =>
    pbSafe(() =>
      sb.from("client_variance_notes").delete()
        .eq("client_id", clientId).eq("period", period).eq("category", category),
    ),
  upsertNote: (sb, row) =>
    pbSafe(() =>
      sb.from("client_variance_notes")
        .upsert(row, { onConflict: "client_id,period,category" })
        .select().single(),
    ),
};

// For a notification elsewhere in the app: the next fiscal year's draft, but
// only while it's waiting on a decision.
async function pbFetchSubmittedDraft(supabase, clientId) {
  if (!supabase || !clientId) return { data: null, error: null };
  const res = await pbSafe(() =>
    supabase.from("client_budget_drafts").select("*")
      .eq("client_id", clientId)
      .eq("fiscal_year", pbNextFiscalYear())
      .eq("status", "submitted")
      .maybeSingle(),
  );
  return { data: res.data || null, error: res.error || null };
}

// ---------------------------------------------------------------- PDF

function pbBuildDraftPdf(client, lines, refByCat, meta) {
  const clean = pbCleanLines(lines);
  const statusLabel = (PB_STATUS_META[meta.status] || PB_STATUS_META.draft).label;
  const doc = newReportDoc(
    `Draft Budget — FY ${meta.fiscalYear}`,
    `${statusLabel} · ${meta.version ? "Version " + meta.version : "Not saved yet"}`,
    client,
  );
  const ownerName = meta.ownerName || ((e) => e || "");
  const hasOwners = clean.some((l) => l.owner_email);
  const totalCurrent = clean.reduce(
    (s, l) => s + (refByCat[l.category] ? refByCat[l.category].budgeted * 12 : 0), 0);
  const totalProposed = clean.reduce((s, l) => s + l.proposed, 0);

  const head = ["Category"];
  if (hasOwners) head.push("Owner");
  head.push("This Month's Actual", "Current Budget (annual)", "Proposed (annual)");
  const numStart = hasOwners ? 2 : 1;
  const columnStyles = {};
  [0, 1, 2].forEach((i) => { columnStyles[numStart + i] = { halign: "right" }; });

  doc.autoTable({
    startY: 55,
    head: [head],
    body: clean.map((l) => {
      const ref = refByCat[l.category];
      const row = [l.category];
      if (hasOwners) row.push(l.owner_email ? ownerName(l.owner_email) : "—");
      row.push(
        ref ? fmtMoney(ref.actual) : "—",
        ref ? fmtMoney(ref.budgeted * 12) : "—",
        fmtMoney(l.proposed),
      );
      return row;
    }),
    foot: [[
      "Total",
      ...(hasOwners ? [""] : []),
      "",
      fmtMoney(totalCurrent),
      fmtMoney(totalProposed),
    ]],
    columnStyles,
    ...PDF_TABLE_THEME,
  });

  if (clean.some((l) => l.months)) {
    let y = doc.lastAutoTable.finalY + 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Monthly plan", 14, y);
    const monthCols = {};
    for (let i = 1; i <= 13; i++) monthCols[i] = { halign: "right" };
    const totals = new Array(12).fill(0);
    doc.autoTable({
      startY: y + 3,
      head: [["Category", ...PB_MONTHS, "Total"]],
      body: clean.map((l) => {
        const m = pbMonthsOf(l);
        m.forEach((v, i) => { totals[i] += v; });
        return [l.category, ...m.map((v) => fmtMoney(v)), fmtMoney(l.proposed)];
      }),
      foot: [["Total", ...totals.map((v) => fmtMoney(v)), fmtMoney(totalProposed)]],
      columnStyles: monthCols,
      ...PDF_TABLE_THEME,
      styles: { ...PDF_TABLE_THEME.styles, fontSize: 6, cellPadding: 1.5 },
    });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text(
    "Current budget (annual) is this month's budget × 12. Lines without a monthly plan are spread evenly.",
    14,
    doc.lastAutoTable.finalY + 6,
  );

  const filename = `${sanitizeFilename(client.name)} - Draft Budget FY${meta.fiscalYear}.pdf`;
  doc.save(filename);
  return filename;
}

// ---------------------------------------------------------------- small pieces

function ProBudgetNoteModal({ title, body, confirmLabel, required, placeholder, onConfirm, onCancel }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ModalShell onClose={onCancel} labelledBy="pb-note-modal-title" className="confirm-modal">
      <div className="modal-header">
        <h3 className="card-title" id="pb-note-modal-title" style={{ margin: 0 }}>
          {title}
        </h3>
        <button className="modal-close" onClick={onCancel} aria-label="Close">×</button>
      </div>
      <div className="modal-body">
        {body && <p className="card-subtitle" style={{ marginTop: 0 }}>{body}</p>}
        <textarea
          className="pb-textarea"
          rows={3}
          value={text}
          placeholder={placeholder || (required ? "Add a note" : "Add a note (optional)")}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button
          className="btn-primary"
          disabled={busy || (required && !text.trim())}
          onClick={async () => {
            setBusy(true);
            await onConfirm(text.trim());
            setBusy(false);
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function ProBudgetMonthStrip({ values, label }) {
  const max = Math.max(...values.map(pbNum), 1);
  return (
    <div className="pb-strip" role="img" aria-label={label || "Monthly totals"}>
      {values.map((v, i) => (
        <div className="pb-strip-col" key={i} title={`${PB_MONTHS[i]}: ${fmtMoney(v)}`}>
          <div className="pb-strip-track">
            <div className="pb-strip-bar" style={{ height: `${Math.max((pbNum(v) / max) * 100, 2)}%` }} />
          </div>
          <span className="pb-strip-label">{PB_MONTHS[i].charAt(0)}</span>
        </div>
      ))}
    </div>
  );
}

function ProBudgetVarianceNote({ note, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const body = note && note.note ? note.note : "";
  if (editing) {
    return (
      <div className="pb-note-edit">
        <textarea
          className="pb-textarea"
          rows={2}
          value={text}
          autoFocus
          placeholder="Why is this line over or under? Everyone with access to this budget can see it."
          onChange={(e) => setText(e.target.value)}
        />
        <div className="pb-inline-actions">
          <button
            type="button"
            className="btn-secondary pb-btn-sm"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onSave(text.trim());
              setSaving(false);
              if (ok !== false) setEditing(false);
            }}
          >
            Save note
          </button>
          <button type="button" className="link-btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="pb-note">
      {body && (
        <p className="pb-note-body">
          {body}
          <span className="pb-note-meta">
            {" "}— {note.author_name || note.author_email || "Someone"}
            {note.updated_at ? `, ${relTime(note.updated_at)}` : ""}
          </span>
        </p>
      )}
      {canEdit && (
        <button
          type="button"
          className="link-btn pb-note-btn"
          onClick={() => {
            setText(body);
            setEditing(true);
          }}
        >
          {body ? "Edit note" : "Add note"}
        </button>
      )}
    </div>
  );
}

function ProBudgetComments({ comments, category, canComment, onAdd, emptyText }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const list = comments.filter((c) => (c.category || null) === (category || null));
  return (
    <div className="pb-comments">
      {list.length === 0 && (
        <p className="pb-muted">{emptyText || "No comments yet."}</p>
      )}
      {list.map((c) => (
        <div className="pb-comment" key={c.id}>
          <p>{c.body}</p>
          <span className="pb-comment-meta">
            {c.author_name || c.author_email || "Someone"} · {relTime(c.created_at)}
          </span>
        </div>
      ))}
      {canComment && (
        <div className="pb-comment-add">
          <textarea
            className="pb-textarea"
            rows={2}
            value={text}
            placeholder={category ? `Comment on ${category}…` : "Comment on the whole budget…"}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary pb-btn-sm"
            disabled={saving || !text.trim()}
            onClick={async () => {
              setSaving(true);
              const ok = await onAdd(category || null, text.trim());
              setSaving(false);
              if (ok !== false) setText("");
            }}
          >
            Post comment
          </button>
        </div>
      )}
    </div>
  );
}

function ProBudgetHistory({ history, canSeeCategory, whoName }) {
  const [open, setOpen] = useState(() => new Set());
  const sorted = [...history].sort((a, b) => (a.version || 0) - (b.version || 0));
  if (!sorted.length) {
    return <p className="pb-muted">No saved versions yet. Saving the draft records version 1.</p>;
  }
  const toggle = (key) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const items = sorted.map((h, i) => ({
    h,
    key: h.id || `v${h.version}-${i}`,
    diff: pbLinesDiff(i > 0 ? sorted[i - 1].lines : [], h.lines),
    first: i === 0,
  }));
  const keep = (x) => canSeeCategory(x.category);
  return (
    <ul className="pb-history">
      {items.reverse().map(({ h, key, diff, first }) => {
        const d = {
          added: diff.added.filter(keep),
          removed: diff.removed.filter(keep),
          changed: diff.changed.filter(keep),
          owners: diff.owners.filter(keep),
          monthly: diff.monthly.filter((c) => canSeeCategory(c)),
        };
        const meta = PB_STATUS_META[h.status] || PB_STATUS_META.draft;
        const isOpen = open.has(key);
        return (
          <li className="pb-history-item" key={key}>
            <button type="button" className="pb-history-head" onClick={() => toggle(key)} aria-expanded={isOpen}>
              <span className="pb-history-version">v{h.version}</span>
              <span className={"pill " + meta.pill}>{meta.label}</span>
              <span className="pb-history-who">
                {h.changed_by_name || whoName(h.changed_by) || "Someone"} · {relTime(h.changed_at)}
              </span>
              <span className="pb-history-caret" aria-hidden="true">{isOpen ? "−" : "+"}</span>
            </button>
            {h.note && <p className="pb-history-note">“{h.note}”</p>}
            {isOpen && (
              <div className="pb-diff">
                {first ? (
                  <p className="pb-muted">
                    First saved version: {pbCleanLines(h.lines).filter((l) => canSeeCategory(l.category)).length} lines,{" "}
                    {fmtMoney(pbCleanLines(h.lines).filter((l) => canSeeCategory(l.category)).reduce((s, l) => s + l.proposed, 0))} proposed.
                  </p>
                ) : pbDiffIsEmpty(d) ? (
                  <p className="pb-muted">No line changes — status or note only.</p>
                ) : (
                  <ul>
                    {d.added.map((x) => (
                      <li key={"a" + x.category}><span className="positive">Added</span> {x.category} ({fmtMoney(x.amount)})</li>
                    ))}
                    {d.removed.map((x) => (
                      <li key={"r" + x.category}><span className="negative">Removed</span> {x.category} ({fmtMoney(x.amount)})</li>
                    ))}
                    {d.changed.map((x) => (
                      <li key={"c" + x.category}>
                        {x.category}: {fmtMoney(x.from)} → {fmtMoney(x.to)}{" "}
                        <span className={x.to > x.from ? "negative" : "positive"}>
                          ({x.to > x.from ? "+" : ""}{fmtMoney(x.to - x.from)})
                        </span>
                      </li>
                    ))}
                    {d.owners.map((x) => (
                      <li key={"o" + x.category}>
                        {x.category} owner: {x.from ? whoName(x.from) : "no owner"} → {x.to ? whoName(x.to) : "no owner"}
                      </li>
                    ))}
                    {d.monthly.map((c) => (
                      <li key={"m" + c}>{c}: monthly plan changed</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- forecast

function ProBudgetForecastCard({ client, budget, orgWide }) {
  // Last CLOSED month × 12: a QuickBooks row's `actual` is month to date,
  // and ×12 of a few days' spending forecast a huge underspend.
  const rows = budget
    .map((b) => {
      const annualBudget = pbNum(b.budgeted) * 12;
      const projected = pbNum(window.mgbClosedMonthActual(client, b)) * 12;
      return { category: b.category, annualBudget, projected, diff: projected - annualBudget };
    })
    .sort((a, b) => b.diff - a.diff);
  const totalBudget = rows.reduce((s, r) => s + r.annualBudget, 0);
  const totalProjected = rows.reduce((s, r) => s + r.projected, 0);
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.diff)), 1);

  const monthly = window.mgbClosedMonths(client.monthly);
  const n = monthly.length;
  const avgIncome = n ? pbSum(monthly.map((m) => m.income)) / n : null;
  const avgExpenses = n ? pbSum(monthly.map((m) => m.expenses)) / n : null;
  const trailingNet = n ? pbSum(monthly.map((m) => pbNum(m.income) - pbNum(m.expenses))) : null;
  const projectedNet = n ? (avgIncome - avgExpenses) * 12 : null;

  return (
    <div className="card">
      <h3 className="card-title">Year-End Forecast</h3>
      <p className="card-subtitle">
        An estimate: each category's spending in the last closed month × 12, against its budget ×
        12. One month of category detail drives it, so a seasonal month (like December) can skew a
        line.
      </p>

      <div className="kpi-grid pb-kpi-inline">
        <div className="card kpi-card">
          <span className="kpi-label">Annual budget (est.)</span>
          <span className="kpi-value">{fmtMoney(totalBudget)}</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Projected spending at this pace</span>
          <span className="kpi-value">{fmtMoney(totalProjected)}</span>
          <span className={"kpi-sub " + (totalProjected > totalBudget ? "negative" : "positive")}>
            {totalProjected > totalBudget
              ? `${fmtMoney(totalProjected - totalBudget)} over budget`
              : `${fmtMoney(totalBudget - totalProjected)} under budget`}
          </span>
        </div>
        {orgWide && projectedNet != null && (
          <div className="card kpi-card">
            <span className="kpi-label">Projected full-year {projectedNet >= 0 ? "surplus" : "deficit"}</span>
            <span className={"kpi-value " + (projectedNet >= 0 ? "positive" : "negative")}>
              {fmtMoney(projectedNet)}
            </span>
            <span className="kpi-sub neutral">
              Average of the last {n} closed months × 12 · those {n} months actual: {fmtMoney(trailingNet)}
            </span>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="pb-muted">No budget categories yet — once a budget is set, the forecast fills in.</p>
      ) : (
        <ul className="pb-forecast-list">
          {rows.map((r) => {
            const over = r.diff > 0.5;
            const under = r.diff < -0.5;
            return (
              <li className="pb-forecast-item" key={r.category}>
                <div className="pb-forecast-text">
                  <strong>{r.category}</strong>
                  <span className={over ? "negative" : under ? "positive" : "pb-muted"}>
                    {over
                      ? `On pace to overspend ${r.category} by ${fmtMoney(r.diff)} by December`
                      : under
                        ? `On pace to come in under by ${fmtMoney(-r.diff)}`
                        : "Right on budget"}
                  </span>
                </div>
                <div className="pb-forecast-nums">
                  {fmtMoney(r.projected)} <span className="pb-muted">of {fmtMoney(r.annualBudget)}</span>
                </div>
                <div className="pb-diverge" aria-hidden="true">
                  <div className="pb-diverge-mid" />
                  <div
                    className={"pb-diverge-bar " + (over ? "over" : "under")}
                    style={{
                      width: `${(Math.abs(r.diff) / maxAbs) * 50}%`,
                      [over ? "left" : "right"]: "50%",
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- what-if

function ProBudgetWhatIfCard({ client }) {
  const [giving, setGiving] = useState(0);
  const [expense, setExpense] = useState(0);
  const [newCost, setNewCost] = useState("");
  const [newCostLabel, setNewCostLabel] = useState("part-time admin");

  // Closed months only (a QuickBooks client's newest month is month to date).
  const monthly = window.mgbClosedMonths(client.monthly);
  const n = monthly.length;
  if (!n) {
    return (
      <div className="card">
        <h3 className="card-title">What-If Scenarios</h3>
        <p className="pb-muted">There isn't enough monthly history yet to model scenarios.</p>
      </div>
    );
  }
  const baseIncome = pbSum(monthly.map((m) => m.income)) / n;
  const baseExpenses = pbSum(monthly.map((m) => m.expenses)) / n;
  const cash = typeof totalCash === "function" ? pbNum(totalCash(client)) : 0;
  const cost = Math.max(pbNum(newCost), 0);

  const scenIncome = baseIncome * (1 + giving / 100);
  const scenExpenses = baseExpenses * (1 + expense / 100) + cost;

  const calc = (inc, exp) => ({
    income: inc,
    expenses: exp,
    net: inc - exp,
    reserve: exp > 0 ? cash / exp : null,
    cashLasts: inc - exp < 0 ? cash / (exp - inc) : null,
  });
  const base = calc(baseIncome, baseExpenses);
  const scen = calc(scenIncome, scenExpenses);
  const changed = giving !== 0 || expense !== 0 || cost > 0;

  const row = (label, a, b, fmt, tone) => (
    <tr>
      <td>{label}</td>
      <td className="num" data-label="Today">{fmt(a)}</td>
      <td className={"num " + (tone ? tone(b) : "")} data-label="Scenario">{fmt(b)}</td>
    </tr>
  );
  const money = (v) => (v == null ? "—" : fmtMoney(v));
  const months = (v) => (v == null ? "—" : `${v.toFixed(1)} mo`);
  const netTone = (v) => (v >= 0 ? "positive" : "negative");

  return (
    <div className="card">
      <h3 className="card-title">What-If Scenarios</h3>
      <p className="card-subtitle">
        Try a change and see what it does to the monthly bottom line and your operating reserve.
        Starts from the average of the last {n} closed months; nothing here is saved.
      </p>

      <div className="pb-whatif-grid">
        <div className="pb-whatif-controls">
          <label className="pb-slider">
            <span className="pb-slider-head">
              <span>Giving change</span>
              <strong>{giving > 0 ? "+" : ""}{giving}%</strong>
            </span>
            <input type="range" min={-30} max={30} step={1} value={giving}
              onChange={(e) => setGiving(parseInt(e.target.value, 10))} aria-label="Giving change percent" />
          </label>
          <label className="pb-slider">
            <span className="pb-slider-head">
              <span>Expense change</span>
              <strong>{expense > 0 ? "+" : ""}{expense}%</strong>
            </span>
            <input type="range" min={-30} max={30} step={1} value={expense}
              onChange={(e) => setExpense(parseInt(e.target.value, 10))} aria-label="Expense change percent" />
          </label>
          <div className="ms-form-row pb-whatif-cost">
            <label className="task-field">
              <span>New recurring monthly cost</span>
              <input className="pb-input" type="text" inputMode="decimal" placeholder="1800"
                value={newCost} onChange={(e) => setNewCost(e.target.value)} />
            </label>
            <label className="task-field">
              <span>What it's for</span>
              <input className="pb-input" type="text" value={newCostLabel}
                onChange={(e) => setNewCostLabel(e.target.value)} />
            </label>
          </div>
          {changed && (
            <button type="button" className="link-btn" onClick={() => {
              setGiving(0); setExpense(0); setNewCost("");
            }}>
              Reset to today
            </button>
          )}
        </div>

        <div className="table-scroll">
          <table className="budget-table tx-table-labeled pb-compare">
            <thead>
              <tr>
                <th></th>
                <th className="num">Today</th>
                <th className="num">Scenario</th>
              </tr>
            </thead>
            <tbody>
              {row("Monthly giving", base.income, scen.income, money)}
              {row("Monthly expenses", base.expenses, scen.expenses, money)}
              {cost > 0 && row(newCostLabel ? `Includes ${newCostLabel}` : "Includes new cost", 0, cost, money)}
              {row("Monthly surplus / deficit", base.net, scen.net, money, netTone)}
              {row("Yearly surplus / deficit", base.net * 12, scen.net * 12, money, netTone)}
              {row("Months of operating reserve", base.reserve, scen.reserve, months,
                (v) => (v != null && v < 3 ? "negative" : ""))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="pb-whatif-summary">
        {!changed
          ? `Today, cash on hand of ${fmtMoney(cash)} covers about ${base.reserve == null ? "—" : base.reserve.toFixed(1)} months of normal expenses.`
          : scen.net >= 0
            ? `In this scenario you'd run a surplus of about ${fmtMoney(scen.net)} a month, and cash would cover ${scen.reserve == null ? "—" : scen.reserve.toFixed(1)} months of expenses.`
            : `In this scenario you'd run about ${fmtMoney(-scen.net)} short each month. At that pace, today's ${fmtMoney(cash)} in cash would last roughly ${scen.cashLasts.toFixed(0)} months.`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- workspace

function ProBudgetWorkspace({ client, access, clientPortalUser }) {
  const { staff, staffUser } = useContext(StaffToolsContext);
  const showToast = useToast();
  const acc = access || { isFullAccess: true, categories: null };
  const fiscalYear = pbNextFiscalYear();
  const period = pbPeriod();
  const clientId = client && client.id;
  const budget = (client.budget || []).filter(
    (b) => !acc.categories || acc.categories.has(b.category),
  );
  const users = client.users || [];

  // Who's acting — used for every write.
  const viewer = (staff
    ? staffUser
    : clientPortalUser || acc.user || staffUser) || {};
  const viewerEmail = viewer.email || null;
  const viewerName = viewer.name || viewer.email || "Someone";
  const scoped = !staff && !!acc.categories;
  const orgWide = !scoped;
  const canDecide = !!staff || !!acc.isFullAccess;

  const refByCat = useMemo(() => {
    const m = {};
    (client.budget || []).forEach((b) => { m[b.category] = b; });
    return m;
  }, [client.budget]);

  const initialLines = () =>
    (client.budget || []).map((b) => ({
      category: b.category,
      proposed: Math.round(pbNum(b.budgeted) * 12),
      months: null,
      owner_email: null,
    }));

  const [view, setView] = useState("actual");
  const [mode, setMode] = useState("loading"); // loading | remote | local
  const [setupMissing, setSetupMissing] = useState(false);
  const [row, setRow] = useState(null);
  const [lines, setLines] = useState(initialLines);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(pbCleanLines(initialLines())));
  const [history, setHistory] = useState([]);
  const [comments, setComments] = useState([]);
  const [notes, setNotes] = useState({});
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null); // {kind}
  const [conflict, setConflict] = useState(null);
  const [newCategory, setNewCategory] = useState("");
  const [lastYearPct, setLastYearPct] = useState("3");
  const [expandedMonths, setExpandedMonths] = useState(() => new Set());
  const [openComments, setOpenComments] = useState(null);
  const [presetUi, setPresetUi] = useState({});
  const autoOpenedRef = useRef(false);

  const sb = typeof window !== "undefined" ? window.mgbSupabase : null;
  const remote = mode === "remote" && !!sb;

  const whoName = (email) => {
    if (!email) return "";
    const u = users.find((x) => pbSameEmail(x.email, email));
    if (u) return u.name;
    if (staffUser && pbSameEmail(staffUser.email, email)) return staffUser.name || email;
    return email;
  };

  const applyRow = (r) => {
    setRow(r);
    const l = pbCleanLines(r.lines);
    setLines(l);
    setSavedJson(JSON.stringify(l));
    setPresetUi({});
  };

  // ------------------------------------------------------------ load
  useEffect(() => {
    let cancelled = false;
    setRow(null);
    setHistory([]);
    setComments([]);
    setNotes({});
    setConflict(null);
    const init = pbCleanLines(initialLines());
    setLines(init);
    setSavedJson(JSON.stringify(init));
    setSetupMissing(false);
    autoOpenedRef.current = false;
    if (!sb || !clientId) {
      setMode("local");
      return undefined;
    }
    setMode("loading");
    (async () => {
      const [d, h, c, n] = await Promise.all([
        pbApi.loadDraft(sb, clientId, fiscalYear),
        pbApi.loadHistory(sb, clientId, fiscalYear),
        pbApi.loadComments(sb, clientId, fiscalYear),
        pbApi.loadNotes(sb, clientId, period),
      ]);
      if (cancelled) return;
      const errors = [d, h, c, n].map((r) => r.error).filter(Boolean);
      if (errors.some(pbIsMissing)) {
        setSetupMissing(true);
        setMode("local");
        return;
      }
      if (d.error) {
        showToast("Couldn't load the saved budget draft.");
        setMode("local");
        return;
      }
      if (d.data) applyRow(d.data);
      setHistory(h.data || []);
      setComments(c.data || []);
      const map = {};
      (n.data || []).forEach((x) => { map[x.category] = x; });
      setNotes(map);
      setMode("remote");
      if (d.data && d.data.status === "submitted" && canDecide && !autoOpenedRef.current) {
        autoOpenedRef.current = true;
        setView("draft");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, fiscalYear, period]);

  const fallBackToLocal = () => {
    setSetupMissing(true);
    setMode("local");
    showToast(PB_SETUP_MSG);
  };

  // ------------------------------------------------------------ derived
  const status = row ? row.status || "draft" : "draft";
  const statusMeta = PB_STATUS_META[status] || PB_STATUS_META.draft;
  const locked = status === "submitted" || status === "approved";
  const canEditLines = !locked;
  const canStructure = canEditLines && !scoped;

  const canSeeCategory = (cat) => !scoped || acc.categories.has(cat);
  const canSeeLine = (l) =>
    !scoped || acc.categories.has(l.category) || pbSameEmail(l.owner_email, viewerEmail);
  const visibleLines = lines.filter(canSeeLine);
  const visibleCats = new Set(visibleLines.map((l) => l.category));

  const dirty = JSON.stringify(pbCleanLines(lines)) !== savedJson;
  const totalCurrentAnnual = visibleLines.reduce(
    (s, l) => s + (refByCat[l.category] ? pbNum(refByCat[l.category].budgeted) * 12 : 0), 0);
  const totalProposed = visibleLines.reduce((s, l) => s + pbNum(l.proposed), 0);
  const pctChange = totalCurrentAnnual > 0
    ? ((totalProposed - totalCurrentAnnual) / totalCurrentAnnual) * 100
    : 0;
  const monthTotals = useMemo(() => {
    const t = new Array(12).fill(0);
    visibleLines.forEach((l) => pbMonthsOf(l).forEach((v, i) => { t[i] += v; }));
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(visibleLines)]);

  const totals = budget.reduce(
    (a, b) => ({ budgeted: a.budgeted + pbNum(b.budgeted), actual: a.actual + pbNum(b.actual) }),
    { budgeted: 0, actual: 0 },
  );

  // ------------------------------------------------------------ line edits
  const updateLine = (category, fn) =>
    setLines((prev) => prev.map((l) => (l.category === category ? fn(l) : l)));

  const setProposed = (category, value) =>
    updateLine(category, (l) => {
      const annual = Math.max(Math.round(pbNum(value)), 0);
      const months = pbValidMonths(l.months);
      if (!months) return { ...l, proposed: annual };
      const weights = pbSum(months) > 0 ? months : pbPresetWeights("even");
      return { ...l, proposed: annual, months: pbSpread(annual, weights) };
    });

  const setMonth = (category, idx, value) => {
    setPresetUi((p) => ({ ...p, [category]: "custom" }));
    updateLine(category, (l) => {
      const months = pbMonthsOf(l).slice();
      months[idx] = Math.max(Math.round(pbNum(value)), 0);
      return { ...l, months, proposed: pbSum(months) };
    });
  };

  const setPreset = (category, key) => {
    setPresetUi((p) => ({ ...p, [category]: key }));
    updateLine(category, (l) => {
      if (key === "even") return { ...l, months: null };
      if (key === "custom") return { ...l, months: pbMonthsOf(l) };
      return { ...l, months: pbSpread(l.proposed, pbPresetWeights(key)) };
    });
  };

  const setOwner = (category, email) =>
    updateLine(category, (l) => ({ ...l, owner_email: email || null }));

  const removeLine = (category) =>
    setLines((prev) => prev.filter((l) => l.category !== category));

  const addLine = () => {
    const name = newCategory.trim();
    if (!name) return;
    if (lines.some((l) => l.category.toLowerCase() === name.toLowerCase())) {
      showToast("That category is already in the draft.");
      return;
    }
    setLines((prev) => [...prev, { category: name, proposed: 0, months: null, owner_email: null }]);
    setNewCategory("");
  };

  const toggleMonths = (category) =>
    setExpandedMonths((s) => {
      const n = new Set(s);
      if (n.has(category)) n.delete(category);
      else n.add(category);
      return n;
    });

  const applyLastYear = () => {
    const f = 1 + pbNum(lastYearPct) / 100;
    setLines((prev) => {
      const seen = new Set();
      const next = prev.map((l) => {
        const ref = refByCat[l.category];
        if (!ref) return l;
        seen.add(l.category);
        return {
          ...l,
          proposed: Math.max(Math.round(pbNum(window.mgbClosedMonthActual(client, ref)) * 12 * f), 0),
          months: null,
        };
      });
      (client.budget || []).forEach((b) => {
        if (!seen.has(b.category))
          next.push({
            category: b.category,
            proposed: Math.max(Math.round(pbNum(window.mgbClosedMonthActual(client, b)) * 12 * f), 0),
            months: null,
            owner_email: null,
          });
      });
      return next;
    });
    setPresetUi({});
    setModal(null);
    showToast("Filled in from this month's actuals — review before saving.");
  };

  // ------------------------------------------------------------ persistence
  // Every explicit save and status change: write the draft row, bump the
  // version, and record a history snapshot.
  async function persist({ nextStatus, note, patch }) {
    if (saving) return false;
    setSaving(true);
    const now = new Date().toISOString();
    let baseRow = row;
    let outLines = pbCleanLines(lines);
    const statusToSave = nextStatus || (status === "changes_requested" ? "draft" : status);

    if (remote) {
      const fresh = await pbApi.loadDraft(sb, clientId, fiscalYear);
      if (fresh.error && pbIsMissing(fresh.error)) {
        setSaving(false);
        fallBackToLocal();
        return false;
      }
      if (fresh.error) {
        setSaving(false);
        showToast("Couldn't save the draft. Please try again.");
        return false;
      }
      const f = fresh.data;
      const stale = (f && !baseRow) || (f && baseRow && (f.version || 1) !== (baseRow.version || 1));
      if (stale) {
        if (scoped && f.status !== "submitted" && f.status !== "approved") {
          // A ministry lead only ever touches their own lines, so merge those
          // onto whatever everyone else has saved since.
          const mine = new Map(outLines.filter(canSeeLine).map((l) => [l.category, l]));
          const merged = pbCleanLines(f.lines).map((l) => mine.get(l.category) || l);
          mine.forEach((l, cat) => {
            if (!merged.some((m) => m.category === cat)) merged.push(l);
          });
          outLines = merged;
          baseRow = f;
        } else {
          setSaving(false);
          setConflict(f);
          showToast("Someone saved a newer version of this draft.");
          return false;
        }
      }
    }

    const version = baseRow ? (baseRow.version || 1) + 1 : 1;
    const payload = {
      client_id: clientId,
      fiscal_year: fiscalYear,
      status: statusToSave,
      lines: outLines,
      version,
      updated_by: viewerEmail,
      updated_at: now,
      ...(patch ? patch(now) : {}),
    };
    const historyRow = {
      client_id: clientId,
      fiscal_year: fiscalYear,
      version,
      status: statusToSave,
      lines: outLines,
      note: note || null,
      changed_by: viewerEmail,
      changed_by_name: viewerName,
      changed_at: now,
    };

    if (remote) {
      const res = baseRow && baseRow.id
        ? await pbApi.updateDraft(sb, baseRow.id, payload)
        : await pbApi.insertDraft(sb, payload);
      if (res.error) {
        setSaving(false);
        if (pbIsMissing(res.error)) fallBackToLocal();
        else showToast("Couldn't save the draft. Please try again.");
        return false;
      }
      const h = await pbApi.insertHistory(sb, historyRow);
      if (h.error) showToast("Saved, but the version history entry didn't record.");
      applyRow(res.data);
      setHistory((prev) => [...prev, h.data || { ...historyRow, id: "local-" + now }]);
    } else {
      applyRow({ ...(baseRow || {}), ...payload, id: (baseRow && baseRow.id) || "local" });
      setHistory((prev) => [...prev, { ...historyRow, id: "local-" + now }]);
    }
    setConflict(null);
    setSaving(false);
    return version;
  }

  const saveDraft = async (note) => {
    const savedVersion = await persist({ note });
    if (savedVersion) showToast(`Saved version ${savedVersion}.`);
    setModal(null);
  };

  const changeStatus = async (nextStatus, note) => {
    const patch =
      nextStatus === "submitted"
        ? (now) => ({ submitted_by: viewerEmail, submitted_at: now, decided_by: null, decided_at: null })
        : nextStatus === "approved" || nextStatus === "changes_requested"
          ? (now) => ({ decided_by: viewerEmail, decided_at: now })
          : null;
    const ok = await persist({ nextStatus, note, patch });
    if (ok) {
      showToast(
        nextStatus === "submitted" ? "Submitted for approval."
          : nextStatus === "approved" ? "Budget approved."
            : nextStatus === "changes_requested" ? "Sent back with requested changes."
              : "Draft reopened for editing.",
      );
    }
    setModal(null);
  };

  const addComment = async (category, body) => {
    const r = {
      client_id: clientId,
      fiscal_year: fiscalYear,
      category: category || null,
      body,
      author_email: viewerEmail,
      author_name: viewerName,
      created_at: new Date().toISOString(),
    };
    if (remote) {
      const res = await pbApi.addComment(sb, r);
      if (res.error) {
        if (pbIsMissing(res.error)) fallBackToLocal();
        else {
          showToast("Couldn't post that comment.");
          return false;
        }
      } else {
        setComments((c) => [...c, res.data]);
        return true;
      }
    }
    setComments((c) => [...c, { ...r, id: "local-" + Date.now() }]);
    return true;
  };

  const saveVarianceNote = async (category, text) => {
    const r = {
      client_id: clientId,
      period,
      category,
      note: text,
      author_email: viewerEmail,
      author_name: viewerName,
      updated_at: new Date().toISOString(),
    };
    // Clearing a note deletes it (the table doesn't allow empty notes).
    if (remote && !String(text || "").trim()) {
      const del = await pbApi.deleteNote(sb, clientId, period, category);
      if (del.error && !pbIsMissing(del.error)) {
        showToast("Couldn't remove that note.");
        return false;
      }
      if (!del.error) {
        setNotes((m) => {
          const next = { ...m };
          delete next[category];
          return next;
        });
        return true;
      }
    }
    if (remote) {
      const res = await pbApi.upsertNote(sb, r);
      if (res.error) {
        if (pbIsMissing(res.error)) fallBackToLocal();
        else {
          showToast("Couldn't save that note.");
          return false;
        }
      } else {
        setNotes((m) => ({ ...m, [category]: res.data }));
        return true;
      }
    }
    setNotes((m) => ({ ...m, [category]: r }));
    return true;
  };

  const downloadPdf = () => {
    try {
      const filename = pbBuildDraftPdf(client, visibleLines, refByCat, {
        fiscalYear,
        status,
        version: row && row.version,
        ownerName: whoName,
      });
      showToast(`Downloaded "${filename}"`);
    } catch (e) {
      showToast("Couldn't build the PDF.");
    }
  };

  // ------------------------------------------------------------ render parts
  const commentCount = (cat) => comments.filter((c) => (c.category || null) === cat).length;

  const setupNote = setupMissing ? PB_SETUP_MSG : mode === "local" ? PB_LOCAL_MSG : null;

  const statusLine = (() => {
    if (!row) return "Not saved yet — saving records version 1 and shares it with everyone on this budget.";
    const bits = [];
    if (status === "submitted" && row.submitted_at)
      bits.push(`Submitted by ${whoName(row.submitted_by) || "someone"} ${relTime(row.submitted_at)}`);
    if ((status === "approved" || status === "changes_requested") && row.decided_at)
      bits.push(`${status === "approved" ? "Approved" : "Changes requested"} by ${whoName(row.decided_by) || "someone"} ${relTime(row.decided_at)}`);
    if (row.updated_at && !bits.length)
      bits.push(`Last saved by ${whoName(row.updated_by) || "someone"} ${relTime(row.updated_at)}`);
    return bits.join(" · ");
  })();

  const latestChangeRequest = status === "changes_requested"
    ? [...history].sort((a, b) => (b.version || 0) - (a.version || 0)).find((h) => h.status === "changes_requested")
    : null;

  const tabs = [
    { key: "actual", label: "Budget vs. Actual" },
    ...(orgWide ? [{ key: "trend", label: "Spending Trend" }] : []),
    { key: "forecast", label: "Year-End Forecast" },
    ...(orgWide ? [{ key: "whatif", label: "What-If" }] : []),
    { key: "draft", label: `FY ${fiscalYear} Budget` },
  ];

  const colCount = scoped ? 5 : 6;

  return (
    <div className="pb-workspace">
      <MockBanner
        text="Budget figures are sample data for this prototype until budgets sync from QuickBooks."
        client={client}
      />

      <div className="kpi-grid">
        <button className="card kpi-card kpi-card-clickable" onClick={() => setView("actual")}>
          <span className="kpi-label">Total Budgeted (this month)</span>
          <span className="kpi-value">{fmtMoney(totals.budgeted)}</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={() => setView("actual")}>
          <span className="kpi-label">
            Total Actual ({client.dataSource === "quickbooks" ? "month to date" : "this month"})
          </span>
          <span className="kpi-value">{fmtMoney(totals.actual)}</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={() => setView("draft")}>
          <span className="kpi-label">FY {fiscalYear} Proposed</span>
          <span className="kpi-value">{fmtMoney(totalProposed)}</span>
          <span className="kpi-sub neutral">
            {(pctChange >= 0 ? "+" : "") + pctChange.toFixed(1)}% vs. current budget × 12
          </span>
        </button>
      </div>

      <div className="view-toggle pb-tabs" role="tablist" aria-label="Budget views">
        {tabs.map((t) => (
          <button
            type="button"
            role="tab"
            aria-selected={view === t.key}
            key={t.key}
            className={"view-toggle-btn" + (view === t.key ? " active" : "")}
            onClick={() => setView(t.key)}
          >
            {t.label}
            {t.key === "draft" && row && status !== "draft" && (
              <span className={"pb-tab-dot " + statusMeta.pill} aria-label={statusMeta.label} />
            )}
          </button>
        ))}
      </div>

      {setupNote && <p className="pb-setup-note">{setupNote}</p>}

      {view === "actual" && (
        <div className="card">
          <h3 className="card-title">Spending by Category</h3>
          <p className="card-subtitle">
            Budgeted vs. actual, {pbPeriodLabel(period)}
            {client.dataSource === "quickbooks" ? " (month to date)" : ""}. Notes explain a variance and are visible to
            everyone on this budget.
          </p>
          <div className="table-scroll">
            <table className="budget-table tx-table-labeled">
              <thead>
                <tr>
                  <th style={{ width: "36%" }}>Category</th>
                  <th className="num">Budgeted</th>
                  <th className="num">Actual</th>
                  <th className="num">Variance</th>
                  <th style={{ width: "12%" }}>% Used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {budget.length === 0 && (
                  <EmptyRow colSpan={6}>
                    No budget categories yet — once your bookkeeper sets a budget, this fills in.
                  </EmptyRow>
                )}
                {budget.map((b) => {
                  const bud = pbNum(b.budgeted);
                  const act = pbNum(b.actual);
                  const pct = bud > 0 ? (act / bud) * 100 : null;
                  const over = act > bud;
                  const scaleMax = Math.max(bud, act, 1) * 1.08;
                  const fillPct = Math.min((act / scaleMax) * 100, 100);
                  const tickPct = Math.min((bud / scaleMax) * 100, 100);
                  return (
                    <tr key={b.category} id={"budget-row-" + slugify(b.category)}>
                      <td data-primary="">
                        <div className="category-name">
                          {b.category}
                          <InternalNoteButton
                            client={client}
                            targetType="budget"
                            targetKey={b.category}
                            targetLabel={b.category}
                          />
                        </div>
                        <div className="bullet-track">
                          <div
                            className={"bullet-fill " + (over ? "over" : "under")}
                            style={{ width: `${fillPct}%`, animationDuration: `${growDuration(fillPct)}ms` }}
                          ></div>
                          <div className="bullet-target" style={{ left: `${tickPct}%` }}></div>
                        </div>
                        <ProBudgetVarianceNote
                          note={notes[b.category]}
                          canEdit={mode !== "loading"}
                          onSave={(text) => saveVarianceNote(b.category, text)}
                        />
                      </td>
                      <td className="num" data-label="Budgeted">{fmtMoney(bud)}</td>
                      <td className="num" data-label="Actual">{fmtMoney(act)}</td>
                      <td className="num" data-label="Variance">
                        {act - bud >= 0 ? "+" : ""}{fmtMoney(act - bud)}
                      </td>
                      <td data-label="% Used">{pct == null ? "—" : `${pct.toFixed(0)}%`}</td>
                      <td>
                        <span className={"pill " + (over ? "over" : "under")}>
                          {over ? "Over" : "On Track"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "trend" && orgWide && (
        <div className="card">
          <h3 className="card-title">Spending Trend</h3>
          <p className="card-subtitle">
            Income vs. expenses, last {(client.monthly || []).length} months
          </p>
          {(client.monthly || []).length > 0 ? (
            <IncomeExpenseChart monthly={client.monthly} budgetTotal={totals.budgeted} />
          ) : (
            <p className="pb-muted">No monthly history yet.</p>
          )}
        </div>
      )}

      {view === "forecast" && (
        <ProBudgetForecastCard client={client} budget={budget} orgWide={orgWide} />
      )}

      {view === "whatif" && orgWide && <ProBudgetWhatIfCard client={client} />}

      {view === "draft" && (
        <>
          <div className="card pb-draft-card" id="budgeting-tool-draft-card">
            <div className="pb-draft-head">
              <div>
                <h3 className="card-title">
                  FY {fiscalYear} Draft Budget{" "}
                  <span className={"pill " + statusMeta.pill}>{statusMeta.label}</span>
                  {row && row.version ? <span className="pb-version">v{row.version}</span> : null}
                </h3>
                <p className="card-subtitle" style={{ marginBottom: 0 }}>
                  {scoped
                    ? "You can propose amounts for the lines you look after. The rest of the budget is handled by your leadership team."
                    : "Annual amounts for next year. This month's actual and current budget are shown for reference."}
                </p>
                <p className="pb-status-line">{mode === "loading" ? "Loading saved draft…" : statusLine}</p>
              </div>
            </div>

            {latestChangeRequest && latestChangeRequest.note && (
              <div className="pb-callout bad">
                <strong>Changes requested by {latestChangeRequest.changed_by_name || whoName(latestChangeRequest.changed_by)}:</strong>{" "}
                {latestChangeRequest.note}
              </div>
            )}
            {locked && (
              <div className="pb-callout">
                {status === "submitted"
                  ? "This draft is waiting on approval, so it's locked for editing."
                  : "This budget is approved and locked."}
                {canDecide && " You can reopen it as a draft if something needs to change."}
              </div>
            )}
            {conflict && (
              <div className="pb-callout warm">
                {whoName(conflict.updated_by) || "Someone"} saved version {conflict.version}{" "}
                {conflict.updated_at ? relTime(conflict.updated_at) : ""}. Load it to keep working — your
                unsaved changes on this page will be replaced.{" "}
                <button type="button" className="link-btn" onClick={() => { applyRow(conflict); setConflict(null); }}>
                  Load latest version
                </button>
              </div>
            )}

            {canStructure && (
              <div className="pb-lastyear">
                <div>
                  <strong>Start from recent actuals</strong>
                  <p className="pb-muted">
                    Fills each category with the last closed month's actual × 12, plus the change you
                    set. It's an estimate from one month's pace; a full prior year of actuals isn't
                    synced yet.
                  </p>
                </div>
                <div className="pb-lastyear-controls">
                  <label className="task-field compact">
                    <span>Change</span>
                    <span className="pb-pct-input">
                      <input className="pb-input" type="text" inputMode="decimal" value={lastYearPct}
                        onChange={(e) => setLastYearPct(e.target.value)} aria-label="Percent change from recent actuals" />
                      <span>%</span>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      if (lines.some((l) => pbNum(l.proposed) > 0)) setModal({ kind: "lastYear" });
                      else applyLastYear();
                    }}
                  >
                    Fill from actuals
                  </button>
                </div>
              </div>
            )}

            <div className="table-scroll">
              <table className="tx-table tx-table-labeled pb-draft-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Owner</th>
                    <th className="num">This Month's Actual</th>
                    <th className="num">Current Budget (×12)</th>
                    <th className="num">Proposed (annual)</th>
                    {!scoped && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.length === 0 && (
                    <EmptyRow colSpan={colCount}>
                      {scoped ? "No lines are assigned to you in this draft yet." : "No categories yet — add one below."}
                    </EmptyRow>
                  )}
                  {visibleLines.map((l) => {
                    const ref = refByCat[l.category];
                    const current = ref ? pbNum(ref.budgeted) * 12 : 0;
                    const actual = ref ? pbNum(ref.actual) : 0;
                    const scaleMax = Math.max(pbNum(ref && ref.budgeted), actual, 1) * 1.08;
                    const fillPct = Math.min((actual / scaleMax) * 100, 100);
                    const tickPct = Math.min((pbNum(ref && ref.budgeted) / scaleMax) * 100, 100);
                    const over = ref && actual > pbNum(ref.budgeted);
                    const monthsOpen = expandedMonths.has(l.category);
                    const preset = presetUi[l.category] || pbDetectPreset(l);
                    const cc = commentCount(l.category);
                    const ownerOptions = users.filter((u) => u.email);
                    const ownerKnown = !l.owner_email || ownerOptions.some((u) => pbSameEmail(u.email, l.owner_email));
                    return (
                      <React.Fragment key={l.category}>
                        <tr>
                          <td data-primary="">
                            <div className="category-name">{l.category}</div>
                            {ref && (
                              <div className="bullet-track">
                                <div className={"bullet-fill " + (over ? "over" : "under")}
                                  style={{ width: `${fillPct}%`, animationDuration: `${growDuration(fillPct)}ms` }}></div>
                                <div className="bullet-target" style={{ left: `${tickPct}%` }}></div>
                              </div>
                            )}
                            <div className="pb-line-links">
                              <button type="button" className="link-btn" onClick={() => toggleMonths(l.category)} aria-expanded={monthsOpen}>
                                {monthsOpen ? "Hide months" : l.months ? "By month · " + (PB_PRESETS.find((p) => p.key === preset) || {}).label : "By month"}
                              </button>
                              <button type="button" className="link-btn"
                                onClick={() => setOpenComments(openComments === l.category ? null : l.category)}
                                aria-expanded={openComments === l.category}>
                                {cc ? `Comments (${cc})` : "Comment"}
                              </button>
                            </div>
                          </td>
                          <td data-label="Owner">
                            {canStructure ? (
                              <select className="pb-owner-select" value={l.owner_email || ""}
                                onChange={(e) => setOwner(l.category, e.target.value)}
                                aria-label={`Owner for ${l.category}`}>
                                <option value="">No owner</option>
                                {ownerOptions.map((u) => (
                                  <option key={u.email} value={u.email}>{u.name || u.email}</option>
                                ))}
                                {!ownerKnown && <option value={l.owner_email}>{l.owner_email}</option>}
                              </select>
                            ) : (
                              <span className="pb-owner-text">{l.owner_email ? whoName(l.owner_email) : "No owner"}</span>
                            )}
                          </td>
                          <td className="num" data-label="This month's actual">{ref ? fmtMoney(actual) : "—"}</td>
                          <td className="num" data-label="Current budget (×12)">{ref ? fmtMoney(current) : "—"}</td>
                          <td className="num" data-label="Proposed (annual)">
                            {canEditLines ? (
                              <input type="number" min="0" className="budget-input" value={l.proposed}
                                onChange={(e) => setProposed(l.category, e.target.value)}
                                aria-label={`Proposed annual amount for ${l.category}`} />
                            ) : (
                              fmtMoney(l.proposed)
                            )}
                          </td>
                          {!scoped && (
                            <td className="row-remove-cell">
                              {canStructure && (
                                <button className="row-remove-btn" onClick={() => removeLine(l.category)}
                                  aria-label={`Remove ${l.category}`}>×</button>
                              )}
                            </td>
                          )}
                        </tr>
                        {monthsOpen && (
                          <tr className="pb-subrow">
                            <td colSpan={colCount}>
                              <div className="pb-months">
                                <div className="pb-months-head">
                                  <span className="pb-muted">Spread {fmtMoney(l.proposed)} across the year:</span>
                                  <div className="pb-presets" role="radiogroup" aria-label={`Monthly pattern for ${l.category}`}>
                                    {PB_PRESETS.map((p) => (
                                      <button type="button" key={p.key} role="radio" aria-checked={preset === p.key}
                                        disabled={!canEditLines}
                                        className={"pb-preset" + (preset === p.key ? " active" : "")}
                                        onClick={() => setPreset(l.category, p.key)}>
                                        {p.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="pb-months-grid">
                                  {pbMonthsOf(l).map((v, i) => (
                                    <label className="pb-month" key={i}>
                                      <span>{PB_MONTHS[i]}</span>
                                      <input type="number" min="0" className="pb-month-input" value={v}
                                        disabled={!canEditLines}
                                        onChange={(e) => setMonth(l.category, i, e.target.value)} />
                                    </label>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        {openComments === l.category && (
                          <tr className="pb-subrow">
                            <td colSpan={colCount}>
                              <ProBudgetComments
                                comments={comments}
                                category={l.category}
                                canComment={mode !== "loading"}
                                onAdd={addComment}
                                emptyText={`No comments on ${l.category} yet.`}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {canStructure && (
              <div className="add-category-row">
                <input type="text" placeholder="New category name…" value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addLine(); }} />
                <button className="btn-secondary" onClick={addLine}>+ Add Category</button>
              </div>
            )}

            <div className="pb-month-summary">
              <div className="pb-month-summary-text">
                <span className="kpi-label">Proposed by month</span>
                <span className="pb-muted">
                  {visibleLines.some((l) => l.months)
                    ? "Lines without a monthly plan are spread evenly."
                    : "Even across the year until a line gets a monthly plan."}
                </span>
              </div>
              <ProBudgetMonthStrip values={monthTotals} label="Proposed total by month" />
            </div>

            <div className="budget-tool-footer pb-footer">
              <span className="card-subtitle" style={{ margin: 0 }}>
                Total proposed: <strong>{fmtMoney(totalProposed)}</strong>
                {dirty && canEditLines && <span className="pb-dirty"> · Unsaved changes</span>}
              </span>
              <div className="pb-actions">
                <button className="btn-secondary" onClick={downloadPdf}>Download Draft PDF</button>
                {canEditLines && (
                  <button className="btn-secondary" disabled={saving || mode === "loading" || (!dirty && !!row)}
                    onClick={() => setModal({ kind: "save" })}>
                    {saving ? "Saving…" : "Save draft"}
                  </button>
                )}
                {canEditLines && (
                  <button className="btn-primary" disabled={saving || mode === "loading"}
                    onClick={() => setModal({ kind: "submit" })}>
                    Submit for approval
                  </button>
                )}
                {status === "submitted" && canDecide && (
                  <>
                    <button className="btn-secondary" disabled={saving} onClick={() => setModal({ kind: "changes" })}>
                      Request changes
                    </button>
                    <button className="btn-primary" disabled={saving} onClick={() => setModal({ kind: "approve" })}>
                      Approve
                    </button>
                  </>
                )}
                {locked && canDecide && (
                  <button className="link-btn" disabled={saving} onClick={() => setModal({ kind: "reopen" })}>
                    Reopen draft
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="report-grid pb-lower-grid">
            <div className="card">
              <h3 className="card-title">Comments on the Whole Budget</h3>
              <p className="card-subtitle">For questions and context that aren't about one line.</p>
              <ProBudgetComments
                comments={comments}
                category={null}
                canComment={mode !== "loading"}
                onAdd={addComment}
              />
            </div>
            <div className="card">
              <h3 className="card-title">Version History</h3>
              <p className="card-subtitle">Every save and status change, newest first. Open one to see what changed.</p>
              <ProBudgetHistory
                history={history}
                whoName={whoName}
                canSeeCategory={(cat) => canSeeCategory(cat) || visibleCats.has(cat)}
              />
            </div>
          </div>
        </>
      )}

      {modal && modal.kind === "lastYear" && (
        <ConfirmModal
          title="Replace proposed amounts?"
          body={`This overwrites the proposed amount for every current category with the last closed month's actual × 12 ${pbNum(lastYearPct) >= 0 ? "+" : ""}${pbNum(lastYearPct)}%, and clears their monthly plans. Categories you added yourself are left alone. Nothing is saved until you save the draft.`}
          confirmLabel="Replace amounts"
          onConfirm={applyLastYear}
          onCancel={() => setModal(null)}
        />
      )}
      {modal && modal.kind === "save" && (
        <ProBudgetNoteModal
          title="Save draft"
          body={`Saves version ${row ? (row.version || 1) + 1 : 1} and records it in the history.`}
          placeholder="What changed? (optional)"
          confirmLabel="Save draft"
          onConfirm={saveDraft}
          onCancel={() => setModal(null)}
        />
      )}
      {modal && modal.kind === "submit" && (
        <ProBudgetNoteModal
          title="Submit for approval"
          body="The draft will be locked while it's reviewed. Anyone approving will see your note."
          confirmLabel="Submit"
          onConfirm={(note) => changeStatus("submitted", note)}
          onCancel={() => setModal(null)}
        />
      )}
      {modal && modal.kind === "approve" && (
        <ProBudgetNoteModal
          title={`Approve the FY ${fiscalYear} budget`}
          body={`Approves ${fmtMoney(totalProposed)} in proposed spending and locks the budget.`}
          confirmLabel="Approve"
          onConfirm={(note) => changeStatus("approved", note)}
          onCancel={() => setModal(null)}
        />
      )}
      {modal && modal.kind === "changes" && (
        <ProBudgetNoteModal
          title="Request changes"
          body="The draft goes back to editing. Say what needs another look."
          required
          placeholder="What should change?"
          confirmLabel="Send back"
          onConfirm={(note) => changeStatus("changes_requested", note)}
          onCancel={() => setModal(null)}
        />
      )}
      {modal && modal.kind === "reopen" && (
        <ProBudgetNoteModal
          title="Reopen as a draft"
          body={status === "approved"
            ? "This unlocks an approved budget for editing. It will need approval again."
            : "This pulls the draft back from review so it can be edited."}
          confirmLabel="Reopen draft"
          onConfirm={(note) => changeStatus("draft", note)}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}
