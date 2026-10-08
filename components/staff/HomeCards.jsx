// ----------------------------------------------------------------------------
// Staff Home custom cards (owner request 2026-10-05).
//
// Each staff member can add their own cards to Home, like a Pro client's
// custom cards on the Financial Overview. Four kinds:
//
// - watchlist: clients you pick by hand.
// - filter:    every client matching a rule built from menus (plan, health,
//              bills, close progress, unread messages). Updates by itself.
// - client:    one client's numbers, built with the Financial Overview card
//              builder (window.MGB_CustomCards) pointed at that client.
// - notes:     a private note plus a checklist, edited right on the card.
//
// Card defs ride inside the "bookkeeper-home" board layout (useWidgetLayout
// in app.jsx: { order, hidden, cards }), so they're saved to the person's
// account (public.user_board_layouts, one row per user) and are private to
// them. Nothing here writes client data.
//
// Loaded before app.jsx and shares its global scope, so every top-level name
// carries an HC_ prefix, and app.jsx globals (hooks, ModalShell,
// ClientHealthDot, planLabel, staffToolsApi...) are only touched at render
// or effect time.
// ----------------------------------------------------------------------------

const HC_MAX_CARDS = 12;
const HC_ROW_LIMIT = 8;
const HC_KINDS = [
  {
    kind: "watchlist",
    label: "Client watchlist",
    desc: "Clients you pick, each with health, bills, unread messages and close progress.",
  },
  {
    kind: "filter",
    label: "Filtered client list",
    desc: "Every client that matches a rule, for example \"Pro clients with overdue bills\".",
  },
  {
    kind: "client",
    label: "One client's numbers",
    desc: "Cash, income, spending or a budget line for one client, from the card builder.",
  },
  {
    kind: "notes",
    label: "Notes / checklist",
    desc: "A private note and a to-do checklist you can tick off right on Home.",
  },
];
const HC_RULES = [
  {
    key: "plan",
    label: "Plan",
    options: [
      ["any", "Any plan"],
      ["premium", "Pro"],
      ["basic", "Basic"],
    ],
  },
  {
    key: "health",
    label: "Health",
    options: [
      ["any", "Any health"],
      ["notgreen", "Red or yellow"],
      ["red", "Red"],
      ["yellow", "Yellow"],
      ["green", "Green"],
    ],
  },
  {
    key: "bills",
    label: "Bills",
    options: [
      ["any", "Any bills"],
      ["either", "Overdue or due soon"],
      ["overdue", "Has overdue bills"],
      ["soon", "Has bills due soon"],
      ["none", "Nothing overdue or due soon"],
    ],
  },
  {
    key: "close",
    label: "Month-end close",
    options: [
      ["any", "Any close progress"],
      ["unfinished", "Close not finished"],
      ["under-half", "Less than half done"],
      ["done", "Close finished"],
    ],
  },
  {
    key: "unread",
    label: "Messages",
    options: [
      ["any", "Any messages"],
      ["yes", "Has unread messages"],
      ["no", "No unread messages"],
    ],
  },
  // Hours budget (HoursBudget.jsx, supabase/client-hours-budget.sql):
  // QuickBooks Time hours this month vs client_profile.monthly_hours_budget.
  // Admins only; for anyone else (or no budget / no QuickBooks Time) it
  // matches nothing.
  {
    key: "budget",
    label: "Hours budget",
    adminOnly: true,
    options: [
      ["any", "Any hours"],
      ["near", "80% or more of budget"],
      ["over", "Over hours budget"],
    ],
  },
];
const HC_DEFAULT_RULES = { plan: "any", health: "any", bills: "any", close: "any", unread: "any", budget: "any" };

// The rules this viewer can pick (adminOnly ones need ctx.isAdmin).
function HC_rulesFor(ctx) {
  return HC_RULES.filter((f) => !f.adminOnly || (ctx && ctx.isAdmin));
}

const HC_newId = (prefix = "hc-") =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const HC_isCardId = (id) => typeof id === "string" && id.startsWith("hc-");

