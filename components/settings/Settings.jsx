// ----------------------------------------------------------------------------
// Settings (owner request 2026-09-30)
//
//   Staff:   #/settings                   ST_StaffSettingsPage (avatar menu >
//                                         Settings, the rail's foot, or ⌘K)
//   Clients: #/client/<id>/settings       ST_ClientSettingsPage (the gear at
//                                         the foot of the client sidebar)
//            Staff on a client's pages get the same page with the "Client
//            settings" tab (Manage access + Client details, the modals that
//            used to be two sidebar links) and the "Plan" tab (the old Plans
//            page, "enterprise-upgrade", still accepted as an alias).
//   Also:    ST_BookkeeperCard and AM_AccountManagerCard on the client
//            Dashboard (bookkeeper_public_profile / client_team_profiles RPCs
//            + staff-avatars), and AM_useTeamProfiles for reply attribution
//            on the client Messages page.
//
// Data (supabase/user-settings.sql):
//   user_settings.settings  one JSON object per signed-in person:
//     theme       "light" | "dark" | null (match my computer)
//     startPage   staff: "home" (Today) | "tasks" (Work › Tasks) | "last-client"
//                 (stored values predate the 2026-10 nav redesign; app.jsx
//                 maps them to the new pages)
//     signature   staff: plain-text email signature
//     notify      { email: { key: bool }, bell: { key: bool } }
//     name, phone client profile
//   staff_profiles          display name, title, phone, photo_path
//   client_org_settings / client_update_org_settings / client_org_team /
//   client_request_access   the client Organization tab
//
// ST_store keeps a localStorage copy (ST_CACHE_KEY) as a cache and writes to
// the server with a short debounce. It never writes while staff are in "View
// as" or previewing the portal as a client user (App calls setPaused during
// render, the same way it pauses WD_sync), so those sessions can't overwrite
// the signed-in staffer's own settings. Email preference keys and defaults
// must match supabase/functions/notification-emails (PREF) and client-emails.
//
// Loaded before app.jsx in the shared global scope: every top-level name has
// an ST_ prefix. app.jsx globals (useToast, relTime, icons, PLAN_LABELS ...)
// are only touched at render time, and hooks are used as React.*.
// ----------------------------------------------------------------------------

const ST_CACHE_KEY = "mygoodbooks_user_settings_v1";
const ST_SAVE_DEBOUNCE_MS = 700;
const ST_FIELD_DEBOUNCE_MS = 600;
const ST_AVATAR_BUCKET = "staff-avatars";
const ST_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const ST_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];
const ST_SIGNATURE_MAX = 1000;

// Email notifications. `def` must match notification-emails' PREF table.
const ST_STAFF_EMAIL_PREFS = [
  { key: "client_message", label: "A client sends a message", sub: "One email per client thread, with a link to the Inbox.", def: true },
  { key: "doc_upload", label: "A client uploads a requested document", sub: "When a document request changes to Uploaded.", def: true },
  { key: "task_assigned", label: "Someone assigns me a task", sub: "Not for tasks you give yourself or recurring template tasks.", def: true },
  { key: "task_due", label: "Tasks due today", sub: "One morning email listing your open tasks due that day.", def: false },
  { key: "feedback_status", label: "My feedback changes status", sub: "When an admin marks your feedback planned, done or declined.", def: true },
];
const ST_CLIENT_EMAIL_PREFS = [
  { key: "bookkeeper_message", label: "My bookkeeper sends me a message", sub: "A short email with a link to Messages. The message itself stays in the portal.", def: true },
  { key: "reports_ready", label: "Month-end reports are ready", sub: "When your bookkeeper finishes closing the month.", def: true },
  { key: "monthly_summary", label: "Monthly summary", sub: "A plain-language summary of the month, when your organization receives one.", def: true },
];
// Bell categories, keyed by the id prefix TB_useBellItems gives each item.
const ST_BELL_PREFS = [
  { key: "messages", prefix: "msg:", label: "Client messages waiting" },
  { key: "documents", prefix: "doc:", label: "Documents uploaded" },
  { key: "tasks", prefix: "task:", label: "Tasks assigned to me" },
  { key: "close", prefix: "close:", label: "Month-end close blocked" },
  { key: "shoutouts", prefix: "shout:", label: "Shout-outs for me" },
];
// Values are stored as-is ("home" is Today, "tasks" is Work › Tasks): the
// pages were renamed in the 2026-10 nav redesign, saved choices were not.
const ST_START_PAGES = [
  { value: "home", label: "Today", sub: "What needs you, in order." },
  { value: "tasks", label: "Work › Tasks", sub: "Straight to your task list." },
  { value: "last-client", label: "Last client opened", sub: "Pick up where you left off." },
];
const ST_THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: null, label: "Match my computer" },
];

function ST_isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function ST_merge(base, patch) {
  const out = { ...(ST_isObj(base) ? base : {}) };
  Object.keys(patch || {}).forEach((k) => {
    const v = patch[k];
    out[k] = ST_isObj(v) && ST_isObj(out[k]) ? ST_merge(out[k], v) : v;
  });
  return out;
}
function ST_lc(s) {
  return String(s || "").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
const ST_store = (function () {
  const listeners = new Set();
  const pauseReasons = new Set();
  let email = null;
  let role = null; // "staff" | "client"
  let settings = {};
  let status = "idle"; // idle | loading | ready | local
  let generation = 0;
  let saveState = "idle"; // idle | saving | saved | error
  let timer = null;
  let snapshot = null;

  const sb = () => window.mgbSupabase || null;
  const emit = () => {
    snapshot = null;
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {}
    });
  };
  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(ST_CACHE_KEY) || "null");
      return c && c.email && ST_isObj(c.settings) ? c : null;
    } catch (e) {
      return null;
    }
  }
  function writeCache() {
    try {
      if (email) localStorage.setItem(ST_CACHE_KEY, JSON.stringify({ email, settings }));
    } catch (e) {}
  }
  async function load(forEmail) {
    const client = sb();
    if (!client) {
      status = "local";
      emit();
      return;
    }
    status = "loading";
    emit();
    try {
      const { data, error } = await client.from("user_settings").select("settings").maybeSingle();
      if (forEmail !== email) return;
      if (error) {
        status = "local";
        emit();
        return;
      }
      // A local change made while the request was in flight wins.
      if (data && ST_isObj(data.settings) && !timer) settings = data.settings;
      status = "ready";
      generation += 1;
      writeCache();
      emit();
    } catch (e) {
      if (forEmail === email) {
        status = "local";
        emit();
      }
    }
  }
  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const client = sb();
    if (!client || !email || status !== "ready") return;
    const forEmail = email;
    saveState = "saving";
    emit();
    Promise.resolve(
      client.from("user_settings").upsert({ user_email: forEmail, settings }, { onConflict: "user_email" }),
    )
      .then(({ error }) => {
        if (forEmail !== email) return;
        saveState = error ? "error" : "saved";
        if (error) console.warn("Couldn't save settings:", error.message);
        emit();
      })
      .catch(() => {
        saveState = "error";
        emit();
      });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => timer && flush());
  }
  return {
    init(nextEmail, nextRole) {
      const em = ST_lc(nextEmail) || null;
      role = nextRole || null;
      if (em === email) return;
      if (timer) flush();
      email = em;
      const cache = readCache();
      settings = cache && cache.email === em ? cache.settings : {};
      saveState = "idle";
      generation += 1;
      status = "idle";
      emit();
      if (em) load(em);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    snapshot() {
      if (!snapshot)
        snapshot = { email, role, settings, status, generation, saveState, paused: pauseReasons.size > 0 };
      return snapshot;
    },
    get settings() {
      return settings;
    },
    get role() {
      return role;
    },
    get paused() {
      return pauseReasons.size > 0;
    },
    // Returns false (and changes nothing) while paused.
    update(patch) {
      if (pauseReasons.size || !email) return false;
      settings = ST_merge(settings, patch);
      writeCache();
      if (status === "ready") {
        saveState = "saving";
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, ST_SAVE_DEBOUNCE_MS);
      }
      emit();
      return true;
    },
    setPaused(reason, on) {
      const had = pauseReasons.has(reason);
      if (on) pauseReasons.add(reason);
      else pauseReasons.delete(reason);
      if (had !== !!on) snapshot = null;
    },
  };
})();

