// ----------------------------------------------------------------------------
// WB_Row: the Workbench row and the parts the page and the drawer share —
// the ⋯ menu, the snooze menu, the keyboard-driven list, the Undo bar, the
// rail badge and the on/off hook (spec D1, D2, D4; addendum 2026-10-16).
//
// Browser file; loads after WB_logic.js and WB_store.js.
// ----------------------------------------------------------------------------

// On/off for this person: tk_settings.wb_enabled, their preview, or Classic
// Today. Reads the switch once per page load if no mount has yet.
function WB_useSwitch() {
  const s = WB_useStore(null, false, false);
  React.useEffect(() => {
    if (!s.flagKnown) WB_store.readFlag();
  }, []);
  return !!s.on;
}

// Display name for "Covering for Ann" (same rule as the top bar's).
function WB_personName(email) {
  const raw = String(email || "");
  if (typeof CV_nameOf === "function" && typeof CV_dir !== "undefined" && CV_dir) {
    const name = CV_nameOf(CV_dir.list, raw);
    if (name && name !== raw && name.indexOf("@") < 0) return name.split(" ")[0];
  }
  const local = raw.split("@")[0] || "";
  const first = local.split(/[._-]/)[0] || "a teammate";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function WB_pillLabel(row) {
  if (row.source === "other") {
    const map = typeof TD_KIND_LABEL !== "undefined" ? TD_KIND_LABEL : null;
    return (map && map[row.td_kind]) || "Other";
  }
  if (row.kind === "task_review" || row.kind === "gl_approve") return "Review";
  if (row.kind === "task_sent_back" || row.kind === "gl_sent_back") return "Sent back";
  if (row.kind === "client_answered" || row.kind === "gl_answer") return "Answered";
  return { task: "Task", review: "Review", message: "Message", gl: "Ledger", doc: "File" }[row.source] || "Item";
}

// Typing in a field, a dialog, a menu or a tour: leave the key alone.
function WB_keyBlocked(e) {
  if (typeof TK_shouldHandleKey === "function") {
    return !TK_shouldHandleKey(e, {
      modalOpen: !!document.querySelector(".modal-overlay, .si-drawer, .tk-drawer, [aria-modal='true']:not(.wb-panel)"),
      menuOpen: !!document.querySelector(".wb-menu, .tk-menu[role='menu']"),
      tourOpen: !!document.querySelector(".tour-root"),
      scope: "global",
    });
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return true;
  const t = e.target;
  if (!t || !t.tagName) return false;
  const tag = t.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select" || t.isContentEditable) return true;
  if (tag === "input") return ["checkbox", "radio", "button", "submit"].indexOf(String(t.type || "text").toLowerCase()) < 0;
  return false;
}

// ---- Menus -----------------------------------------------------------------
function WB_SnoozeMenu({ row, onClose, labelledBy }) {
  const [picking, setPicking] = React.useState(false);
  const [pick, setPick] = React.useState("");
  const today = WB_today();
  const min = WB_addDays(today, 1);
  const max = WB_addDays(today, WB_SNOOZE_MAX_DAYS);
  const firstRef = React.useRef(null);
  React.useEffect(() => {
    if (firstRef.current) firstRef.current.focus();
  }, []);
  const choose = (id) => {
    if (id === "date") {
      setPicking(true);
      return;
    }
    WB_store.snooze(row, id);
    onClose(true);
  };
  return (
    <div className="wb-menu wb-snooze" role="menu" aria-labelledby={labelledBy}>
      <p className="wb-menu-title">Snooze until</p>
      {WB_SNOOZE_PRESETS.map((p, i) => (
        <button key={p.id} type="button" role="menuitem" className="wb-menu-item" ref={i === 0 ? firstRef : null} onClick={() => choose(p.id)}>
          {p.label}
        </button>
      ))}
      {picking && (
        <form
          className="wb-snooze-pick"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pick) return;
            WB_store.snooze(row, "date", pick);
            onClose(true);
          }}
        >
          <label className="sr-only" htmlFor={"wb-pick-" + row.item_key}>
            Snooze until date
          </label>
          <input id={"wb-pick-" + row.item_key} type="date" min={min} max={max} value={pick} onChange={(e) => setPick(e.target.value)} autoFocus />
          <button type="submit" className="btn-primary" disabled={!pick}>
            Snooze
          </button>
        </form>
      )}
      <p className="wb-menu-note">Comes back sooner if anything changes.</p>
    </div>
  );
}