// Cleans a saved list: drops anything malformed so a bad row in the account
// copy can never break Home.
function HC_normalizeList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .filter(
      (c) =>
        c &&
        HC_isCardId(c.id) &&
        !seen.has(c.id) &&
        seen.add(c.id) &&
        HC_KINDS.some((k) => k.kind === c.kind),
    )
    .slice(0, HC_MAX_CARDS);
}

function HC_kindLabel(kind) {
  const k = HC_KINDS.find((x) => x.kind === kind);
  return k ? k.label : "Custom card";
}

function HC_describeRules(rules) {
  const r = { ...HC_DEFAULT_RULES, ...(rules || {}) };
  const parts = HC_RULES.filter((f) => r[f.key] !== "any").map(
    (f) => (f.options.find((o) => o[0] === r[f.key]) || [null, ""])[1],
  );
  return parts.length ? parts.join(" · ") : "All clients";
}

function HC_suggestTitle(def, clients) {
  if (!def) return "Custom card";
  if (def.kind === "watchlist") return "My watchlist";
  if (def.kind === "filter") return HC_describeRules(def.rules);
  if (def.kind === "notes") return "Notes";
  if (def.kind === "client") {
    const c = (clients || []).find((x) => x.id === def.clientId);
    const cc = window.MGB_CustomCards;
    const what = def.cc && cc ? (def.cc.title || "").trim() || cc.suggestTitle(def.cc) : "Numbers";
    return c ? `${c.name} · ${what}` : what;
  }
  return "Custom card";
}

function HC_title(def, clients) {
  return (def.title || "").trim() || HC_suggestTitle(def, clients);
}

// Last month's close checklist, done-count per client. Same query the
// Month-end close card uses (CloseProgressList in app.jsx); only runs when a
// card actually needs it. Returns null while loading or when the table
// isn't there, so cards can leave the close column blank.
function HC_useCloseCounts(enabled) {
  const [counts, setCounts] = useState(null);
  const load = useCallback(() => {
    const sb = window.mgbSupabase;
    if (!enabled || !sb) return;
    staffToolsApi.closeItemsForPeriod(sb, closePeriodFor()).then(({ data, error }) => {
      if (error) return setCounts(null);
      const map = {};
      (data || []).forEach((r) => {
        if (r.done) map[r.client_id] = (map[r.client_id] || 0) + 1;
      });
      setCounts(map);
    });
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    load();
    window.addEventListener(STAFF_TOOLS_EVENT, load);
    return () => window.removeEventListener(STAFF_TOOLS_EVENT, load);
  }, [enabled, load]);
  return enabled ? counts : null;
}

// One client's facts, shared by the watchlist and filter cards.
function HC_facts(c, ctx) {
  const health = effectiveClientHealth(c, ctx.today, ctx.statusOverrides);
  const due = ctx.dueCountByClient[c.id] || { overdue: 0, soon: 0 };
  const unread = ctx.unreadByClient[c.id] || 0;
  const close = ctx.closeCounts ? ctx.closeCounts[c.id] || 0 : null;
  // null = unknown (not admin, still loading, no budget): never matches.
  const budget = ctx.isAdmin && ctx.budgetByClient ? ctx.budgetByClient[c.id] || null : null;
  return { health, due, unread, close, budget };
}

function HC_matches(c, rules, ctx) {
  const r = { ...HC_DEFAULT_RULES, ...(rules || {}) };
  const f = HC_facts(c, ctx);
  if (r.plan !== "any" && planShownKey(c.plan) !== r.plan) return false;
  if (r.health === "notgreen" && f.health.status === "green") return false;
  if (["red", "yellow", "green"].includes(r.health) && f.health.status !== r.health) return false;
  if (r.bills === "overdue" && !f.due.overdue) return false;
  if (r.bills === "soon" && !f.due.soon) return false;
  if (r.bills === "either" && !f.due.overdue && !f.due.soon) return false;
  if (r.bills === "none" && (f.due.overdue || f.due.soon)) return false;
  if (r.close !== "any") {
    // Unknown close progress (still loading, or no table) never matches a
    // close rule, rather than guessing.
    if (f.close === null) return false;
    const total = CLOSE_CHECKLIST.length;
    if (r.close === "unfinished" && f.close >= total) return false;
    if (r.close === "under-half" && f.close >= total / 2) return false;
    if (r.close === "done" && f.close < total) return false;
  }
  if (r.unread === "yes" && !f.unread) return false;
  if (r.unread === "no" && f.unread) return false;
  if (r.budget && r.budget !== "any" && !OPS_budgetMatches(r.budget, f.budget)) return false;
  return true;
}

