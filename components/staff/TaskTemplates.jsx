// ----------------------------------------------------------------------------
// Recurring task templates: the "Save as template" helpers.
//
// Tasks Phase 2 S4 (2026-10-15) moved the templates page to Tasks › Recurring
// (#/tasks/templates, components/tasks/TK_Templates.jsx); writes now go
// through RPCs in supabase/tasks-p2-4-recurring.sql. The old admin page
// "task-templates" (#/templates) is kept only as a redirect, so old links,
// the Settings row and bookmarks still land in the right place.
//
// What stays here: TT_draftFromTask / TT_openDraft / TT_takePendingDraft
// (admins: a pre-filled draft the Recurring page opens), TT_suggestFromTask
// (everyone else: a suggestion admins see on the Recurring page) and
// TT_TemplateIcon.
//
// Loaded before app.jsx and shares its global scope: top-level names carry a
// TT_ prefix; app.jsx globals (hooks, planLabel, ModalShell, useToast) are
// only touched at render time.
// ----------------------------------------------------------------------------

const TT_CADENCES = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "annually", label: "Annually" },
];
// Plans a template can target. "standard" (the retired Plus plan) is left
// out while Plus is off; the DB check still allows it.
const TT_TIERS = ["basic", "premium"];
const TT_COLS =
  "id, title, cadence, due_offset_days, lead_days, plan_tiers, client_ids, priority, active, checklist, created_by, created_at";
const TT_BLANK = {
  title: "",
  cadence: "monthly",
  due_offset_days: 10,
  lead_days: 14,
  plan_tiers: [],
  client_ids: [],
  priority: "normal",
  active: true,
  checklist: [],
};
const TT_MAX_CHECKLIST = 50;
const TT_checklistLines = (text) =>
  String(text || "")
    .split("\n")
    .map((s) => s.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, TT_MAX_CHECKLIST);

// ---------------------------------------------------------------------------
// "Save as template" from a task in Work › Tasks (owner request 2026-09-30).
// Admins: TT_openDraft() parks a pre-filled draft, app.jsx navigates here and
// the page opens the editor with it (nothing saved until Save). Everyone
// else: TT_suggestFromTask() files a row in task_template_suggestions
// (supabase/task-template-suggestions.sql) that admins see at the top of
// this page and in the bell.
// ---------------------------------------------------------------------------
const TT_DRAFT_EVENT = "mgb:tt-open-draft";
let TT_pendingDraft = null;

// Generated task titles end with the period ("… · Sep 2026", "… · Q3 2026",
// "… · 2026"); a template's title must not.
// Same as TK_tplStripPeriod (TK_templateLogic.js), which also knows the
// weekly ("Wk of Sep 7") and fiscal ("FY 2027") labels.
function TT_stripPeriod(text) {
  if (typeof TK_tplStripPeriod === "function") return TK_tplStripPeriod(text);
  return String(text || "")
    .replace(/\s*·\s*(?:Wk of [A-Z][a-z]{2} \d{1,2}|FY \d{4}|[A-Z][a-z]{2,8}\.? \d{4}|Q[1-4] \d{4}|\d{4})\s*$/, "")
    .trim()
    .slice(0, 200);
}

function TT_draftFromTask(task, extra) {
  return {
    ...TT_BLANK,
    plan_tiers: [],
    client_ids: task && task.client_id ? [task.client_id] : [],
    title: TT_stripPeriod(task && (task.text || task.title)),
    priority: ["low", "normal", "high"].includes(task && task.priority) ? task.priority : "normal",
    _prefilled: true,
    ...(extra || {}),
  };
}

// The Recurring page takes the parked draft once (TK_Templates.jsx).
function TT_takePendingDraft() {
  const d = TT_pendingDraft;
  TT_pendingDraft = null;
  return d;
}

function TT_openDraft(draft) {
  TT_pendingDraft = draft;
  try {
    window.dispatchEvent(new Event(TT_DRAFT_EVENT));
  } catch (e) {}
}

async function TT_suggestFromTask(sb, task) {
  const title = TT_stripPeriod(task && task.text);
  if (!sb) return { error: { message: "Supabase isn't configured." } };
  if (!title) return { error: { message: "The task has no title." } };
  const { error } = await sb.from("task_template_suggestions").insert({
    title,
    priority: ["low", "normal", "high"].includes(task.priority) ? task.priority : "normal",
    client_id: task.client_id || null,
    reminder_id: task.id && /^[0-9a-f-]{36}$/i.test(String(task.id)) ? task.id : null,
  });
  if (error && (error.code === "23505" || /duplicate/i.test(error.message || ""))) return { duplicate: true };
  return { error };
}

function TT_TemplateIcon(props) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      <path d="M14 11v6M11 14h6" />
    </svg>
  );
}

// The old page: send anyone who lands on #/templates (or the Settings row)
// to Tasks › Recurring. A parked "Save as template" draft rides along.
function TT_TaskTemplatesPage() {
  useEffect(() => {
    try {
      window.location.hash = "#/tasks/templates";
    } catch (e) {}
  }, []);
  return (
    <div className="card" role="status" style={{ padding: 16 }}>
      <p style={{ margin: 0 }}>
        Recurring templates moved to <a href="#/tasks/templates">Tasks › Recurring</a>.
      </p>
    </div>
  );
}
