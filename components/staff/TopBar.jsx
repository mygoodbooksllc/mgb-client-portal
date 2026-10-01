// ----------------------------------------------------------------------------
// Staff top bar (owner request 2026-09-30). Staff side only: App renders it
// wherever the staff sidebar (StaffRail) shows, so a client (or staff
// previewing as a client user) never sees it.
//
// Every piece is its own small component so the owner can drop any of them by
// deleting one line in TB_StaffTopBar:
//
//   Left     TB_ClientPicker   reuses CS_ClientSwitcher (name, plan, health,
//                              recent clients)
//            TB_OverviewButton "Overview" chip: the open client's staff
//                              overview (client pages only)
//            TB_SyncPill       reuses QboSyncNowButton (the "Every 15 min ·
//                              synced 5m ago" pill; click = Sync now)
//   Middle   TB_Search         clients, my tasks and notes, client SOPs, Help
//                              articles (search_staff_guide), and on a client
//                              page that client's transactions, budget,
//                              documents and messages (replaces the header
//                              search icon for staff). Ctrl+K / Cmd+K.
//   Right    TB_ThrottleBadge  admins: QuickBooks sync slowed or stopped
//                              (qbo_usage_status, supabase/qbo-usage-guard.sql)
//            TB_Bell           client messages waiting, uploaded documents,
//                              tasks assigned to me, blocked month-end close
//            TB_TasksBadge     open My Tasks count, overdue in red
//            TB_QuickAdd       "+" menu: task, note, document request
//                              (StaffQuickActions' modals) and Message
//            TB_HelpButton     "?" menu: help for this page / all topics,
//                              "Report a bug / feedback" (Feedback.jsx)
//            TB_AvatarMenu     theme, Preview as (client user), Exit "View
//                              as", temporary access, Sign out
//
// Moving, not duplicating: while a piece is mounted it puts a class on <html>
// (tb-has-client, tb-has-sync, tb-has-avatar) and top-bar.css hides the old
// copy on desktop. Remove a piece and its old location comes back on its own.
// On phones the bar keeps only the client picker, search, bell and "+"; the
// rest stays where it always was, in the menu drawer. (Overview is hidden
// there too: picking a client, even the one already open, lands on it.)
//
// Navigation goes through the URL hash (#/tasks, #/help/<slug>,
// #/client/<id>/overview ...), which App already routes; the bar has no page
// links of its own (the sidebar keeps those).
//
// Loaded before app.jsx and shares its global scope: every top-level name
// here is TB_-prefixed, and app.jsx globals (hooks, icons, staffItemsApi,
// QboSyncNowButton, CS_ClientSwitcher ...) are only touched at render time.
// Every query fails soft: no Supabase, an RLS refusal or a missing table just
// leaves that piece empty.
// ----------------------------------------------------------------------------

const TB_QUICK_ADD_EVENT = "tb:quick-add"; // StaffQuickActions listens
const TB_BELL_SEEN_KEY = "mgb-topbar-bell-seen";
const TB_BELL_SEEN_MAX = 400;
const TB_BELL_REFRESH_MS = 2 * 60 * 1000;
const TB_THROTTLE_REFRESH_MS = 10 * 60 * 1000;
const TB_SEARCH_DEBOUNCE_MS = 250;
const TB_SEARCH_LIMIT = 6;

// Page key -> staff guide article (docs/staff-guide/<slug>.md).
const TB_HELP_FOR_PAGE = {
  "bookkeeper-home": "home-page",
  "my-tasks": "my-tasks",
  "staff-messages": "inbox",
  "close-tracker": "month-end-close",
  "client-overview": "client-overview",
  documents: "document-requests",
  "staff-team": "team-page",
  "task-templates": "task-templates",
  "staff-access": "staff-management",
  "audit-log": "audit-log",
  emails: "client-emails",
  milestone: "pricing-milestones",
  feedback: "feedback-page",
};
const TB_ADMIN_ARTICLES = new Set([
  "team-page",
  "staff-management",
  "audit-log",
  "client-emails",
  "pricing-milestones",
  "feedback-page",
]);

const TB_lc = (s) => String(s || "").toLowerCase();

function TB_go(hash) {
  if (window.location.hash !== hash) window.location.hash = hash;
}

function TB_clientHash(id, tab) {
  return "#/client/" + encodeURIComponent(id) + "/" + (tab || "overview");
}

// While mounted, put `cls` on <html> so top-bar.css can hide the old copy of
// what this piece replaced. Counted, in case two instances overlap briefly.
const TB_flagCounts = {};
function TB_useRootFlag(cls) {
  useEffect(() => {
    TB_flagCounts[cls] = (TB_flagCounts[cls] || 0) + 1;
    document.documentElement.classList.add(cls);
    return () => {
      TB_flagCounts[cls] -= 1;
      if (!TB_flagCounts[cls]) document.documentElement.classList.remove(cls);
    };
  }, [cls]);
}