function WB_RowMenu({ row, onAction, onClose, labelledBy, hub }) {
  const items = hub ? WB_hubMenu(row) : WB_menuActions(row);
  const firstRef = React.useRef(null);
  React.useEffect(() => {
    if (firstRef.current) firstRef.current.focus();
  }, []);
  return (
    <div className="wb-menu" role="menu" aria-labelledby={labelledBy}>
      {items.map((a, i) => (
        <button
          key={a.id}
          type="button"
          role="menuitem"
          className="wb-menu-item"
          ref={i === 0 ? firstRef : null}
          data-tip={a.id === "noreply" ? "wb-noreply" : a.id === "snooze" ? "wb-snooze" : undefined}
          onClick={() => onAction(a.id)}
        >
          {a.label}
        </button>
      ))}
      {row.snoozed_until && WB_isSnoozed(row) && (
        <button
          type="button"
          role="menuitem"
          className="wb-menu-item"
          onClick={() => {
            WB_store.unsnooze(row);
            onClose(true);
          }}
        >
          Unsnooze
        </button>
      )}
    </div>
  );
}

// ---- Row -------------------------------------------------------------------
function WB_Row({ row, today, now, isCur, focused, compact, hub, menu, setMenu, onFocusRow, showOwner, firstAction }) {
  const ref = React.useRef(null);
  const menuBtn = React.useRef(null);
  const id = "wb-row-" + row.item_key.replace(/[^A-Za-z0-9_-]/g, "_");
  React.useEffect(() => {
    if (focused && ref.current && ref.current !== document.activeElement && !ref.current.contains(document.activeElement)) ref.current.focus({ preventScroll: false });
  }, [focused]);
  React.useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setMenu(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenu(null);
        if (menuBtn.current) menuBtn.current.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);

  const other = row.source === "other";
  const td = other ? row._td : null;
  const primary = hub ? WB_hubPrimary(row) : WB_primaryAction(row);
  const menuItems = hub ? WB_hubMenu(row) : WB_menuActions(row);
  const snoozed = WB_isSnoozed(row);
  const when = WB_whenText(row, today, now);
  const meta = [row.client_name, row.period ? WB_periodLabel(row.period) : null, when].filter(Boolean).join(" · ");

  const runPrimary = () => {
    if (other) {
      if (td && td.onClick) td.onClick();
      else if (td && td.actions && td.actions[0] && td.actions[0].onClick) td.actions[0].onClick();
      return;
    }
    if (!primary) return;
    if (primary.id === "start") WB_store.startTask(row);
    else if (hub) WB_hubOpen(row, "open");
    else WB_go(row, "open");
  };
  const onAction = (aid) => {
    if (aid === "snooze") {
      setMenu({ key: row.item_key, kind: "snooze" });
      return;
    }
    setMenu(null);
    if (aid === "noreply") WB_store.noReply(row);
    else if (aid === "checked") WB_store.fileChecked(row);
    else if (aid === "start") WB_store.startTask(row);
    else if (aid === "request") WB_go(row, "request");
    else if (aid === "open" && hub) WB_hubOpen(row, "open");
    else WB_go(row, "open"); // "Open full page" and, outside the hub, Open
  };
  const closeMenu = (restore) => {
    setMenu(null);
    if (restore && ref.current) ref.current.focus();
  };

  // Today rows keep their own buttons; the drawer shows only the first.
  const tdActions = other && td && td.actions ? (compact ? td.actions.slice(0, 1) : td.actions) : [];

  return (
    <li
      ref={ref}
      id={id}
      className={"wb-row wb-src-" + row.source + (focused ? " is-focused" : "") + (snoozed ? " is-snoozed" : "") + (compact ? " is-compact" : "")}
      tabIndex={isCur ? 0 : -1}
      data-wb-key={row.item_key}
      aria-label={row.title + (meta ? ", " + meta : "")}
      onFocus={() => {
        if (!isCur) onFocusRow();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onFocusRow();
      }}
    >
      <span className={"wb-pill wb-pill-" + row.source}>{WB_pillLabel(row)}</span>
      <div className="wb-row-main">
        {other && td && td.onClick ? (
          <button type="button" className="wb-row-title wb-linkish" onClick={td.onClick}>
            {row.title}
          </button>
        ) : (
          <span className="wb-row-title">{row.title}</span>
        )}
        {(meta || row.covered_for || (showOwner && row.owner_email) || (row.any_admin && !row.owner_email)) && (
          <span className="wb-row-meta">
            {meta}
            {row.covered_for && <span className="wb-tag wb-tag-cover">Covering for {WB_personName(row.covered_for)}</span>}
            {showOwner && row.owner_email && !row.covered_for && <span className="wb-tag">{WB_personName(row.owner_email)}</span>}
            {row.any_admin && !row.owner_email && <span className="wb-tag">No owner</span>}
            {snoozed && <span className="wb-tag">Snoozed</span>}
          </span>
        )}
        {row.detail && !compact && <span className="wb-row-detail">{row.detail}</span>}
      </div>
      <div className="wb-row-actions" {...(firstAction ? { "data-tour": "wb-row-action" } : {})}>
        {other
          ? tdActions.map((a) => (
              <button key={a.label} type="button" className={a.primary || tdActions.length === 1 ? "btn-primary wb-btn" : "btn-secondary wb-btn"} disabled={a.disabled} onClick={a.onClick}>
                {a.label}
              </button>
            ))
          : primary && (
              <button type="button" className="btn-primary wb-btn" onClick={runPrimary}>
                {primary.label}
              </button>
            )}
        {menuItems.length > 0 && (
          <button
            ref={menuBtn}
            type="button"
            className="wb-more"
            id={id + "-more"}
            aria-haspopup="menu"
            aria-expanded={!!menu}
            aria-label={"More actions for " + row.title}
            onClick={() => setMenu(menu ? null : { key: row.item_key, kind: "menu" })}
          >
            ⋯
          </button>
        )}
      </div>
      {menu && menu.kind === "menu" && <WB_RowMenu row={row} hub={hub} onAction={onAction} onClose={closeMenu} labelledBy={id + "-more"} />}
      {menu && menu.kind === "snooze" && <WB_SnoozeMenu row={row} onClose={closeMenu} labelledBy={id + "-more"} />}
    </li>
  );
}