const HC_HEALTH_RANK = { red: 0, yellow: 1, green: 2 };
function HC_sortClients(list, ctx) {
  return list
    .map((c) => ({ c, f: HC_facts(c, ctx) }))
    .sort(
      (a, b) =>
        (HC_HEALTH_RANK[a.f.health.status] ?? 3) - (HC_HEALTH_RANK[b.f.health.status] ?? 3) ||
        (a.c.name || "").localeCompare(b.c.name || ""),
    );
}

function HC_ClientRow({ c, f, onOpen }) {
  const total = CLOSE_CHECKLIST.length;
  const chips = [];
  if (f.due.overdue) chips.push(["now", `${f.due.overdue} overdue`]);
  if (f.due.soon) chips.push(["week", `${f.due.soon} due soon`]);
  if (f.unread) chips.push(["now", `${f.unread} unread`]);
  if (f.budget && f.budget.state === "over") chips.push(["now", `Over hours budget (${f.budget.pct}%)`]);
  return (
    <li>
      <button type="button" className="hc-row" onClick={() => onOpen(c.id)}>
        <ClientHealthDot health={f.health} />
        <span className="hc-row-main">
          <span className="hc-row-name">{c.name}</span>
          <span className="hc-row-chips">
            {chips.length === 0 && <span className="hc-chip hc-chip-calm">Nothing due</span>}
            {chips.map(([tone, text]) => (
              <span key={text} className={"hc-chip hc-chip-" + tone}>
                {text}
              </span>
            ))}
          </span>
        </span>
        {f.close !== null && (
          <span className="hc-row-close" title="Last month's close checklist">
            <span className="ov-progress small" aria-hidden="true">
              <span style={{ width: `${(f.close / total) * 100}%` }} />
            </span>
            <span className="hc-row-close-n">
              {f.close}/{total}
            </span>
          </span>
        )}
      </button>
    </li>
  );
}