// Shared dropdown behavior: outside click closes, Escape closes and returns
// focus to the trigger, arrow keys move between the menu's items.
function TB_useMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const close = useCallback((refocus) => {
    setOpen(false);
    if (refocus && triggerRef.current) triggerRef.current.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  const onMenuKeyDown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(
      (rootRef.current && rootRef.current.querySelectorAll('[role="menuitem"]:not([disabled])')) || [],
    );
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const next =
      e.key === "ArrowDown"
        ? items[(i + 1) % items.length]
        : items[(i - 1 + items.length) % items.length];
    next.focus();
  };
  return { open, setOpen, close, rootRef, triggerRef, onMenuKeyDown };
}

// Seen-ids for the bell, per staffer, per browser. Storage can be blocked.
function TB_readSeen(email) {
  try {
    const v = JSON.parse(localStorage.getItem(TB_BELL_SEEN_KEY + ":" + TB_lc(email)) || "[]");
    return new Set(Array.isArray(v) ? v : []);
  } catch (e) {
    return new Set();
  }
}
function TB_writeSeen(email, set) {
  try {
    const arr = Array.from(set).slice(-TB_BELL_SEEN_MAX);
    localStorage.setItem(TB_BELL_SEEN_KEY + ":" + TB_lc(email), JSON.stringify(arr));
  } catch (e) {}
}

// My staff_reminders rows (tasks and notes), refreshed on every write
// anywhere in the app (staffItemsApi's event). Shared by the search, the bell
// and the tasks badge through TB_StaffTopBar.
function TB_useMyItems(email, enabled) {
  const [rows, setRows] = useState([]);
  const load = useCallback(() => {
    const sb = window.mgbSupabase;
    if (!sb || !email || !enabled || typeof staffItemsApi === "undefined") {
      setRows([]);
      return;
    }
    staffItemsApi
      .list(sb, email)
      .then(({ data, error }) => {
        if (!error && data) setRows(data);
      })
      .catch(() => {});
  }, [email, enabled]);
  useEffect(() => {
    load();
  }, [load]);
  useStaffItemsChanged(load);
  return rows;
}

function TB_PlusIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function TB_BellGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
      <path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" />
    </svg>
  );
}
function TB_QuestionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" />
      <path d="M12 17h.01" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 1. Client picker (CS_ClientSwitcher, restyled for the bar)