function ST_useSettings() {
  const [, force] = React.useState(0);
  React.useEffect(() => ST_store.subscribe(() => force((n) => n + 1)), []);
  return ST_store.snapshot();
}

// The staffer's email signature for drafts the app opens (portal invites,
// payment reminders). Empty for clients, for staff in "View as" or previewing
// as a client user, and when none is set.
function ST_signatureForDrafts() {
  if (ST_store.role !== "staff" || ST_store.paused) return "";
  return String(ST_store.settings.signature || "").trim().slice(0, ST_SIGNATURE_MAX);
}

// Bell filter for TB_useBellItems: false when the item's category is off.
function ST_bellAllows(settings, id) {
  const cat = ST_BELL_PREFS.find((c) => String(id || "").startsWith(c.prefix));
  if (!cat) return true;
  const bell = settings && settings.notify && settings.notify.bell;
  return !(bell && bell[cat.key] === false);
}

function ST_emailPref(settings, pref) {
  const email = settings && settings.notify && settings.notify.email;
  return email && typeof email[pref.key] === "boolean" ? email[pref.key] : pref.def;
}

// Start page from the cached copy, for the very first render of a fresh
// sign-in (app.jsx initialPage). Only trusted when it belongs to `email`.
function ST_cachedStartPage(email) {
  try {
    const c = JSON.parse(localStorage.getItem(ST_CACHE_KEY) || "null");
    if (!c || !ST_isObj(c.settings) || (email && ST_lc(c.email) !== ST_lc(email))) return null;
    const v = c.settings.startPage;
    return v === "home" || v === "tasks" || v === "last-client" ? v : null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Staff profile (staff_profiles + staff-avatars), shared by the Profile tab
// and the top bar avatar.
// ---------------------------------------------------------------------------
const ST_profile = (function () {
  const listeners = new Set();
  let email = null;
  let row = null;
  let photoUrl = null;
  let loaded = false;
  const emit = () => listeners.forEach((fn) => fn());
  async function signed(path) {
    const sb = window.mgbSupabase;
    if (!sb || !path) return null;
    try {
      const { data } = await sb.storage.from(ST_AVATAR_BUCKET).createSignedUrl(path, 3600);
      return (data && data.signedUrl) || null;
    } catch (e) {
      return null;
    }
  }
  async function load(forEmail) {
    const sb = window.mgbSupabase;
    if (!sb) return;
    const { data, error } = await sb
      .from("staff_profiles")
      .select("display_name, title, phone, photo_path")
      .maybeSingle();
    if (forEmail !== email) return;
    row = !error && data ? data : null;
    photoUrl = row && row.photo_path ? await signed(row.photo_path) : null;
    loaded = true;
    emit();
  }
  return {
    ensure(forEmail) {
      const em = ST_lc(forEmail) || null;
      if (em === email) return;
      email = em;
      row = null;
      photoUrl = null;
      loaded = false;
      emit();
      if (em) load(em);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get state() {
      return { email, row, photoUrl, loaded };
    },
    async save(patch) {
      const sb = window.mgbSupabase;
      if (!sb || !email) return { error: { message: "Not signed in" } };
      const next = { ...(row || {}), ...patch };
      const { error } = await sb.from("staff_profiles").upsert(
        {
          email,
          display_name: next.display_name || null,
          title: next.title || null,
          phone: next.phone || null,
          photo_path: next.photo_path || null,
        },
        { onConflict: "email" },
      );
      if (!error) {
        row = next;
        if ("photo_path" in patch) photoUrl = next.photo_path ? await signed(next.photo_path) : null;
        emit();
      }
      return { error };
    },
    signed,
  };
})();

function ST_useMyProfile(email) {
  const [, force] = React.useState(0);
  React.useEffect(() => ST_profile.subscribe(() => force((n) => n + 1)), []);
  React.useEffect(() => {
    if (email) ST_profile.ensure(email);
  }, [email]);
  return ST_profile.state;
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------
function ST_initials(name) {
  return (
    String(name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

function ST_Avatar({ name, url, size = 44 }) {
  return url ? (
    <img className="st-avatar" src={url} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="st-avatar st-avatar-initials" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {ST_initials(name)}
    </span>
  );
}

function ST_Toggle({ label, sub, checked, onChange, disabled, locked }) {
  const id = React.useMemo(() => "st-t-" + Math.random().toString(36).slice(2, 9), []);
  return (
    <div className={"st-row" + (disabled ? " st-row-disabled" : "")}>
      <label htmlFor={id} className="st-row-text">
        <span className="st-row-label">{label}</span>
        {sub && <span className="st-row-sub">{sub}</span>}
      </label>
      {locked ? (
        <span className="st-locked">Always on</span>
      ) : (
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="st-switch"
          checked={!!checked}
          disabled={disabled}
          aria-checked={!!checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
    </div>
  );
}

function ST_Card({ title, sub, children, actions }) {
  return (
    <section className="card st-card">
      <div className="st-card-head">
        <div>
          <h2 className="st-card-title">{title}</h2>
          {sub && <p className="st-card-sub">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function ST_Field({ label, children, hint }) {
  return (
    <label className="st-field">
      <span className="st-field-label">{label}</span>
      {children}
      {hint && <span className="st-field-hint">{hint}</span>}
    </label>
  );
}

// A text input that saves itself a moment after typing stops.
function ST_AutoInput({ value, onSave, disabled, multiline, maxLength, ...rest }) {
  const [text, setText] = React.useState(value || "");
  const dirty = React.useRef(false);
  React.useEffect(() => {
    if (!dirty.current) setText(value || "");
  }, [value]);
  React.useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      onSave(text);
    }, ST_FIELD_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const props = {
    className: "st-input" + (multiline ? " st-textarea" : ""),
    value: text,
    disabled,
    maxLength,
    onChange: (e) => {
      dirty.current = true;
      setText(e.target.value);
    },
    ...rest,
  };
  return multiline ? <textarea rows={5} {...props} /> : <input type="text" {...props} />;
}

function ST_ThemePicker({ theme, onChooseTheme, disabled }) {
  return (
    <div className="st-choices" role="radiogroup" aria-label="Theme">
      {ST_THEMES.map((t) => {
        const on = (theme || null) === t.value;
        return (
          <button
            key={String(t.value)}
            type="button"
            role="radio"
            aria-checked={on}
            className={"st-choice" + (on ? " on" : "")}
            disabled={disabled}
            onClick={() => onChooseTheme(t.value)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function ST_SavedNote({ saveState, paused }) {
  const text = paused
    ? ""
    : saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Couldn't save. Check your connection and try again."
          : "";
  return (
    <span className={"st-saved" + (saveState === "error" ? " st-saved-error" : "")} aria-live="polite" role="status">
      {text}
    </span>
  );
}

// Vertical tabs (horizontal and scrolling on phones).
function ST_Layout({ tabs, tab, onTab, header, children }) {
  const current = tabs.find((t) => t.key === tab) || tabs[0];
  const onKeyDown = (e) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.key === current.key);
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(i + d + tabs.length) % tabs.length];
    onTab(next.key);
    const el = document.getElementById("st-tab-" + next.key);
    if (el) el.focus();
  };
  return (
    <div className="st-page">
      {header}
      <div className="st-layout">
        <div className="st-tabs" role="tablist" aria-orientation="vertical" aria-label="Settings sections" onKeyDown={onKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.key}
              id={"st-tab-" + t.key}
              type="button"
              role="tab"
              aria-selected={t.key === current.key}
              aria-controls="st-panel"
              tabIndex={t.key === current.key ? 0 : -1}
              className={"st-tab" + (t.key === current.key ? " on" : "")}
              onClick={() => onTab(t.key)}
            >
              {t.label}
              {t.dot && <span className="nav-badge-dot st-tab-dot" aria-label="Needs attention" />}
            </button>
          ))}
        </div>
        <div className="st-panel" id="st-panel" role="tabpanel" aria-labelledby={"st-tab-" + current.key}>
          {children(current.key)}
        </div>
      </div>
    </div>
  );
}

function ST_ReadOnlyNote({ text }) {
  return <div className="st-note" role="note">{text}</div>;
}

// ---------------------------------------------------------------------------
// Dashboards (saved board layouts, WD_sync + localStorage)
// ---------------------------------------------------------------------------
const ST_WIDGETS_KEY = "mygoodbooks_dashboard_widgets_v1";
const ST_LIVE_LAYOUT_PREFIX = "mygoodbooks_live_report_layout_v1:";

function ST_boardLabel(key, clients) {
  const nameOf = (id) => {
    const c = (clients || []).find((x) => x.id === id);
    return c ? c.name : id;
  };
  if (key.startsWith("live-report:")) return { title: nameOf(key.slice(12)), sub: "Financial Overview" };
  const [id, scope] = key.split(":");
  // Not a client's board: the staff Home page's card layout, saved before
  // the 2026-10 nav redesign replaced that page with Today (which has no
  // board). Resetting it just clears the old row.
  if (!scope && !(clients || []).some((x) => x.id === id)) return { title: "Today (old Home layout)", sub: "Cards from the old staff Home page" };
  return { title: nameOf(id), sub: scope === "scoped" ? "Dashboard (limited view)" : "Dashboard" };
}

function ST_listBoards() {
  const keys = new Set();
  if (typeof WD_sync === "object" && WD_sync && typeof WD_sync.listRows === "function") {
    WD_sync.listRows().forEach((r) => r.layout && keys.add(r.board_key));
  }
  try {
    const local = JSON.parse(localStorage.getItem(ST_WIDGETS_KEY) || "{}");
    Object.keys(local || {}).forEach((k) => local[k] && keys.add(k));
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ST_LIVE_LAYOUT_PREFIX)) keys.add("live-report:" + k.slice(ST_LIVE_LAYOUT_PREFIX.length));
    }
  } catch (e) {}
  return Array.from(keys).sort();
}

function ST_resetBoard(key) {
  try {
    if (key.startsWith("live-report:")) {
      localStorage.removeItem(ST_LIVE_LAYOUT_PREFIX + key.slice(12));
    } else {
      const local = JSON.parse(localStorage.getItem(ST_WIDGETS_KEY) || "{}");
      if (local && local[key]) {
        delete local[key];
        localStorage.setItem(ST_WIDGETS_KEY, JSON.stringify(local));
      }
    }
  } catch (e) {}
  if (typeof WD_sync === "object" && WD_sync) WD_sync.save(key, { layout: null });
}

function ST_DashboardsCard({ clients, readOnly }) {
  const [rev, setRev] = React.useState(0);
  React.useEffect(() => {
    if (typeof WD_sync !== "object" || !WD_sync) return;
    WD_sync.ensureLoaded();
    return WD_sync.subscribe(() => setRev((n) => n + 1));
  }, []);
  const boards = React.useMemo(ST_listBoards, [rev]);
  const [done, setDone] = React.useState("");
  return (
    <ST_Card
      title="Dashboards"
      sub="Boards where you've moved or hidden cards. Reset puts a board back to the standard layout. Saved views stay."
    >
      {readOnly && <ST_ReadOnlyNote text="Layouts can't be reset while you're viewing as someone else." />}
      {boards.length === 0 ? (
        <p className="st-muted">No customized boards yet. Use Customize on a dashboard to arrange its cards.</p>
      ) : (
        <ul className="st-list">
          {boards.map((key) => {
            const l = ST_boardLabel(key, clients);
            return (
              <li key={key} className="st-list-row">
                <span className="st-row-text">
                  <span className="st-row-label">{l.title}</span>
                  <span className="st-row-sub">{l.sub}</span>
                </span>
                <button
                  type="button"
                  className="btn-secondary st-btn-sm"
                  disabled={readOnly}
                  onClick={() => {
                    ST_resetBoard(key);
                    setDone(`${l.title} (${l.sub}) is back to the standard layout.`);
                    setRev((n) => n + 1);
                  }}
                >
                  Reset
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="st-muted" aria-live="polite">{done}</p>
    </ST_Card>
  );
}

// ---------------------------------------------------------------------------
// Staff Settings page
// ---------------------------------------------------------------------------
function ST_StaffProfileCard({ staffUser, readOnly }) {
  const prof = ST_useMyProfile(staffUser && staffUser.email);
  const [msg, setMsg] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef(null);
  const row = prof.row || {};
  const save = async (patch, okText) => {
    setMsg("Saving…");
    const { error } = await ST_profile.save(patch);
    setMsg(error ? "Couldn't save: " + (error.message || "try again") : okText || "Saved");
  };
  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!ST_AVATAR_TYPES.includes(file.type)) return setMsg("Use a PNG, JPEG or WebP image.");
    if (file.size > ST_AVATAR_MAX_BYTES) return setMsg("That photo is over 2 MB. Try a smaller one.");
    const sb = window.mgbSupabase;
    if (!sb) return setMsg("Photos need a connection to the server.");
    setBusy(true);
    setMsg("Uploading…");
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${ST_lc(staffUser.email)}/avatar-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from(ST_AVATAR_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      setBusy(false);
      return setMsg("Couldn't upload: " + error.message);
    }
    const old = row.photo_path;
    await save({ photo_path: path }, "Photo updated");
    if (old && old !== path) sb.storage.from(ST_AVATAR_BUCKET).remove([old]).then(() => {}, () => {});
    setBusy(false);
  };
  const removePhoto = async () => {
    const sb = window.mgbSupabase;
    const old = row.photo_path;
    setBusy(true);
    await save({ photo_path: null }, "Photo removed");
    if (sb && old) sb.storage.from(ST_AVATAR_BUCKET).remove([old]).then(() => {}, () => {});
    setBusy(false);
  };
  const name = row.display_name || (staffUser && staffUser.name) || "";
  return (
    <ST_Card title="Profile" sub="Clients see your name, title, phone and photo on their dashboard's bookkeeper card.">
      {readOnly && <ST_ReadOnlyNote text={readOnly} />}
      <div className="st-profile-head">
        <ST_Avatar name={name} url={prof.photoUrl} size={64} />
        <div className="st-profile-actions">
          <input ref={fileRef} type="file" accept={ST_AVATAR_TYPES.join(",")} hidden onChange={onFile} />
          <button type="button" className="btn-secondary st-btn-sm" disabled={readOnly || busy} onClick={() => fileRef.current && fileRef.current.click()}>
            {row.photo_path ? "Change photo" : "Add photo"}
          </button>
          {row.photo_path && (
            <button type="button" className="st-link" disabled={readOnly || busy} onClick={removePhoto}>
              Remove photo
            </button>
          )}
          <span className="st-field-hint">PNG, JPEG or WebP, up to 2 MB.</span>
        </div>
      </div>
      <div className="st-grid">
        <ST_Field label="Name">
          <ST_AutoInput value={name} maxLength={120} disabled={!!readOnly} onSave={(v) => save({ display_name: v.trim() || null })} autoComplete="name" />
        </ST_Field>
        <ST_Field label="Title" hint='For example "Senior bookkeeper".'>
          <ST_AutoInput value={row.title} maxLength={120} disabled={!!readOnly} onSave={(v) => save({ title: v.trim() || null })} />
        </ST_Field>
        <ST_Field label="Phone">
          <ST_AutoInput value={row.phone} maxLength={40} disabled={!!readOnly} onSave={(v) => save({ phone: v.trim() || null })} autoComplete="tel" inputMode="tel" />
        </ST_Field>
        <ST_Field label="Email" hint="Your sign-in email. Ask an admin to change it.">
          <input className="st-input" value={(staffUser && staffUser.email) || ""} readOnly disabled />
        </ST_Field>
      </div>
      <p className="st-muted" aria-live="polite">{msg}</p>
    </ST_Card>
  );
}

// ---------------------------------------------------------------------------
// Firm settings (owner request 2026-09-30): the admin pages, as grouped rows
// (they're also in the top bar's ⌘K "Pages" group). Each row opens the
// existing page by its page id, so routes, deep links and gating are
// unchanged; a row with `tab` lands on that tab of a hub page (Team ›
// Hours) through NAV_go. `show`: admins everything; staff with temporary
// admin access the pages App lets them open (effectivePage), never the
// admin-only Emails, Audit log or QuickBooks usage card.
// ---------------------------------------------------------------------------
function ST_firmGroups(isAdmin, hasTempAdminAccess) {
  const anyAdmin = !!(isAdmin || hasTempAdminAccess);
  // app.jsx icons, looked up at render time (this file loads first).
  const icons = {
    RepeatIcon: typeof RepeatIcon === "function" ? RepeatIcon : null,
    ClientRosterIcon: typeof ClientRosterIcon === "function" ? ClientRosterIcon : null,
    EM_MailIcon: typeof EM_MailIcon === "function" ? EM_MailIcon : null,
    GaugeIcon: typeof GaugeIcon === "function" ? GaugeIcon : null,
    BarChartIcon: typeof BarChartIcon === "function" ? BarChartIcon : null,
    DocumentIcon: typeof DocumentIcon === "function" ? DocumentIcon : null,
    WrenchIcon: typeof WrenchIcon === "function" ? WrenchIcon : null,
  };
  const icon = (name) => {
    const C = icons[name];
    return C ? React.createElement(C, { width: 18, height: 18, strokeWidth: 1.8 }) : null;
  };
  return [
    {
      title: "People and work",
      rows: [
        { key: "templates", page: "task-templates", label: "Task templates", sub: "Recurring tasks created automatically for each client's bookkeeper.", icon: icon("RepeatIcon"), show: anyAdmin },
        { key: "roster", page: "client-access", label: "Client roster", sub: "Who at each organization is registered to sign in.", icon: icon("ClientRosterIcon"), show: anyAdmin },
      ],
    },
    {
      title: "Email and QuickBooks",
      rows: [
        { key: "emails", page: "emails", label: "Emails", sub: "Whether sending works, the weekly digest, client emails and the send log.", icon: icon("EM_MailIcon"), show: !!isAdmin && typeof EM_EmailsPage === "function", chip: "email" },
        { key: "qbo", page: "team", tab: "hours", label: "QuickBooks usage and limits", sub: "This month's Intuit API calls, sync slow-down and stop limits (on Team › Hours).", icon: icon("GaugeIcon"), show: !!isAdmin, chip: "qbo" },
      ],
    },
    {
      title: "Insight and records",
      rows: [
        { key: "usage", page: "usage-stats", label: "Usage stats", sub: "Which pages and features actually get used, most to least.", icon: icon("BarChartIcon"), show: anyAdmin },
        { key: "audit", page: "audit-log", label: "Audit log", sub: "Every change to access, fees, rates, mappings and clients.", icon: icon("DocumentIcon"), show: !!isAdmin && typeof AL_AuditLogPage === "function" },
        { key: "dev", page: "developer-tools", label: "Developer tools", sub: "Per-browser testing aids. Nothing here is shared or written to Supabase.", icon: icon("WrenchIcon"), show: anyAdmin },
      ],
    },
  ]
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.show) }))
    .filter((g) => g.rows.length);
}

// Status chips for the Emails and QuickBooks rows. Admin only, and cheap: the
// newest send attempt from each email log (the same rows the Emails page's
// setup banner reads, classified by EM_classify) and qbo_usage_status(), the
// RPC the top bar already polls. Anything that fails just leaves no chip.
function ST_useFirmStatus(enabled) {
  const [st, setSt] = React.useState({ email: null, qbo: null });
  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!enabled || !sb) return;
    let alive = true;
    const statuses = ["sent", "error", "not_configured"];
    const safe = (p) => Promise.resolve(p).then((r) => r, (e) => ({ error: e }));
    Promise.all([
      safe(sb.from("digest_runs").select("started_at, status, detail").in("status", statuses).order("started_at", { ascending: false }).limit(1)),
      safe(sb.from("client_email_log").select("created_at, status, reason").in("status", statuses).order("created_at", { ascending: false }).limit(1)),
      safe(sb.rpc("qbo_usage_status")),
    ]).then(([d, c, q]) => {
      if (!alive) return;
      let email = null;
      if (!d.error && !c.error && typeof EM_classify === "function") {
        const rows = [
          ...((d.data || []).map((r) => ({ at: r.started_at, status: r.status, detail: r.detail || "" }))),
          ...((c.data || []).map((r) => ({ at: r.created_at, status: r.status, detail: r.reason || "" }))),
        ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
        const kind = EM_classify(rows[0] || null);
        email =
          kind === "ok"
            ? { text: "Domain verified", tone: "good" }
            : kind === "domain"
              ? { text: "Domain pending", tone: "warn" }
              : kind === "none"
                ? { text: "Not checked yet", tone: "neutral" }
                : { text: "Needs attention", tone: "bad" };
      }
      let qbo = null;
      if (!q.error && q.data && Number(q.data.cap)) {
        const pct = Math.round((Number(q.data.calls || 0) / Number(q.data.cap)) * 100);
        const mode = q.data.mode;
        qbo = {
          text: `${pct}% used`,
          tone: mode === "stopped" ? "bad" : mode === "throttled" ? "warn" : "neutral",
          title: mode === "stopped" ? "Scheduled syncs stopped" : mode === "throttled" ? "Syncs slowed down" : "Normal",
        };
      }
      setSt({ email, qbo });
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return st;
}

function ST_ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ST_FirmSettings({ groups, isAdmin, onSelectPage }) {
  const status = ST_useFirmStatus(!!isAdmin);
  return (
    <>
      {groups.map((g) => (
        <ST_Card key={g.title} title={g.title}>
          <ul className="st-firm-list">
            {g.rows.map((r) => {
              const chip = r.chip ? status[r.chip] : null;
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    className="st-firm-row"
                    onClick={() => (r.tab && typeof NAV_go === "function" ? NAV_go(r.page, r.tab) : onSelectPage(r.page))}
                  >
                    <span className="st-firm-icon" aria-hidden="true">{r.icon}</span>
                    <span className="st-row-text">
                      <span className="st-row-label">
                        {r.label}
                        {chip && (
                          <span className={"st-firm-chip st-firm-chip-" + chip.tone} title={chip.title}>
                            {chip.text}
                          </span>
                        )}
                      </span>
                      <span className="st-row-sub">{r.sub}</span>
                    </span>
                    <span className="st-firm-chevron">
                      <ST_ChevronIcon />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </ST_Card>
      ))}
    </>
  );
}

function ST_StaffSettingsPage({
  staffUser,
  readOnlyReason, // text when viewing as someone else, else null
  isAdmin,
  hasTempAdminAccess,
  clients,
  theme,
  onChooseTheme,
  onSignOut,
  onSelectPage,
}) {
  const st = ST_useSettings();
  const s = st.settings || {};
  const ro = !!readOnlyReason;
  const [tab, setTab] = React.useState("profile");
  const set = (patch) => ST_store.update(patch);
  const tabs = [
    { key: "profile", label: "Profile" },
    { key: "notifications", label: "Notifications" },
    { key: "appearance", label: "Appearance & start page" },
    { key: "signature", label: "Email signature" },
    { key: "dashboards", label: "Dashboards" },
    { key: "shortcuts", label: "Shortcuts" },
    { key: "help", label: "Help" },
    ...(isAdmin || hasTempAdminAccess ? [{ key: "firm", label: "Firm settings" }] : []),
  ];
  // Help tab rows; each shows only when its module is loaded (Tour.jsx,
  // StaffGuide.jsx, Feedback.jsx). Same shape as the client Help card.
  const helpRows = [
    typeof TOUR_startStaff === "function" && {
      key: "tour",
      label: "Guided tour",
      sub: "A quick walk through Today, Inbox, Work, Clients and Team, and the top bar.",
      action: "Restart the tour",
      run: () => TOUR_startStaff(),
    },
    typeof HLP_StaffGuidePage === "function" && {
      key: "guide",
      label: "Staff guide",
      sub: "How each page works, step by step. The ? in the top bar opens the article for the page you're on.",
      action: "Open the guide",
      run: () => onSelectPage("help"),
    },
    typeof FB_openFeedback === "function" && {
      key: "feedback",
      label: "Send feedback",
      sub: "Found a bug or have an idea? Tell us what went wrong or what would help.",
      action: "Send feedback",
      run: () => FB_openFeedback(),
    },
  ].filter(Boolean);
  const header = (
    <div className="st-header">
      <ST_SavedNote saveState={st.saveState} paused={st.paused} />
      <button type="button" className="btn-secondary st-btn-sm" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
  const firmGroups = ST_firmGroups(isAdmin, hasTempAdminAccess);
  return (
    <ST_Layout tabs={tabs} tab={tab} onTab={setTab} header={header}>
      {(key) => (
        <>
          {ro && key !== "shortcuts" && key !== "firm" && key !== "profile" && <ST_ReadOnlyNote text={readOnlyReason} />}
          {key === "profile" && <ST_StaffProfileCard staffUser={staffUser} readOnly={readOnlyReason} />}
          {key === "notifications" && (
            <>
              <ST_Card
                title="Email me when"
                sub="Emails say what happened and link to the portal. They never include message text or amounts."
              >
                {ST_STAFF_EMAIL_PREFS.map((p) => (
                  <ST_Toggle
                    key={p.key}
                    label={p.label}
                    sub={p.sub}
                    checked={ST_emailPref(s, p)}
                    disabled={ro}
                    onChange={(v) => set({ notify: { email: { [p.key]: v } } })}
                  />
                ))}
              </ST_Card>
              <ST_Card title="Show in the bell" sub="What the bell in the top bar lists for you.">
                {ST_BELL_PREFS.map((p) => (
                  <ST_Toggle
                    key={p.key}
                    label={p.label}
                    checked={ST_bellAllows(s, p.prefix + "x")}
                    disabled={ro}
                    onChange={(v) => set({ notify: { bell: { [p.key]: v } } })}
                  />
                ))}
              </ST_Card>
            </>
          )}
          {key === "appearance" && (
            <>
              <ST_Card title="Theme" sub="Match my computer follows your device's light or dark setting.">
                <ST_ThemePicker theme={theme} onChooseTheme={onChooseTheme} disabled={ro} />
              </ST_Card>
              <ST_Card title="Start page" sub="Where you land after signing in. Links you open still go straight to their page.">
                <div className="st-radios" role="radiogroup" aria-label="Start page">
                  {ST_START_PAGES.map((p) => {
                    const on = (s.startPage || "home") === p.value;
                    return (
                      <label key={p.value} className={"st-radio" + (on ? " on" : "")}>
                        <input type="radio" name="st-start" checked={on} disabled={ro} onChange={() => set({ startPage: p.value })} />
                        <span className="st-row-text">
                          <span className="st-row-label">{p.label}</span>
                          <span className="st-row-sub">{p.sub}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </ST_Card>
            </>
          )}
          {key === "signature" && (
            <ST_Card
              title="Email signature"
              sub="Added to emails you send clients from the portal, portal invites, and reminder drafts you open for a client."
            >
              <ST_Field label="Signature" hint={`Plain text, up to ${ST_SIGNATURE_MAX} characters.`}>
                <ST_AutoInput
                  multiline
                  value={s.signature || ""}
                  maxLength={ST_SIGNATURE_MAX}
                  disabled={ro}
                  onSave={(v) => set({ signature: v.slice(0, ST_SIGNATURE_MAX) })}
                  placeholder={"Jane Smith\nSenior bookkeeper, MyGoodBooks\n(555) 555-0100"}
                />
              </ST_Field>
              {s.signature && (
                <div className="st-preview" aria-label="Signature preview">
                  <div className="st-preview-label">Preview</div>
                  <pre>{s.signature}</pre>
                </div>
              )}
            </ST_Card>
          )}
          {key === "dashboards" && <ST_DashboardsCard clients={clients} readOnly={ro} />}
          {key === "shortcuts" && (
            <ST_Card title="Keyboard shortcuts">
              <dl className="st-shortcuts">
                <dt><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>K</kbd></dt>
                <dd>Search clients, tasks, SOPs, help and the open client's data, or jump to any page or action (press it with nothing typed for the list)</dd>
                <dt><kbd>↑</kbd> <kbd>↓</kbd></dt>
                <dd>Move through menus, search results and these tabs</dd>
                <dt><kbd>Enter</kbd></dt>
                <dd>Open the highlighted item</dd>
                <dt><kbd>Esc</kbd></dt>
                <dd>Close a menu, search or dialog</dd>
                <dt><kbd>Tab</kbd></dt>
                <dd>Move between controls</dd>
              </dl>
            </ST_Card>
          )}
          {key === "help" && (
            <ST_Card title="Help" sub="Stuck, or something looks wrong? Start here.">
              {helpRows.length === 0 ? (
                <p className="st-muted">Help isn't available right now. Ask an admin if this keeps happening.</p>
              ) : (
                <ul className="st-list">
                  {helpRows.map((r) => (
                    <li key={r.key} className="st-list-row">
                      <span className="st-row-text">
                        <span className="st-row-label">{r.label}</span>
                        <span className="st-row-sub">{r.sub}</span>
                      </span>
                      <button type="button" className="btn-secondary st-btn-sm" onClick={r.run}>
                        {r.action}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ST_Card>
          )}
          {key === "firm" && (
            <ST_FirmSettings groups={firmGroups} isAdmin={isAdmin} onSelectPage={onSelectPage} />
          )}
        </>
      )}
    </ST_Layout>
  );
}

// ---------------------------------------------------------------------------
// Client Settings page
// ---------------------------------------------------------------------------
function ST_OrgCard({ org, onSaved }) {
  const showToast = typeof useToast === "function" ? useToast() : () => {};
  const [name, setName] = React.useState(org.name || "");
  const [address, setAddress] = React.useState(org.address || "");
  const [team, setTeam] = React.useState(null);
  const [everyone, setEveryone] = React.useState(!Array.isArray(org.summary_recipients));
  const [rcpt, setRcpt] = React.useState(new Set((org.summary_recipients || []).map(ST_lc)));
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    Promise.resolve(sb.rpc("client_org_team")).then(({ data, error }) => setTeam(error ? [] : data || []));
  }, []);
  const active = (team || []).filter((m) => m.active);
  const save = async () => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    if (!name.trim()) return setMsg("Your organization needs a name.");
    setBusy(true);
    setMsg("Saving…");
    const { error } = await sb.rpc("client_update_org_settings", {
      p_name: name.trim(),
      p_address: address.trim() || null,
      p_summary_recipients: everyone ? null : Array.from(rcpt),
    });
    setBusy(false);
    if (error) return setMsg("Couldn't save: " + error.message);
    setMsg("Saved");
    showToast("Organization details saved.");
    onSaved && onSaved();
  };
  return (
    <>
      <ST_Card title="Organization" sub="Your organization's name and address as MyGoodBooks has them.">
        <div className="st-grid">
          <ST_Field label="Organization name">
            <input className="st-input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </ST_Field>
          <ST_Field label="Mailing address">
            <textarea className="st-input st-textarea" rows={3} value={address} maxLength={500} onChange={(e) => setAddress(e.target.value)} />
          </ST_Field>
        </div>
        <fieldset className="st-fieldset">
          <legend className="st-field-label">Who gets the monthly summary</legend>
          <label className="st-radio-inline">
            <input type="radio" name="st-rcpt" checked={everyone} onChange={() => setEveryone(true)} /> Everyone on your team
          </label>
          <label className="st-radio-inline">
            <input type="radio" name="st-rcpt" checked={!everyone} onChange={() => setEveryone(false)} /> Only the people I choose
          </label>
          {!everyone && (
            <div className="st-checks">
              {team === null && <span className="st-muted">Loading your team…</span>}
              {active.map((m) => (
                <label key={m.email} className="st-check">
                  <input
                    type="checkbox"
                    checked={rcpt.has(ST_lc(m.email))}
                    onChange={(e) => {
                      const next = new Set(rcpt);
                      e.target.checked ? next.add(ST_lc(m.email)) : next.delete(ST_lc(m.email));
                      setRcpt(next);
                    }}
                  />
                  {m.name || m.email} <span className="st-muted">{m.email}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="st-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={save}>
            Save organization
          </button>
          <span className="st-muted" aria-live="polite">{msg}</span>
        </div>
      </ST_Card>
      <ST_Card title="Your team" sub="People at your organization who can sign in. Your bookkeeper manages who has access.">
        {team === null ? (
          <p className="st-muted">Loading…</p>
        ) : team.length === 0 ? (
          <p className="st-muted">No one else yet.</p>
        ) : (
          <ul className="st-list">
            {team.map((m) => (
              <li key={m.email} className="st-list-row">
                <span className="st-row-text">
                  <span className="st-row-label">{m.name || m.email}</span>
                  <span className="st-row-sub">
                    {m.email} · {m.role || "Team member"} · {m.access === "scoped" ? "Limited access" : "Full access"}
                    {m.active ? "" : " · No longer active"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <ST_RequestAccessForm />
      </ST_Card>
    </>
  );
}

function ST_RequestAccessForm() {
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ name: "", email: "", role: "", access: "full", note: "" });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const submit = async (e) => {
    e.preventDefault();
    const sb = window.mgbSupabase;
    if (!sb) return;
    setBusy(true);
    setMsg("Sending…");
    const { error } = await sb.rpc("client_request_access", {
      p_name: f.name.trim(),
      p_email: f.email.trim(),
      p_role: f.role.trim() || null,
      p_access: f.access,
      p_note: f.note.trim() || null,
    });
    setBusy(false);
    if (error) return setMsg("Couldn't send: " + error.message);
    setMsg(`Sent. Your bookkeeper will set up ${f.name.trim()} and let you know.`);
    setF({ name: "", email: "", role: "", access: "full", note: "" });
    setOpen(false);
  };
  const upd = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="st-request">
      {!open ? (
        <button type="button" className="btn-secondary st-btn-sm" onClick={() => setOpen(true)}>
          Ask us to add someone
        </button>
      ) : (
        <form className="st-grid" onSubmit={submit}>
          <ST_Field label="Name">
            <input className="st-input" required maxLength={120} value={f.name} onChange={upd("name")} />
          </ST_Field>
          <ST_Field label="Email" hint="The Google Workspace email they'll sign in with.">
            <input className="st-input" type="email" required maxLength={200} value={f.email} onChange={upd("email")} />
          </ST_Field>
          <ST_Field label="Role" hint='For example "Treasurer".'>
            <input className="st-input" maxLength={120} value={f.role} onChange={upd("role")} />
          </ST_Field>
          <ST_Field label="Access">
            <select className="st-input" value={f.access} onChange={upd("access")}>
              <option value="full">Full access</option>
              <option value="scoped">Limited (only some areas)</option>
            </select>
          </ST_Field>
          <ST_Field label="Note for your bookkeeper (optional)">
            <textarea className="st-input st-textarea" rows={2} maxLength={500} value={f.note} onChange={upd("note")} />
          </ST_Field>
          <div className="st-actions">
            <button type="submit" className="btn-primary" disabled={busy}>
              Send request
            </button>
            <button type="button" className="st-link" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <p className="st-muted" aria-live="polite">{msg}</p>
    </div>
  );
}

function ST_ClientSettingsPage({
  client,
  access,
  mode, // "client" | "staff" (bookkeeper view) | "preview" (staff previewing as a client user)
  signedInEmail,
  tab,
  onTab,
  theme,
  onChooseTheme,
  onSignOut,
  onSelectPage,
  renderPlan,
  onOpenAccess,
  onOpenDetails,
  hasPendingAccessRequests,
}) {
  const st = ST_useSettings();
  const s = st.settings || {};
  const readOnly = mode !== "client";
  const previewName = access && access.user ? access.user.name : "this person";
  const roText =
    mode === "preview"
      ? `You're previewing as ${previewName}. Their personal settings belong to them, so nothing here can be changed.`
      : null;
  const [org, setOrg] = React.useState(null);
  const [orgRev, setOrgRev] = React.useState(0);
  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (mode !== "client" || !sb) return;
    Promise.resolve(sb.rpc("client_org_settings")).then(({ data, error }) => setOrg(error ? null : data));
  }, [mode, orgRev]);
  const canEditOrg = mode === "client" && org && org.can_edit;
  const tabs =
    mode === "staff"
      ? [
          { key: "client", label: "Client settings", dot: hasPendingAccessRequests },
          { key: "plan", label: "Plan" },
        ]
      : [
          { key: "profile", label: "Profile" },
          { key: "notifications", label: "Notifications" },
          ...(canEditOrg ? [{ key: "organization", label: "Organization" }] : []),
          { key: "plan", label: "Plan" },
          { key: "appearance", label: "Appearance" },
          { key: "security", label: "Security & privacy" },
          { key: "help", label: "Help" },
        ];
  const current = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;
  const set = (patch) => ST_store.update(patch);
  const onSummaryList =
    org && Array.isArray(org.summary_recipients)
      ? org.summary_recipients.map(ST_lc).includes(ST_lc(signedInEmail))
      : true;
  const header = (
    <div className="st-header">
      {mode === "client" && <ST_SavedNote saveState={st.saveState} paused={st.paused} />}
      {mode === "client" && (
        <button type="button" className="btn-secondary st-btn-sm" onClick={onSignOut}>
          Sign out
        </button>
      )}
    </div>
  );
  return (
    <ST_Layout tabs={tabs} tab={current} onTab={onTab} header={header}>
      {(key) => (
        <>
          {roText && key !== "plan" && key !== "help" && <ST_ReadOnlyNote text={roText} />}
          {key === "client" && (
            <ST_Card
              title={`${client.name}: client settings`}
              sub="Staff only. Clients never see this tab."
            >
              <ul className="st-list">
                <li className="st-list-row">
                  <span className="st-row-text">
                    <span className="st-row-label">
                      Manage access
                      {hasPendingAccessRequests && <span className="st-pill">New request</span>}
                    </span>
                    <span className="st-row-sub">Who at {client.name} can sign in, what each person sees, and portal access requests.</span>
                  </span>
                  <button type="button" className="btn-secondary st-btn-sm" onClick={onOpenAccess}>
                    Open
                  </button>
                </li>
                <li className="st-list-row">
                  <span className="st-row-text">
                    <span className="st-row-label">Client details</span>
                    <span className="st-row-sub">Contacts, QuickBooks connection, notes, SOP and other details for this client.</span>
                  </span>
                  <button type="button" className="btn-secondary st-btn-sm" onClick={onOpenDetails}>
                    Open
                  </button>
                </li>
              </ul>
            </ST_Card>
          )}
          {key === "plan" && (renderPlan ? renderPlan() : null)}
          {key === "profile" && (
            <ST_Card title="Profile" sub="How your bookkeeper sees you in the portal.">
              <div className="st-grid">
                <ST_Field label="Name">
                  <ST_AutoInput
                    value={readOnly ? previewName : s.name || (access && access.user && access.user.name) || ""}
                    maxLength={120}
                    disabled={readOnly}
                    onSave={(v) => set({ name: v.trim().slice(0, 120) })}
                    autoComplete="name"
                  />
                </ST_Field>
                <ST_Field label="Phone">
                  <ST_AutoInput
                    value={readOnly ? "" : s.phone || ""}
                    maxLength={40}
                    disabled={readOnly}
                    onSave={(v) => set({ phone: v.trim().slice(0, 40) })}
                    autoComplete="tel"
                    inputMode="tel"
                  />
                </ST_Field>
                <ST_Field label="Email" hint="The email you sign in with. Your bookkeeper can change it for you.">
                  <input
                    className="st-input"
                    value={readOnly ? (access && access.user && access.user.email) || "" : signedInEmail || ""}
                    readOnly
                    disabled
                  />
                </ST_Field>
              </div>
            </ST_Card>
          )}
          {key === "notifications" && (
            <ST_Card title="Email me when" sub="Emails say what happened and link to the portal.">
              <ST_Toggle
                label="My bookkeeper asks for a document"
                sub="Requests and reminders for documents your bookkeeper needs. These can't be turned off, so nothing gets missed."
                locked
              />
              {ST_CLIENT_EMAIL_PREFS.map((p) => (
                <ST_Toggle
                  key={p.key}
                  label={p.label}
                  sub={
                    p.key === "monthly_summary" && org && !onSummaryList
                      ? "Your organization sends the summary only to people it picked, and you're not one of them right now."
                      : p.sub
                  }
                  checked={readOnly ? p.def : ST_emailPref(s, p)}
                  disabled={readOnly}
                  onChange={(v) => set({ notify: { email: { [p.key]: v } } })}
                />
              ))}
            </ST_Card>
          )}
          {key === "organization" && org && <ST_OrgCard org={org} onSaved={() => setOrgRev((n) => n + 1)} />}
          {key === "appearance" && (
            <ST_Card title="Theme" sub="Match my computer follows your device's light or dark setting.">
              <ST_ThemePicker theme={theme} onChooseTheme={onChooseTheme} disabled={readOnly} />
            </ST_Card>
          )}
          {key === "security" && (
            <ST_Card title="Signing in" sub="You sign in with a one-time link or code we email you, so there's no portal password to change or steal.">
              <div className="st-actions st-actions-stack">
                <button type="button" className="btn-secondary" disabled={readOnly} onClick={onSignOut}>
                  Sign out
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={readOnly}
                  onClick={async () => {
                    const sb = window.mgbSupabase;
                    try {
                      if (sb) await sb.auth.signOut({ scope: "global" });
                    } catch (e) {}
                    onSignOut();
                  }}
                >
                  Sign out on all devices
                </button>
                <span className="st-field-hint">
                  Signs you out everywhere, including phones and other computers. Use it if you signed in on a shared computer.
                </span>
              </div>
            </ST_Card>
          )}
          {key === "security" && (
            <ST_SecurityPrivacy client={client} access={access} readOnly={readOnly} onSelectPage={onSelectPage} />
          )}
          {key === "help" && (
            <ST_Card title="Help" sub="Questions about your books or the portal? Your bookkeeper is a message away.">
              <ul className="st-list">
                {typeof TOUR_start === "function" && (
                  <li className="st-list-row">
                    <span className="st-row-text">
                      <span className="st-row-label">Guided tour</span>
                      <span className="st-row-sub">
                        {mode === "preview"
                          ? "See the tour this person gets. Nothing is saved to their account."
                          : "A quick walk through the portal and how to finish setting up."}
                      </span>
                    </span>
                    <button type="button" className="btn-secondary st-btn-sm" onClick={() => TOUR_start()}>
                      {mode === "preview" ? "Preview the tour" : "Restart the tour"}
                    </button>
                  </li>
                )}
                <li className="st-list-row">
                  <span className="st-row-text">
                    <span className="st-row-label">Message your bookkeeper</span>
                  </span>
                  <button type="button" className="btn-secondary st-btn-sm" onClick={() => onSelectPage("messages")}>
                    Open Messages
                  </button>
                </li>
                <li className="st-list-row">
                  <a className="st-link" href="privacy-policy.html" target="_blank" rel="noopener noreferrer">
                    Privacy policy
                  </a>
                </li>
                <li className="st-list-row">
                  <a className="st-link" href="terms-of-service.html" target="_blank" rel="noopener noreferrer">
                    Terms of service
                  </a>
                </li>
              </ul>
            </ST_Card>
          )}
        </>
      )}
    </ST_Layout>
  );
}

// ---------------------------------------------------------------------------
// Settings > Security & privacy (owner request 2026-10-06): who can see the
// client's books and how their data is stored, kept and deleted. Every claim
// here must stay true; check with the owner before changing what it promises.
// Facts behind it: Supabase project in us-east-2 (AES-256 at rest, TLS in
// transit, daily database backups that don't include uploaded files),
// QuickBooks is read-only and its tokens are encrypted
// (supabase/qbo-token-encryption.sql), staff access via can_access_client(),
// Trash never empties on its own (supabase/document-folders.sql).
// ---------------------------------------------------------------------------
function ST_SecRow({ label, children }) {
  return (
    <li className="st-list-row">
      <span className="st-row-text">
        <span className="st-row-label">{label}</span>
        <span className="st-row-sub">{children}</span>
      </span>
    </li>
  );
}

function ST_SecurityPrivacy({ client, access, readOnly, onSelectPage }) {
  const full = !access || access.isFullAccess;
  const bk = client && client.assignedBookkeeper && client.assignedBookkeeper.name;
  const am = client && client.accountManager && client.accountManager.name;
  const team = [bk && `${bk} (your bookkeeper)`, am && am !== bk && `${am} (your account manager)`].filter(Boolean);
  const cadence =
    typeof syncCadenceLabel === "function" && typeof effectivePlan === "function"
      ? syncCadenceLabel(effectivePlan(client))
      : "";
  return (
    <>
      <ST_Card title="Who can see your books" sub="Only people you and MyGoodBooks have set up. No one else.">
        <ul className="st-list">
          <ST_SecRow label="Your access">
            {full
              ? "Full access: you can see every page your plan includes."
              : "Limited access: you see only the pages and areas your organization chose for you."}
          </ST_SecRow>
          <ST_SecRow label="Your team">
            MyGoodBooks sets up each login for your organization. To add or remove someone, or change what they can see,
            message your bookkeeper.
          </ST_SecRow>
          <ST_SecRow label="MyGoodBooks">
            {team.length ? `${team.join(" and ")} work on your books. ` : "Your bookkeeper and account manager work on your books. "}
            A few MyGoodBooks admins can see every client. Other staff can only see your books if they're assigned to
            you, or for a short time when your bookkeeper approves it. Every access change is recorded.
          </ST_SecRow>
          <ST_SecRow label="Staff-only working files">
            Your bookkeeper may keep working files with your documents that only MyGoodBooks staff can see. They're stored the same secure way as your other files and never shared
            outside MyGoodBooks.
          </ST_SecRow>
        </ul>
        <div className="st-actions">
          <button type="button" className="btn-secondary st-btn-sm" disabled={readOnly} onClick={() => onSelectPage("messages")}>
            Message your bookkeeper
          </button>
        </div>
      </ST_Card>
      <ST_Card title="How your data is stored and used">
        <ul className="st-list">
          <ST_SecRow label="QuickBooks">
            Read-only. The portal reads your QuickBooks data and never changes it.{cadence ? ` ${cadence}.` : ""} The
            connection key is encrypted. You can disconnect any time from your Intuit account settings.
          </ST_SecRow>
          <ST_SecRow label="Where it's stored">
            With Supabase, in the United States (Ohio). Everything is encrypted when stored and when sent. The portal
            is hosted by Vercel and emails are sent through Resend.
          </ST_SecRow>
          <ST_SecRow label="Backups">Account details and messages are backed up every day.</ST_SecRow>
          <ST_SecRow label="How we use it">
            Only to run the portal and do your bookkeeping. We never sell your data or use it for ads. We record which
            pages are opened so we can improve the portal.
          </ST_SecRow>
        </ul>
      </ST_Card>
      <ST_Card title="Keeping and deleting your data">
        <ul className="st-list">
          <ST_SecRow label="Documents">
            Your documents stay until they're removed. Only MyGoodBooks staff can remove them, and removed documents
            go to a Trash that never empties on its own, so nothing is lost by accident.
          </ST_SecRow>
          <ST_SecRow label="A copy, or deleting it">
            To get a copy of your data or ask us to delete it, message your bookkeeper or email{" "}
            <a className="st-link" href="mailto:admin@mygoodbooks.org">
              admin@mygoodbooks.org
            </a>
            .
          </ST_SecRow>
          <li className="st-list-row">
            <a className="st-link" href="privacy-policy.html" target="_blank" rel="noopener noreferrer">
              Privacy policy
            </a>
          </li>
          <li className="st-list-row">
            <a className="st-link" href="terms-of-service.html" target="_blank" rel="noopener noreferrer">
              Terms of service
            </a>
          </li>
        </ul>
      </ST_Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Team cards (client Dashboard): "Your account manager" and "Your bookkeeper"
//
// Both are Dashboard widgets (team-account-manager, team-bookkeeper; hide and
// reorder them in Customize) drawn in their own row under the board by
// AM_TeamRow. When one person is both, only the account manager card shows,
// titled "Your account manager and bookkeeper".
//
// Account manager: clients.account_manager_email (supabase/account-manager.sql),
// the client's main contact, emailed when the client messages. Public profile
// fields come from client_team_profiles(client_id), which also feeds the name
// and title on staff replies in the client's Messages page (AM_useTeamProfiles).
// AM_ names are this feature's top-level helpers.
// ---------------------------------------------------------------------------
const AM_DEFAULT_EMAIL = "jesse@mygoodbooks.org";
const AM_CACHE_MS = 60 * 1000;
const AM_teamCache = new Map(); // clientId -> { at, promise }

// clients row -> client.accountManager ({ name, email }) or null.
function AM_fromRow(row) {
  const email = row && row.account_manager_email ? String(row.account_manager_email).toLowerCase() : "";
  if (!email) return null;
  return { name: (row.account_manager && String(row.account_manager).trim()) || email.split("@")[0], email };
}

const AM_lower = (s) => String(s || "").trim().toLowerCase();

// client_team_profiles rows, cached a minute per client. Resolves to
// { rows, error } and never rejects.
function AM_loadTeam(clientId, force) {
  const sb = window.mgbSupabase;
  if (!sb || !clientId) return Promise.resolve({ rows: [], error: null });
  const hit = AM_teamCache.get(clientId);
  if (!force && hit && Date.now() - hit.at < AM_CACHE_MS) return hit.promise;
  const promise = Promise.resolve(sb.rpc("client_team_profiles", { p_client_id: clientId })).then(
    ({ data, error }) => ({ rows: !error && Array.isArray(data) ? data : [], error: error || null }),
    (error) => ({ rows: [], error }),
  );
  AM_teamCache.set(clientId, { at: Date.now(), promise });
  return promise;
}

// { byEmail, loaded } for a client's team. wantEmails: staff emails the
// caller needs (message authors); one missing triggers a single fresh load.
function AM_useTeamProfiles(clientId, wantEmails) {
  const [state, setState] = React.useState({ key: null, byEmail: {}, loaded: false });
  const triedRef = React.useRef("");
  const want = (wantEmails || []).map(AM_lower).filter(Boolean).sort().join(",");
  React.useEffect(() => {
    if (!clientId) return;
    let alive = true;
    const missing = state.key === clientId && want && want.split(",").some((e) => !state.byEmail[e]);
    const force = !!(missing && triedRef.current !== clientId + "|" + want);
    if (state.key === clientId && !force) return;
    if (force) triedRef.current = clientId + "|" + want;
    AM_loadTeam(clientId, force).then(({ rows }) => {
      if (!alive) return;
      const byEmail = {};
      rows.forEach((r) => {
        if (r && r.email) byEmail[AM_lower(r.email)] = r;
      });
      setState({ key: clientId, byEmail, loaded: true });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, want, state.key]);
  return state.key === clientId ? state : { key: null, byEmail: {}, loaded: false };
}

// Signed photo URL for a staff-avatars path (null while loading or none).
function AM_usePhoto(path) {
  const [url, setUrl] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    setUrl(null);
    if (path) ST_profile.signed(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

// The card itself, shared by both widgets. Looks complete with a name only.
function AM_ContactCard({ kicker, person, photo, clientId, wrapProps, className }) {
  return (
    <section className={"card st-bk-card" + (className ? " " + className : "")} aria-label={kicker} {...(wrapProps || {})}>
      <ST_Avatar name={person.name} url={photo} size={56} />
      <div className="st-bk-text">
        <span className="st-bk-kicker">{kicker}</span>
        <span className="st-bk-name">{person.name}</span>
        {person.title && <span className="st-row-sub">{person.title}</span>}
        {(person.phone || person.email) && (
          <span className="st-bk-contact">
            {person.phone && <a href={"tel:" + String(person.phone).replace(/[^\d+]/g, "")}>{person.phone}</a>}
            {person.email && <a href={"mailto:" + person.email}>{person.email}</a>}
          </span>
        )}
      </div>
      <button
        type="button"
        className="btn-secondary st-btn-sm"
        onClick={() => {
          window.location.hash = "#/client/" + encodeURIComponent(clientId) + "/messages";
        }}
      >
        Message
      </button>
    </section>
  );
}

function AM_sameAsBookkeeper(client) {
  const am = client && client.accountManager && AM_lower(client.accountManager.email);
  const bk = client && client.assignedBookkeeper && AM_lower(client.assignedBookkeeper.email);
  return !!(am && bk && am === bk);
}

// Widget definitions for the Dashboard's Customize drawer.
function AM_teamWidgetDefs(client) {
  const defs = [];
  const both = AM_sameAsBookkeeper(client);
  if (client && client.accountManager && client.accountManager.email)
    defs.push({
      id: "team-account-manager",
      group: "team",
      kind: "list",
      label: both ? "Your account manager and bookkeeper" : "Your account manager",
      description: "Your main contact, with a Message button",
    });
  if (client && client.assignedBookkeeper && !both)
    defs.push({
      id: "team-bookkeeper",
      group: "team",
      kind: "list",
      label: "Your bookkeeper",
      description: "Your bookkeeper's contact card",
    });
  return defs;
}

// The row of team cards under the Dashboard board, in layout order.
function AM_TeamRow({ client, ids, drag }) {
  if (!ids || !ids.length) return null;
  const wrap = (id) => ({ ...(drag ? drag.dragProps(id) : {}), key: id });
  return (
    <div className="am-team-row">
      {ids.map((id) => {
        const cls = drag ? drag.dragClass(id) : "";
        if (id === "team-account-manager")
          return <AM_AccountManagerCard key={id} client={client} wrapProps={wrap(id)} className={cls} />;
        if (id === "team-bookkeeper")
          return <ST_BookkeeperCard key={id} client={client} wrapProps={wrap(id)} className={cls} />;
        return null;
      })}
    </div>
  );
}

function AM_AccountManagerCard({ client, wrapProps, className }) {
  const clientId = client && client.id;
  const am = client && client.accountManager;
  const team = AM_useTeamProfiles(am ? clientId : null);
  const row = am ? team.byEmail[AM_lower(am.email)] : null;
  const photo = AM_usePhoto(row && row.photo_path);
  if (!am || !am.email) return null;
  const person = {
    name: (row && row.name) || am.name,
    title: (row && row.title) || null,
    phone: (row && row.phone) || null,
    email: am.email,
  };
  if (!person.name) return null;
  const { key, ...rest } = wrapProps || {};
  return (
    <AM_ContactCard
      kicker={AM_sameAsBookkeeper(client) ? "Your account manager and bookkeeper" : "Your account manager"}
      person={person}
      photo={photo}
      clientId={clientId}
      wrapProps={rest}
      className={className}
    />
  );
}

// Bookkeeper card: the assigned bookkeeper's public profile
// (bookkeeper_public_profile RPC + staff-avatars), falling back to the
// assigned bookkeeper's name.
function ST_BookkeeperCard({ client, wrapProps, className }) {
  const [bk, setBk] = React.useState(undefined); // undefined loading, null none
  const [photo, setPhoto] = React.useState(null);
  const clientId = client && client.id;
  React.useEffect(() => {
    let alive = true;
    const sb = window.mgbSupabase;
    const fallback = client && client.assignedBookkeeper ? { name: client.assignedBookkeeper.name, email: client.assignedBookkeeper.email } : null;
    setPhoto(null);
    if (!sb || !clientId) {
      setBk(fallback);
      return;
    }
    Promise.resolve(sb.rpc("bookkeeper_public_profile", { p_client_id: clientId })).then(async ({ data, error }) => {
      if (!alive) return;
      const row = !error && Array.isArray(data) ? data[0] : null;
      setBk(row || (error ? fallback : null));
      if (row && row.photo_path) {
        const url = await ST_profile.signed(row.photo_path);
        if (alive) setPhoto(url);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  if (!bk || !bk.name || AM_sameAsBookkeeper(client)) return null;
  const { key, ...rest } = wrapProps || {};
  return <AM_ContactCard kicker="Your bookkeeper" person={bk} photo={photo} clientId={clientId} wrapProps={rest} className={className} />;
}

// Gear icon for the Settings entry points (client sidebar, staff menus).
function ST_GearIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