function HC_ClientRows({ rows, onOpen, emptyText }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className="card-subtitle hc-empty">{emptyText}</p>;
  const shown = all ? rows : rows.slice(0, HC_ROW_LIMIT);
  return (
    <>
      <ul className="hc-rows">
        {shown.map(({ c, f }) => (
          <HC_ClientRow key={c.id} c={c} f={f} onOpen={onOpen} />
        ))}
      </ul>
      {rows.length > HC_ROW_LIMIT && (
        <button type="button" className="home-todo-more" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}

// The ⋯ menu on Home's own custom cards. Same look as the Financial
// Overview card menu (.cc-menu, DailyClose.css), with the delete confirm
// inside the menu.
function HC_Menu({ title, onEdit, onDuplicate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    const esc = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (fn) => () => {
    setOpen(false);
    setConfirming(false);
    fn();
  };
  return (
    <div className="cc-menuWrap hc-menu" ref={ref}>
      <button
        type="button"
        className="cc-menuBtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Options for ${title}`}
        onClick={() => setOpen(!open)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="cc-menu" role="menu">
          {confirming ? (
            <div className="cc-menuConfirm">
              <p>Delete this card? This can't be undone.</p>
              <div className="cc-menuConfirmRow">
                <button type="button" className="cc-menuDanger" onClick={pick(onDelete)}>
                  Delete
                </button>
                <button type="button" className="cc-menuItem" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" role="menuitem" className="cc-menuItem" onClick={pick(onEdit)}>
                Edit card
              </button>
              <button type="button" role="menuitem" className="cc-menuItem" onClick={pick(onDuplicate)}>
                Duplicate
              </button>
              <button
                type="button"
                role="menuitem"
                className="cc-menuItem cc-menuItemDanger"
                onClick={() => setConfirming(true)}
              >
                Delete…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function HC_NotesBody({ def, onChange }) {
  const [text, setText] = useState(def.text || "");
  const [newItem, setNewItem] = useState("");
  // Pick up edits made elsewhere (another device, the account copy landing).
  useEffect(() => setText(def.text || ""), [def.text]);
  const items = Array.isArray(def.items) ? def.items : [];
  const saveText = () => {
    if (text !== (def.text || "")) onChange({ ...def, text });
  };
  const addItem = () => {
    const t = newItem.trim();
    if (!t) return;
    onChange({ ...def, items: [...items, { id: HC_newId("i-"), text: t.slice(0, 300), done: false }] });
    setNewItem("");
  };
  const left = items.filter((i) => !i.done).length;
  return (
    <div className="hc-notes">
      <textarea
        className="hc-notes-text"
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
        placeholder="Write a note to yourself…"
        value={text}
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
        onBlur={saveText}
        aria-label="Note"
      />
      {items.length > 0 && (
        <ul className="hc-checklist">
          {items.map((it) => (
            <li key={it.id} className={it.done ? "is-done" : ""}>
              <label>
                <input
                  type="checkbox"
                  checked={!!it.done}
                  onChange={() =>
                    onChange({
                      ...def,
                      items: items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)),
                    })
                  }
                />
                <span>{it.text}</span>
              </label>
              <button
                type="button"
                className="hc-check-remove"
                aria-label={`Remove "${it.text}"`}
                onClick={() => onChange({ ...def, items: items.filter((x) => x.id !== it.id) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="staff-add-row hc-check-add">
        <input
          type="text"
          placeholder="Add a checklist item…"
          value={newItem}
          maxLength={300}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addItem();
          }}
          aria-label="New checklist item"
        />
        <button type="button" className="btn-secondary" onClick={addItem} disabled={!newItem.trim()}>
          Add
        </button>
      </div>
      {items.length > 0 && (
        <p className="hc-foot">
          {left === 0 ? "All done ✓" : `${left} of ${items.length} left`}
          {items.some((i) => i.done) && (
            <>
              {" · "}
              <button
                type="button"
                className="cc-linkBtn"
                onClick={() => onChange({ ...def, items: items.filter((x) => !x.done) })}
              >
                Clear finished
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function HC_theme() {
  return document.documentElement.getAttribute("data-theme") || undefined;
}

// One custom card on Home. ctx carries Home's per-client data:
// { clients, today, statusOverrides, dueCountByClient, unreadByClient,
//   closeCounts, onOpenClient }.
function HC_Card({ def, ctx, dragProps, dragClass, flash, onEdit, onDuplicate, onDelete, onChange }) {
  const title = HC_title(def, ctx.clients);
  const client = def.kind === "client" ? ctx.clients.find((c) => c.id === def.clientId) : null;
  const source = useMemo(() => {
    if (!client || typeof window.dailyCloseFromClient !== "function") return null;
    try {
      return window.dailyCloseFromClient(client, client.plan).cardSource;
    } catch (e) {
      return null;
    }
  }, [client]);
  const menu = <HC_Menu title={title} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} />;
  const cls = (extra) =>
    "card home-card home-tone-keep hc-card " + extra + (flash ? " card-flash " : " ") + dragClass;

  if (def.kind === "client") {
    const CC = window.MGB_CustomCards;
    if (!client || !def.cc || !CC || !source)
      return (
        <div className={cls("hc-card-client")} {...dragProps}>
          <div className="hc-head">
            <h3 className="card-title">{title}</h3>
            {menu}
          </div>
          <p className="card-subtitle hc-empty">
            {!client
              ? "You can't see this client any more. Edit the card to pick another one, or delete it."
              : !def.cc
                ? "Choose Edit card from the ⋯ menu to pick what to show."
                : "This client's numbers couldn't be loaded right now."}
          </p>
        </div>
      );
    const Panel = CC.Panel;
    return (
      <div
        className={"hc-cc dc-dailyClose " + (flash ? "card-flash " : "") + dragClass}
        data-theme={HC_theme()}
        {...dragProps}
      >
        <Panel
          def={{ ...def.cc, title }}
          source={source}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
        <button type="button" className="hc-cc-open" onClick={() => ctx.onOpenClient(client.id)}>
          Open {client.name} →
        </button>
      </div>
    );
  }

  if (def.kind === "notes")
    return (
      <div className={cls("hc-card-notes")} {...dragProps}>
        <div className="hc-head">
          <h3 className="card-title">{title}</h3>
          {menu}
        </div>
        <HC_NotesBody def={def} onChange={onChange} />
      </div>
    );

  let rows;
  let sub;
  let foot = null;
  let emptyText;
  if (def.kind === "watchlist") {
    const ids = Array.isArray(def.clientIds) ? def.clientIds : [];
    const picked = ctx.clients.filter((c) => ids.includes(c.id));
    rows = HC_sortClients(picked, ctx);
    const gone = ids.length - picked.length;
    sub = `${picked.length} client${picked.length === 1 ? "" : "s"} you're watching, worst health first`;
    emptyText = "No clients picked yet. Choose Edit card from the ⋯ menu to add some.";
    if (gone > 0)
      foot = `${gone} client${gone === 1 ? "" : "s"} on this list ${gone === 1 ? "is" : "are"} no longer yours to see.`;
  } else {
    const matched = ctx.clients.filter((c) => HC_matches(c, def.rules, ctx));
    rows = HC_sortClients(matched, ctx);
    // An untitled filter card is already named after its rule, so the
    // subtitle says what kind of list it is instead of repeating it.
    sub = (def.title || "").trim()
      ? HC_describeRules(def.rules)
      : "Every client that matches, worst health first";
    emptyText = "No clients match right now ✓";
    foot = `${matched.length} of ${ctx.clients.length} client${ctx.clients.length === 1 ? "" : "s"} match`;
  }
  return (
    <div className={cls("hc-card-list")} {...dragProps}>
      <div className="hc-head">
        <div>
          <h3 className="card-title">{title}</h3>
          <p className="card-subtitle hc-sub">{sub}</p>
        </div>
        {menu}
      </div>
      <HC_ClientRows rows={rows} onOpen={ctx.onOpenClient} emptyText={emptyText} />
      {foot && <p className="hc-foot">{foot}</p>}
    </div>
  );
}

// Create / edit modal. For "One client's numbers" it hands off to the
// Financial Overview card builder once a client is picked.
function HC_Builder({ initial, ctx, onSave, onCancel }) {
  const isNew = !initial;
  const [kind, setKind] = useState(initial ? initial.kind : "watchlist");
  const [title, setTitle] = useState(initial ? initial.title || "" : "");
  const [clientIds, setClientIds] = useState(
    initial && Array.isArray(initial.clientIds) ? initial.clientIds : [],
  );
  const [rules, setRules] = useState({ ...HC_DEFAULT_RULES, ...((initial && initial.rules) || {}) });
  const [clientId, setClientId] = useState(
    (initial && initial.clientId) || (ctx.clients[0] && ctx.clients[0].id) || "",
  );
  const [noteText, setNoteText] = useState(initial ? initial.text || "" : "");
  const [q, setQ] = useState("");
  const [step, setStep] = useState(1);
  const CC = window.MGB_CustomCards;

  const base = { id: initial ? initial.id : HC_newId(), kind, title: title.trim().slice(0, 80) };
  const draft =
    kind === "watchlist"
      ? { ...base, clientIds }
      : kind === "filter"
        ? { ...base, rules }
        : kind === "notes"
          ? { ...base, text: noteText, items: (initial && initial.kind === "notes" && initial.items) || [] }
          : { ...base, clientId, cc: initial && initial.kind === "client" ? initial.cc : null };
  const canSave =
    kind === "watchlist" ? clientIds.length > 0 : kind === "client" ? !!clientId : true;
  const matchCount =
    kind === "filter" ? ctx.clients.filter((c) => HC_matches(c, rules, ctx)).length : 0;

  const client = ctx.clients.find((c) => c.id === clientId);
  if (kind === "client" && step === 2 && CC && client) {
    const source = window.dailyCloseFromClient(client, client.plan).cardSource;
    const Builder = CC.Builder;
    return (
      <Builder
        initial={draft.cc}
        source={source}
        theme={HC_theme()}
        addLabel="Add to Home"
        onCancel={() => setStep(1)}
        onSave={(cc) => onSave({ ...draft, title: "", cc })}
      />
    );
  }

  const shownClients = ctx.clients
    .filter((c) => (c.name || "").toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const submit = (e) => {
    e.preventDefault();
    if (!canSave) return;
    if (kind === "client") return setStep(2);
    onSave(draft);
  };

  return (
    <ModalShell onClose={onCancel} labelledBy="hc-builder-title" className="hc-builder">
      <form onSubmit={submit}>
        <div className="modal-header">
          <h3 className="card-title" id="hc-builder-title" style={{ margin: 0 }}>
            {isNew ? "New custom card" : "Edit custom card"}
          </h3>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body hc-builder-body">
          {isNew && (
            <fieldset className="hc-field">
              <legend className="hc-label">What kind of card?</legend>
              <div className="hc-kinds">
                {HC_KINDS.map((k) => (
                  <label key={k.kind} className={"hc-kind" + (kind === k.kind ? " is-on" : "")}>
                    <input
                      type="radio"
                      name="hc-kind"
                      value={k.kind}
                      checked={kind === k.kind}
                      onChange={() => setKind(k.kind)}
                    />
                    <span className="hc-kind-name">{k.label}</span>
                    <span className="hc-kind-desc">{k.desc}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {kind !== "client" && (
            <label className="hc-field">
              <span className="hc-label">Title</span>
              <input
                type="text"
                className="hc-input"
                value={title}
                maxLength={80}
                placeholder={HC_suggestTitle(draft, ctx.clients)}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
          )}

          {kind === "watchlist" && (
            <div className="hc-field">
              <span className="hc-label">
                Clients to watch <span className="hc-count">{clientIds.length} picked</span>
              </span>
              {ctx.clients.length > 6 && (
                <input
                  type="search"
                  className="hc-input"
                  placeholder="Search your clients…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label="Search your clients"
                />
              )}
              {ctx.clients.length === 0 ? (
                <p className="card-subtitle">You don't have any clients assigned yet.</p>
              ) : (
                <ul className="hc-picklist">
                  {shownClients.map((c) => (
                    <li key={c.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={clientIds.includes(c.id)}
                          onChange={() =>
                            setClientIds(
                              clientIds.includes(c.id)
                                ? clientIds.filter((x) => x !== c.id)
                                : [...clientIds, c.id],
                            )
                          }
                        />
                        <span>{c.name}</span>
                        <span className="hc-pick-plan">{planLabel(c.plan)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {kind === "filter" && (
            <div className="hc-field">
              <span className="hc-label">Show clients where…</span>
              <div className="hc-rules">
                {HC_rulesFor(ctx).map((f) => (
                  <label key={f.key} className="hc-rule">
                    <span>{f.label}</span>
                    <select
                      className="hc-input"
                      value={rules[f.key]}
                      onChange={(e) => setRules({ ...rules, [f.key]: e.target.value })}
                    >
                      {f.options.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="hc-foot" aria-live="polite">
                {matchCount} of {ctx.clients.length} client{ctx.clients.length === 1 ? "" : "s"} match right now.
                The list updates by itself as things change.
              </p>
            </div>
          )}

          {kind === "client" && (
            <label className="hc-field">
              <span className="hc-label">Which client?</span>
              {ctx.clients.length === 0 ? (
                <p className="card-subtitle">You don't have any clients assigned yet.</p>
              ) : (
                <select className="hc-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  {ctx.clients
                    .slice()
                    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              )}
              <span className="hc-help">
                Next you'll choose what to show (cash, income, spending, a budget line and so on), the same
                way as a custom card on the Financial Overview.
              </span>
            </label>
          )}

          {kind === "notes" && (
            <label className="hc-field">
              <span className="hc-label">Note (optional)</span>
              <textarea
                className="hc-input"
                rows={4}
                maxLength={4000}
                value={noteText}
                placeholder="Anything you want in front of you on Home…"
                onChange={(e) => setNoteText(e.target.value)}
              />
              <span className="hc-help">You can add checklist items right on the card. Only you can see it.</span>
            </label>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!canSave}>
            {kind === "client" ? "Next" : isNew ? "Add to Home" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