// ---------------------------------------------------------------------------
function TB_ClientPicker({ clients, client, staffUser, statusOverrides, pendingRequestsByClient, impersonating }) {
  TB_useRootFlag("tb-has-client");
  if (typeof CS_ClientSwitcher !== "function") return null;
  return (
    <div className="tb-client">
      <CS_ClientSwitcher
        clients={clients}
        currentClient={client}
        onPick={(id) => TB_go(TB_clientHash(id))}
        staffUser={staffUser}
        statusOverrides={statusOverrides}
        pendingRequestsByClient={pendingRequestsByClient}
        canRequest={!impersonating}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1b. Overview: the open client's staff overview (was a "Staff" item in the
// client sidebar; moved here so that sidebar shows only what the client sees)
// ---------------------------------------------------------------------------
function TB_OverviewButton({ client, page }) {
  if (!client) return null;
  const current = page === "client-overview";
  return (
    <button
      type="button"
      className={"tb-item tb-pill-btn tb-overview" + (current ? " is-current" : "")}
      aria-label={`Overview of ${client.name} (staff only)`}
      aria-current={current ? "page" : undefined}
      title={`Overview of ${client.name}`}
      onClick={() => TB_go(TB_clientHash(client.id, "overview"))}
    >
      {typeof BarChartIcon === "function" && <BarChartIcon width="15" height="15" />}
      <span className="tb-overview-label">Overview</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 2. Sync status pill (QboSyncNowButton; staff can always Sync now)
// ---------------------------------------------------------------------------
function TB_SyncPill({ client, plan, onSynced }) {
  TB_useRootFlag("tb-has-sync");
  if (!client) return null;
  if (client.dataSource !== "quickbooks") {
    return (
      <span className="badge-live badge-live--sample tb-sync">
        <span className="badge-dot"></span>
        Prototype · Sample Data
      </span>
    );
  }
  // Same words as the page header (app.jsx syncPillLabel / PLAN_SYNC).
  const label = syncPillLabel(plan, client.lastSyncedAt);
  return (
    <span className="tb-sync">
      <QboSyncNowButton clientId={client.id} onSynced={onSynced} canSyncNow liveLabel={label} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// 3. Global search (Ctrl+K / Cmd+K)
// ---------------------------------------------------------------------------
// PostgREST `or=` filters split on commas and parentheses; keep the term
// to letters, digits, spaces and a few safe marks.
function TB_safeTerm(q) {
  return String(q || "").replace(/[^\p{L}\p{N} '&.-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

// clientSearch (only while a client is open, else null): { client (already
// scoped to the viewer's access), messages, visibleKeys, onNavigate,
// onHighlight }. Its "In <client>" group is built by app.jsx's
// buildClientSearchResults, the same function behind the client-facing
// page-header GlobalSearch, and a pick navigates + highlights the same way.
// That header search icon is hidden for staff while this bar is shown.
function TB_Search({ clients, items, showMine, isAdmin, clientSearch }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState({ q: "", sops: [], help: [], loading: false });
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const seqRef = useRef(0);
  const listId = "tb-search-list";
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

  // Ctrl+K / Cmd+K from anywhere focuses the search.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && TB_lc(e.key) === "k") {
        e.preventDefault();
        setOpen(true);
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const q = query.trim();
  const ql = TB_lc(q);

  // SOPs (RLS scopes them to clients this person can open) and Help articles.
  useEffect(() => {
    const term = TB_safeTerm(q);
    if (term.length < 2) {
      seqRef.current++;
      setRemote({ q: "", sops: [], help: [], loading: false });
      return;
    }
    const sb = window.mgbSupabase;
    if (!sb) return;
    const seq = ++seqRef.current;
    setRemote((r) => ({ ...r, loading: true }));
    const t = setTimeout(() => {
      const like = `%${term}%`;
      const safe = (p) => Promise.resolve(p).then((r) => r, (e) => ({ data: null, error: e }));
      Promise.all([
        safe(
          sb
            .from("client_sops")
            .select("client_id, section, title, body")
            .or(`title.ilike.${like},body.ilike.${like},section.ilike.${like}`)
            .limit(TB_SEARCH_LIMIT),
        ),
        safe(sb.rpc("search_staff_guide", { q: term })),
      ]).then(([sops, help]) => {
        if (seq !== seqRef.current) return;
        setRemote({
          q: term,
          sops: (sops && sops.data) || [],
          help: ((help && help.data) || []).slice(0, TB_SEARCH_LIMIT),
          loading: false,
        });
      });
    }, TB_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const clientName = (id) => {
    const c = (window.CLIENTS || []).find((x) => x.id === id);
    return c ? c.name : id;
  };

  const groups = [];
  if (ql) {
    const cl = (clients || [])
      .filter((c) => TB_lc(c.name).includes(ql))
      .sort((a, b) => TB_lc(a.name).indexOf(ql) - TB_lc(b.name).indexOf(ql))
      .slice(0, TB_SEARCH_LIMIT)
      .map((c) => ({
        key: "c:" + c.id,
        title: c.name,
        sub: typeof planLabel === "function" ? planLabel(c.plan) : "",
        go: () => TB_go(TB_clientHash(c.id)),
      }));
    groups.push({ key: "clients", label: "Clients", items: cl });
    if (clientSearch && clientSearch.client && typeof buildClientSearchResults === "function") {
      const cs = clientSearch;
      groups.push({
        key: "in-client",
        label: "In " + cs.client.name,
        items: buildClientSearchResults(q, cs.client, cs.messages, cs.visibleKeys, 8).map((r, n) => ({
          key: "cs:" + n + ":" + r.page + ":" + r.highlightKey,
          title: r.label,
          sub: r.type + (r.meta ? " · " + r.meta : ""),
          go: () => {
            if (cs.onNavigate) cs.onNavigate(r.page);
            if (cs.onHighlight) cs.onHighlight(r);
          },
        })),
      });
    }
    if (showMine) {
      const mine = (items || []).filter((t) => !t.done && TB_lc(t.text).includes(ql));
      const toRow = (t) => ({
        key: "i:" + t.id,
        title: t.text,
        sub: [t.client_id ? clientName(t.client_id) : "", t.due_date ? "Due " + fmtDate(t.due_date) : ""].filter(Boolean).join(" · "),
        go: () => TB_go("#/tasks"),
      });
      groups.push({ key: "tasks", label: "Tasks", items: mine.filter((t) => t.kind !== "note").slice(0, TB_SEARCH_LIMIT).map(toRow) });
      groups.push({ key: "notes", label: "Notes", items: mine.filter((t) => t.kind === "note").slice(0, TB_SEARCH_LIMIT).map(toRow) });
    }
    if (remote.q) {
      const visible = new Set((clients || []).map((c) => c.id));
      groups.push({
        key: "sops",
        label: "SOPs",
        items: remote.sops
          .filter((s) => visible.has(s.client_id))
          .map((s) => ({
            key: "s:" + s.client_id + ":" + s.section,
            title: `${clientName(s.client_id)} · ${s.title || s.section}`,
            sub: String(s.body || "").replace(/\s+/g, " ").slice(0, 90),
            go: () => TB_go("#/tasks"),
          })),
      });
      groups.push({
        key: "help",
        label: "Help",
        items: remote.help
          .filter((h) => isAdmin || h.audience !== "admin")
          .map((h) => ({
            key: "h:" + h.slug,
            title: h.title,
            sub: h.section || "",
            go: () => TB_go("#/help/" + h.slug),
          })),
      });
    }
  }
  const shown = groups.filter((g) => g.items.length);
  const flat = [];
  shown.forEach((g) => g.items.forEach((it) => flat.push(it)));

  useEffect(() => {
    setActive(0);
  }, [ql, remote.q]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${active}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (it) => {
    if (!it) return;
    setOpen(false);
    setQuery("");
    if (inputRef.current) inputRef.current.blur();
    it.go();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      if (flat.length) setActive((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (query) setQuery("");
      else {
        setOpen(false);
        e.currentTarget.blur();
      }
    }
  };

  let idx = -1;
  const panelOpen = open && !!q;
  const hasClient = !!(clientSearch && clientSearch.client);
  return (
    <div className="tb-search" ref={rootRef}>
      <div className="tb-search-box">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          className="tb-search-input"
          placeholder={
            (showMine ? "Search clients, tasks, SOPs" : "Search clients, SOPs") +
            (hasClient ? ", Help and this client" : " and Help")
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={panelOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={panelOpen && flat.length ? `${listId}-${active}` : undefined}
          aria-label={
            hasClient
              ? `Search clients, tasks, notes, SOPs, Help and ${clientSearch.client.name}`
              : "Search clients, tasks, notes, SOPs and Help"
          }
        />
        <kbd className="tb-kbd" aria-hidden="true">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </div>
      {panelOpen && (
        <div className="tb-panel tb-search-panel">
          <div className="tb-search-list" id={listId} role="listbox" ref={listRef} aria-label="Search results">
            {shown.map((g) => (
              <div key={g.key} role="group" aria-label={g.label}>
                <div className="tb-panel-head">{g.label}</div>
                {g.items.map((it) => {
                  idx += 1;
                  const i = idx;
                  return (
                    <div
                      key={it.key}
                      id={`${listId}-${i}`}
                      data-idx={i}
                      role="option"
                      aria-selected={i === active}
                      className={"tb-result" + (i === active ? " active" : "")}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(it)}
                    >
                      <span className="tb-result-title">{it.title}</span>
                      {it.sub && <span className="tb-result-sub">{it.sub}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
            {flat.length === 0 && (
              <div className="tb-empty">
                {remote.loading || (TB_safeTerm(q).length >= 2 && !remote.q) ? "Searching…" : `Nothing matches "${q}".`}
              </div>
            )}
          </div>
          {remote.loading && flat.length > 0 && <div className="tb-search-foot">Searching SOPs and Help…</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Notifications bell
// ---------------------------------------------------------------------------
function TB_prevMonthStart() {
  const d = new Date();
  const m = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-01`;
}

function TB_useBellItems({ clients, items, me, isAdmin, page }) {
  // Settings > Notifications > "Show in the bell" (components/settings).
  const stSnap = typeof ST_useSettings === "function" ? ST_useSettings() : null;
  const [remote, setRemote] = useState({ msgs: [], docs: [], blocked: [] });
  // Admins: pending "Save as template" suggestions (task_template_suggestions).
  const [tplSuggest, setTplSuggest] = useState([]);
  const loadTplSuggest = useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb || !isAdmin) {
      setTplSuggest([]);
      return;
    }
    const res = await Promise.resolve(
      sb
        .from("task_template_suggestions")
        .select("id, title, client_id, suggested_by, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20),
    ).then((r) => r, (e) => ({ data: null, error: e }));
    setTplSuggest(res && !res.error && Array.isArray(res.data) ? res.data : []);
  }, [isAdmin]);
  useEffect(() => {
    loadTplSuggest();
    window.addEventListener("mgb:staff-tools-changed", loadTplSuggest);
    return () => window.removeEventListener("mgb:staff-tools-changed", loadTplSuggest);
  }, [loadTplSuggest, page]);
  const idsKey = (clients || []).map((c) => c.id).sort().join(",");
  const load = useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb || !me || !idsKey) {
      setRemote({ msgs: [], docs: [], blocked: [] });
      return;
    }
    const ids = idsKey.split(",");
    const safe = (p) => Promise.resolve(p).then((r) => r, (e) => ({ data: null, error: e }));
    const [m, r, d, cc] = await Promise.all([
      safe(
        sb
          .from("client_messages")
          .select("id, client_id, participant_email, author_kind, author_name, body, internal, created_at")
          .in("client_id", ids)
          .order("created_at", { ascending: false })
          .limit(400),
      ),
      safe(sb.from("client_message_reads").select("client_id, participant_email, last_read_at").eq("reader_email", me).in("client_id", ids)),
      safe(
        sb
          .from("client_doc_requests")
          .select("id, client_id, title, file_name, fulfilled_at")
          .eq("status", "uploaded")
          .in("client_id", ids)
          .order("fulfilled_at", { ascending: false })
          .limit(50),
      ),
      safe(sb.from("close_checks").select("client_id, period, status, reasons").eq("status", "blocked").eq("period", TB_prevMonthStart()).in("client_id", ids)),
    ]);
    // A thread is waiting when its newest client message is newer than my
    // read marker (same rule as the Inbox's unread dot).
    const reads = {};
    ((r && r.data) || []).forEach((x) => (reads[x.client_id + "|" + TB_lc(x.participant_email)] = x.last_read_at));
    const seenThread = new Set();
    const msgs = [];
    ((m && m.data) || []).forEach((row) => {
      if (row.author_kind !== "client" || row.internal) return;
      const k = row.client_id + "|" + TB_lc(row.participant_email);
      if (seenThread.has(k)) return;
      seenThread.add(k);
      const readAt = reads[k];
      if (!readAt || new Date(row.created_at) > new Date(readAt)) msgs.push(row);
    });
    setRemote({ msgs, docs: (d && d.data) || [], blocked: (cc && cc.data) || [] });
  }, [idsKey, me]);

  useEffect(() => {
    load();
  }, [load, page]);
  useEffect(() => {
    const id = setInterval(() => !document.hidden && load(), TB_BELL_REFRESH_MS);
    const events = ["mgb:client-messages-changed", "mgb:close-checks-changed", "mgb:staff-tools-changed"];
    events.forEach((ev) => window.addEventListener(ev, load));
    return () => {
      clearInterval(id);
      events.forEach((ev) => window.removeEventListener(ev, load));
    };
  }, [load]);

  const byId = {};
  (clients || []).forEach((c) => (byId[c.id] = c));
  const nameOf = (id) => (byId[id] ? byId[id].name : id);
  // Blocked close: my own clients. For admins (who see every client) that's
  // the ones they're the assigned bookkeeper on.
  const mineForClose = (id) => {
    if (!isAdmin) return true;
    const bk = byId[id] && byId[id].assignedBookkeeper;
    return !!(bk && TB_lc(bk.email) === TB_lc(me));
  };

  const out = [];
  remote.msgs.forEach((row) =>
    out.push({
      id: "msg:" + row.id,
      at: row.created_at,
      title: `${row.author_name || row.participant_email} · ${nameOf(row.client_id)}`,
      sub: "Message waiting: " + String(row.body || "").replace(/\s+/g, " ").slice(0, 80),
      go: () => TB_go("#/chat"),
    }),
  );
  remote.docs.forEach((row) =>
    out.push({
      id: "doc:" + row.id,
      at: row.fulfilled_at,
      title: `${nameOf(row.client_id)} uploaded "${row.title}"`,
      sub: "Document ready to review" + (row.fulfilled_at ? " · " + relTime(row.fulfilled_at) : ""),
      go: () => TB_go(TB_clientHash(row.client_id)),
    }),
  );
  (items || [])
    .filter((t) => !t.done && t.kind !== "note" && TB_lc(t.assignee_email) === TB_lc(me) && TB_lc(t.staff_email) !== TB_lc(me))
    .forEach((t) =>
      out.push({
        id: "task:" + t.id,
        at: t.created_at,
        title: `Assigned to you: ${t.text}`,
        sub: [t.client_id ? nameOf(t.client_id) : "", t.due_date ? "Due " + fmtDate(t.due_date) : ""].filter(Boolean).join(" · ") || "My Tasks",
        go: () => TB_go("#/tasks"),
      }),
    );
  remote.blocked
    .filter((row) => mineForClose(row.client_id))
    .forEach((row) =>
      out.push({
        id: "close:" + row.client_id + ":" + row.period,
        at: row.period,
        title: `${nameOf(row.client_id)}: month-end close is Blocked`,
        sub: Array.isArray(row.reasons) && row.reasons.length ? String(row.reasons[0]) : "See the Close tracker",
        go: () => TB_go("#/close-tracker"),
      }),
    );
  tplSuggest.forEach((row) =>
    out.push({
      id: "tsug:" + row.id,
      at: row.created_at,
      title: `Template suggestion: ${row.title}`,
      sub:
        [String(row.suggested_by || "").split("@")[0], row.client_id ? nameOf(row.client_id) : ""].filter(Boolean).join(" · ") ||
        "Task templates",
      go: () => TB_go("#/templates"),
    }),
  );
  out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  if (stSnap && typeof ST_bellAllows === "function") return out.filter((it) => ST_bellAllows(stSnap.settings, it.id));
  return out;
}

function TB_Bell({ clients, items, me, isAdmin, page }) {
  const list = TB_useBellItems({ clients, items, me, isAdmin, page });
  const menu = TB_useMenu();
  const [seen, setSeen] = useState(() => TB_readSeen(me));
  useEffect(() => setSeen(TB_readSeen(me)), [me]);
  const unseen = list.filter((i) => !seen.has(i.id));
  const toggle = () => {
    if (menu.open) return menu.close(false);
    menu.setOpen(true);
    if (unseen.length) {
      const next = new Set(seen);
      unseen.forEach((i) => next.add(i.id));
      setSeen(next);
      TB_writeSeen(me, next);
    }
  };
  const n = unseen.length;
  return (
    <div className="tb-item tb-bell notif-wrap" ref={menu.rootRef} onKeyDown={menu.onMenuKeyDown}>
      <button
        ref={menu.triggerRef}
        type="button"
        className={"notif-bell tb-icon-btn" + (n ? " has-unseen" : "")}
        aria-label={n ? `Notifications, ${n} new` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={menu.open}
        onClick={toggle}
      >
        <TB_BellGlyph />
        {n > 0 && <span className="notif-count">{n > 99 ? "99+" : n}</span>}
      </button>
      {menu.open && (
        <div className="notif-panel tb-panel tb-bell-panel" role="menu" aria-label="Notifications">
          <div className="notif-panel-head">Notifications</div>
          {list.length === 0 ? (
            <p className="notif-empty">You're all caught up.</p>
          ) : (
            <ul>
              {list.slice(0, 30).map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      menu.close(false);
                      i.go();
                    }}
                  >
                    <span className="notif-title">{i.title}</span>
                    {i.sub && <span className="notif-sub">{i.sub}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. My Tasks badge
// ---------------------------------------------------------------------------
function TB_TasksBadge({ items, me }) {
  const today = todayLocal();
  const mine = (items || []).filter(
    (t) => !t.done && t.kind !== "note" && (TB_lc(t.staff_email) === TB_lc(me) || TB_lc(t.assignee_email) === TB_lc(me)),
  );
  const overdue = mine.filter((t) => t.due_date && t.due_date < today).length;
  const label = `My Tasks: ${mine.length} open` + (overdue ? `, ${overdue} overdue` : "");
  return (
    <button type="button" className="tb-item tb-pill-btn tb-tasks" onClick={() => TB_go("#/tasks")} aria-label={label} title={label}>
      <ChecklistIcon width="16" height="16" strokeWidth="1.8" />
      <span className="tb-tasks-label">My Tasks</span>
      <span className="tb-count">{mine.length}</span>
      {overdue > 0 && <span className="tb-count overdue">{overdue}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 6. "+" quick add (task / note / request open StaffQuickActions' own modals;
// Message opens the same chat drawer the old quick-action bar did)
// ---------------------------------------------------------------------------
function TB_QuickAdd({ client }) {
  const menu = TB_useMenu();
  if (!client) return null;
  const run = (kind) => {
    menu.close(false);
    window.dispatchEvent(new CustomEvent(TB_QUICK_ADD_EVENT, { detail: { kind } }));
  };
  return (
    <div className="tb-item tb-menu-wrap tb-quick" ref={menu.rootRef} onKeyDown={menu.onMenuKeyDown}>
      <button
        ref={menu.triggerRef}
        type="button"
        className="tb-icon-btn"
        aria-label={`Add for ${client.name}`}
        title={`Add for ${client.name}`}
        aria-haspopup="true"
        aria-expanded={menu.open}
        onClick={() => menu.setOpen(!menu.open)}
      >
        <TB_PlusIcon />
      </button>
      {menu.open && (
        <div className="tb-panel tb-menu" role="menu" aria-label={`Add for ${client.name}`}>
          <div className="tb-panel-head">Add for {client.name}</div>
          <button type="button" role="menuitem" className="tb-menu-item" autoFocus onClick={() => run("task")}>
            New task
          </button>
          <button type="button" role="menuitem" className="tb-menu-item" onClick={() => run("note")}>
            New note
          </button>
          <button type="button" role="menuitem" className="tb-menu-item" onClick={() => run("request")}>
            Request document
          </button>
          <button type="button" role="menuitem" className="tb-menu-item" onClick={() => run("message")}>
            Message
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Help
// ---------------------------------------------------------------------------
function TB_HelpButton({ page, isAdmin }) {
  const menu = TB_useMenu();
  if (typeof HLP_StaffGuidePage !== "function") return null;
  let slug = TB_HELP_FOR_PAGE[page] || null;
  if (slug && TB_ADMIN_ARTICLES.has(slug) && !isAdmin) slug = null;
  const label = slug ? "Help for this page" : "Help";
  const goHelp = () => TB_go(page === "help" || !slug ? "#/help" : "#/help/" + slug);
  // No feedback component loaded: plain Help link, as before.
  if (typeof FB_openFeedback !== "function") {
    return (
      <button type="button" className="tb-item tb-icon-btn tb-help" aria-label={label} title={label} onClick={goHelp}>
        <TB_QuestionIcon />
      </button>
    );
  }
  return (
    <div className="tb-item tb-menu-wrap tb-help" ref={menu.rootRef} onKeyDown={menu.onMenuKeyDown}>
      <button
        ref={menu.triggerRef}
        type="button"
        className="tb-icon-btn"
        aria-label="Help and feedback"
        title="Help and feedback"
        aria-haspopup="true"
        aria-expanded={menu.open}
        onClick={() => menu.setOpen(!menu.open)}
      >
        <TB_QuestionIcon />
      </button>
      {menu.open && (
        <div className="tb-panel tb-menu" role="menu" aria-label="Help and feedback">
          <button
            type="button"
            role="menuitem"
            className="tb-menu-item"
            autoFocus
            onClick={() => {
              menu.close(false);
              goHelp();
            }}
          >
            {label}
          </button>
          {slug && page !== "help" && (
            <button
              type="button"
              role="menuitem"
              className="tb-menu-item"
              onClick={() => {
                menu.close(false);
                TB_go("#/help");
              }}
            >
              All help topics
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="tb-menu-item"
            onClick={() => {
              menu.close(false);
              FB_openFeedback();
            }}
          >
            Report a bug / feedback
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. Avatar menu
// ---------------------------------------------------------------------------
function TB_TempAccessLines({ hasTempAdminAccess, tempAdminAccessExpiresAt, isRealAdmin, impersonating }) {
  const access = typeof CS_useAccessGrants === "function" ? CS_useAccessGrants() : null;
  const grants = access ? Object.values(access.myLiveByClient || {}) : [];
  const lines = [];
  if (hasTempAdminAccess && !isRealAdmin && !impersonating)
    lines.push({
      key: "admin",
      text:
        "Temporary admin access · expires " +
        (typeof formatTempAccessExpiry === "function" ? formatTempAccessExpiry(tempAdminAccessExpiresAt) : ""),
    });
  grants.forEach((g) =>
    lines.push({
      key: g.id,
      text: `Temporary access: ${typeof CS_clientName === "function" ? CS_clientName(g.client_id) : g.client_id} · ${
        typeof CS_timeLeft === "function" ? CS_timeLeft(g.expires_at, access.now) : ""
      }`,
    }),
  );
  if (!lines.length) return null;
  return (
    <div className="tb-menu-status" role="status">
      {lines.map((l) => (
        <div key={l.key} className="tb-menu-status-line">
          <LockIcon width="12" height="12" />
          <span>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

function TB_AvatarMenu({
  staffUser,
  isRealAdmin,
  impersonating,
  onStopImpersonating,
  effectiveTheme,
  onToggleTheme,
  onSignOut,
  client,
  onPreviewAs,
  hasTempAdminAccess,
  tempAdminAccessExpiresAt,
  realEmail,
  onOpenSettings,
  previewPlan,
  actualPlan,
  onPreviewPlan,
}) {
  TB_useRootFlag("tb-has-avatar");
  const menu = TB_useMenu();
  const [showPeople, setShowPeople] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  useEffect(() => {
    if (!menu.open) {
      setShowPeople(false);
      setShowPlans(false);
    }
  }, [menu.open]);
  // Settings > Profile photo. Only the signed-in person's own, never the
  // impersonated staffer's.
  const prof = typeof ST_useMyProfile === "function" ? ST_useMyProfile(impersonating ? null : realEmail) : null;
  const photoUrl = prof && !impersonating ? prof.photoUrl : null;
  const initials = String(staffUser.name || staffUser.email || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const people = (client && client.users) || [];
  return (
    <div className="tb-item tb-menu-wrap tb-avatar" ref={menu.rootRef} onKeyDown={menu.onMenuKeyDown}>
      <button
        ref={menu.triggerRef}
        type="button"
        className="tb-avatar-btn"
        aria-label={`Account menu for ${staffUser.name}`}
        aria-haspopup="true"
        aria-expanded={menu.open}
        onClick={() => menu.setOpen(!menu.open)}
      >
        {photoUrl ? (
          <img className="staff-user-avatar tb-avatar-photo" src={photoUrl} alt="" />
        ) : (
          <span className="staff-user-avatar">{initials}</span>
        )}
      </button>
      {menu.open && (
        <div className="tb-panel tb-menu tb-menu-right" role="menu" aria-label="Account">
          <div className="tb-menu-who">
            <span className="tb-menu-name">{staffUser.name}</span>
            <span className="tb-menu-role">
              {staffUser.role}
              {impersonating ? " · View as" : ""}
            </span>
          </div>
          <TB_TempAccessLines
            hasTempAdminAccess={hasTempAdminAccess}
            tempAdminAccessExpiresAt={tempAdminAccessExpiresAt}
            isRealAdmin={isRealAdmin}
            impersonating={impersonating}
          />
          <div className="tb-menu-divider" />
          <button type="button" role="menuitem" className="tb-menu-item" autoFocus onClick={onToggleTheme}>
            {effectiveTheme === "dark" ? <SunIcon /> : <MoonIcon />}
            {effectiveTheme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          {client && people.length > 0 && (
            <>
              <button
                type="button"
                role="menuitem"
                className="tb-menu-item"
                aria-expanded={showPeople}
                onClick={() => setShowPeople((v) => !v)}
              >
                <UsersIcon />
                Preview as a client user
                <ChevronDownIcon className={"tb-chev" + (showPeople ? " open" : "")} />
              </button>
              {showPeople &&
                people.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    role="menuitem"
                    className="tb-menu-item tb-menu-sub"
                    onClick={() => {
                      menu.close(false);
                      onPreviewAs(u.id);
                    }}
                  >
                    {u.name} — {u.role}
                  </button>
                ))}
            </>
          )}
          {client && onPreviewPlan && (
            <>
              <button
                type="button"
                role="menuitem"
                className="tb-menu-item"
                aria-expanded={showPlans}
                onClick={() => setShowPlans((v) => !v)}
              >
                <LockIcon />
                Preview plan{previewPlan ? ` (${PLAN_LABELS[previewPlan]})` : ""}
                <ChevronDownIcon className={"tb-chev" + (showPlans ? " open" : "")} />
              </button>
              {showPlans &&
                [null, ...PLAN_ORDER].map((p) => {
                  const on = (previewPlan || null) === p;
                  return (
                    <button
                      key={p || "actual"}
                      type="button"
                      role="menuitemradio"
                      aria-checked={on}
                      className={"tb-menu-item tb-menu-sub" + (on ? " tb-menu-checked" : "")}
                      onClick={() => {
                        menu.close(false);
                        onPreviewPlan(p);
                      }}
                    >
                      <span className="tb-menu-check" aria-hidden="true">{on ? "✓" : ""}</span>
                      {p ? PLAN_LABELS[p] : `Actual plan (${planLabel(actualPlan)})`}
                    </button>
                  );
                })}
            </>
          )}
          {impersonating && (
            <button
              type="button"
              role="menuitem"
              className="tb-menu-item"
              onClick={() => {
                menu.close(false);
                onStopImpersonating();
              }}
            >
              Exit "View as"
            </button>
          )}
          <div className="tb-menu-divider" />
          {onOpenSettings && (
            <button
              type="button"
              role="menuitem"
              className="tb-menu-item"
              onClick={() => {
                menu.close(false);
                onOpenSettings();
              }}
            >
              <ST_GearIcon />
              Settings
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="tb-menu-item"
            onClick={() => {
              menu.close(false);
              onSignOut();
            }}
          >
            <SignOutIcon />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 9. Admin: QuickBooks sync throttled / stopped (qbo_usage_status)
// ---------------------------------------------------------------------------
// Reads the usage guard added in supabase/qbo-usage-guard.sql (same RPC the
// Team page's QuickBooks API usage card uses). If the RPC is missing or
// refuses, this renders nothing.
function TB_ThrottleBadge() {
  const [mode, setMode] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      const sb = window.mgbSupabase;
      if (!sb || document.hidden) return;
      Promise.resolve(sb.rpc("qbo_usage_status"))
        .then(({ data, error }) => {
          if (alive) setMode(!error && data ? data.mode || null : null);
        })
        .catch(() => alive && setMode(null));
    };
    load();
    const id = setInterval(load, TB_THROTTLE_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  if (mode !== "throttled" && mode !== "stopped") return null;
  const text = mode === "stopped" ? "QuickBooks syncs stopped" : "QuickBooks syncs slowed";
  const title =
    mode === "stopped"
      ? "This month's QuickBooks API calls are near Intuit's limit, so scheduled syncs are paused until the 1st. Sync now still works."
      : "This month's QuickBooks API calls are running high, so Pro clients sync less often. Open the Team page for details.";
  return (
    <button type="button" className={"tb-item tb-throttle" + (mode === "stopped" ? " stopped" : "")} title={title} onClick={() => TB_go("#/team")}>
      <WarningIcon width="13" height="13" />
      <span className="tb-throttle-text">{text}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------
function TB_StaffTopBar({
  staffUser, // effective staffer (the impersonated one during "View as")
  realStaffUser, // the person actually signed in
  impersonating,
  onStopImpersonating,
  clients,
  client, // null on staff pages
  page,
  plan,
  onSynced,
  statusOverrides,
  pendingRequestsByClient,
  effectiveTheme,
  onToggleTheme,
  onSignOut,
  onPreviewAs,
  hasTempAdminAccess,
  tempAdminAccessExpiresAt,
  clientSearch, // see TB_Search; null on staff pages
  onOpenSettings,
  previewPlan, // Preview plan (staff, this browser); undefined when not offered
  actualPlan,
  onPreviewPlan, // null on staff pages and during "View as"
}) {
  const me = realStaffUser ? realStaffUser.email : "";
  // My Tasks, the Inbox and the Close tracker are the signed-in person's own
  // and aren't reachable during "View as", so their pieces step aside then.
  const own = !impersonating;
  const items = TB_useMyItems(me, own);
  if (!staffUser || !realStaffUser) return null;
  const isRealAdmin = realStaffUser.role === "admin";
  const isAdmin = staffUser.role === "admin";
  return (
    <header className="tb-bar" aria-label="Staff toolbar">
      <div className="tb-left">
        <TB_ClientPicker
          clients={clients}
          client={client}
          staffUser={staffUser}
          statusOverrides={statusOverrides}
          pendingRequestsByClient={pendingRequestsByClient}
          impersonating={impersonating}
        />
        <TB_OverviewButton client={client} page={page} />
        <TB_SyncPill client={client} plan={plan} onSynced={onSynced} />
      </div>
      <div className="tb-middle">
        <TB_Search
          clients={clients}
          items={items}
          showMine={own}
          isAdmin={isAdmin}
          clientSearch={client ? clientSearch : null}
        />
      </div>
      <div className="tb-right">
        {isRealAdmin && own && <TB_ThrottleBadge />}
        {own && <TB_Bell clients={clients} items={items} me={me} isAdmin={isAdmin} page={page} />}
        {own && <TB_TasksBadge items={items} me={me} />}
        <TB_QuickAdd client={client} />
        <TB_HelpButton page={page} isAdmin={isAdmin} />
        {typeof FB_FeedbackHost === "function" && <FB_FeedbackHost clientId={client ? client.id : null} />}
        <TB_AvatarMenu
          staffUser={staffUser}
          isRealAdmin={isRealAdmin}
          impersonating={impersonating}
          onStopImpersonating={onStopImpersonating}
          effectiveTheme={effectiveTheme}
          onToggleTheme={onToggleTheme}
          onSignOut={onSignOut}
          client={client}
          onPreviewAs={onPreviewAs}
          hasTempAdminAccess={hasTempAdminAccess}
          tempAdminAccessExpiresAt={tempAdminAccessExpiresAt}
          realEmail={me}
          onOpenSettings={onOpenSettings}
          previewPlan={previewPlan}
          actualPlan={actualPlan}
          onPreviewPlan={onPreviewPlan}
        />
      </div>
    </header>
  );
}