// ---- List with keys (spec D4) -----------------------------------------------
// view: WB_build output. onChip(id) for 0-6. onHelp for "?".
function WB_List({ view, today, now, compact, hub, onChip, onHelp, showOwner, listId }) {
  const flat = React.useMemo(() => {
    const out = [];
    (view.groups || []).forEach((g) => g.rows.forEach((r) => out.push(r)));
    return out;
  }, [view]);
  const [focusKey, setFocusKey] = React.useState(null);
  const [menu, setMenu] = React.useState(null);
  const [active, setActive] = React.useState(false);
  const listRef = React.useRef(null);
  // This list's row (the page and the drawer can both be on screen).
  const rowEl = (key) =>
    listRef.current && listRef.current.querySelector('[data-wb-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
  const focusIdx = Math.max(
    0,
    flat.findIndex((r) => r.item_key === focusKey),
  );
  const cur = flat[focusIdx] || null;

  // After s or e takes the focused row off the list, focus moves to the row
  // that took its place, so j / k / Enter keep working.
  const lastIdx = React.useRef(0);
  const pending = React.useRef(false);
  if (focusKey) {
    const i = flat.findIndex((r) => r.item_key === focusKey);
    if (i >= 0) lastIdx.current = i;
  }
  React.useEffect(() => {
    if (!pending.current || !focusKey || flat.some((r) => r.item_key === focusKey)) return;
    pending.current = false;
    const nk = flat[Math.min(lastIdx.current, flat.length - 1)];
    if (!nk) return;
    setFocusKey(nk.item_key);
    setTimeout(() => {
      const ae = document.activeElement;
      if (ae && ae !== document.body && document.contains(ae)) return;
      const el = rowEl(nk.item_key);
      if (el) el.focus();
    }, 0);
  }, [flat]);

  const onKeyDown = (e) => {
    if (menu) return;
    const t = e.target;
    if (t && t.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (t && t.isContentEditable) return;
    const act = WB_keyAction(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
    if (!act) return;
    // Enter on a button inside a row clicks that button, as usual.
    if (act.type === "primary" && t && t.tagName === "BUTTON") return;
    e.preventDefault();
    e.stopPropagation();
    if (act.type === "move") {
      const next = flat[Math.min(flat.length - 1, Math.max(0, focusIdx + act.delta))];
      if (next) setFocusKey(next.item_key);
      return;
    }
    if (act.type === "chip") {
      if (onChip) onChip(act.chip);
      return;
    }
    if (act.type === "help") {
      if (onHelp) onHelp();
      return;
    }
    if (!cur) return;
    if (act.type === "primary") {
      const el = rowEl(cur.item_key);
      const btn = el && (el.querySelector(".wb-row-actions .btn-primary") || el.querySelector(".wb-row-actions button:not(.wb-more)"));
      if (btn) btn.click();
    } else if (act.type === "open") {
      if (cur.source === "other") {
        if (cur._td && cur._td.onClick) cur._td.onClick();
      } else WB_go(cur, "open");
    } else if (act.type === "snooze") {
      if (cur.source !== "other") {
        setFocusKey(cur.item_key);
        pending.current = true;
        setMenu({ key: cur.item_key, kind: "snooze" });
      }
    } else if (act.type === "clear") {
      const c = WB_clearAction(cur);
      if (c) {
        setFocusKey(cur.item_key);
        pending.current = true;
      }
      if (c === "noreply") WB_store.noReply(cur);
      else if (c === "checked") WB_store.fileChecked(cur);
    }
  };

  let first = true;
  return (
    <div
      ref={listRef}
      className={"wb-list" + (compact ? " is-compact" : "")}
      id={listId}
      data-tour={compact ? undefined : "wb-list"}
      onKeyDown={onKeyDown}
      onFocus={() => setActive(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setActive(false);
      }}
    >
      {(view.groups || []).map((g) => (
        <section key={g.id} className={"wb-group wb-group-" + g.id} aria-labelledby={(listId || "wb") + "-g-" + g.id}>
          <h3 className="wb-group-head" id={(listId || "wb") + "-g-" + g.id}>
            <span className="wb-group-dot" aria-hidden="true" />
            {g.label}
            <span className="wb-group-count">{g.rows.length}</span>
          </h3>
          <ul className="wb-rows" role="list">
            {g.rows.map((r) => {
              const isFirst = first;
              first = false;
              return (
                <WB_Row
                  key={r.item_key}
                  row={r}
                  today={today}
                  now={now}
                  compact={compact}
                  hub={hub}
                  showOwner={showOwner}
                  firstAction={isFirst && !compact}
                  isCur={!!cur && cur.item_key === r.item_key}
                  focused={active && !!cur && cur.item_key === r.item_key}
                  menu={menu && menu.key === r.item_key ? menu : null}
                  setMenu={setMenu}
                  onFocusRow={() => setFocusKey(r.item_key)}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---- Undo (5 s) ---------------------------------------------------------------
function WB_UndoBar() {
  const s = WB_useStore(null, false, false);
  if (!s.undo) return null;
  return (
    <div className="wb-undo" role="status" aria-live="polite">
      <span>{s.undo.text}</span>
      <button type="button" className="wb-undo-btn" onClick={() => WB_store.runUndo()}>
        Undo
      </button>
      <button type="button" className="wb-undo-x" aria-label="Dismiss" onClick={() => WB_store.dismissUndo()}>
        ×
      </button>
    </div>
  );
}

// ---- Rail badge: Overdue + Today (spec E3) ------------------------------------
// expanded false (the narrow rail): a dot instead of the number.
function WB_NavBadge({ expanded = true }) {
  const s = WB_useStore(null, false, false);
  const n = React.useMemo(() => (s.on && s.status === "ready" ? WB_build(s.rows, { chip: "all" }).badge : 0), [s.on, s.status, s.rows]);
  if (!n) return null;
  if (!expanded) return <span className="nav-badge-dot staff-rail-dot" aria-label={n + " due today or overdue"} />;
  return (
    <span className="wb-nav-badge" aria-label={n + " due today or overdue"}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

// ---- Shortcut sheet ------------------------------------------------------------
function WB_KeysSheet({ onClose }) {
  const rows = [
    ["D", "Open or close the " + WB_NAME],
    ["← / →", "With the " + WB_NAME + "'s left edge focused, make it wider or narrower (Page Up / Page Down: next width stop; Home / End: narrowest / widest)"],
    ["j / k", "Next / previous item"],
    ["Enter", "Main action"],
    ["o", "Open where it lives"],
    ["s", "Snooze"],
    ["e", "No reply needed (message) or Mark checked (file)"],
    ["1-6, 0", "Pick a filter, 0 for All"],
    ["← / →", "With a tab selected, move between the Desk's tabs (Inbox, Slate, Client)"],
    ["Esc", "With focus in the " + WB_NAME + ", close the top layer: a menu, the client list, a task or chat drawer, then the " + WB_NAME],
  ];
  return typeof ModalShell === "function" ? (
    <ModalShell onClose={onClose} labelledBy="wb-keys-title" className="confirm-modal">
      <div className="modal-header">
        <h3 className="card-title" id="wb-keys-title" style={{ margin: 0 }}>
          {WB_NAME} shortcuts
        </h3>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <p className="card-subtitle">Click an item first; keys work while the list has focus, never while you type.</p>
        <dl className="wb-keys">
          {rows.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
    </ModalShell>
  ) : null;
}
