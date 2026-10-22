// Launch announcements for staff (owner request 2026-10-15): a quiet notice
// the next time someone visits after a launch, with a 1-minute tour of the
// new thing. ANN_ prefix. Not a second tour engine: the notice starts the
// ordinary staff tour engine (TOUR_StaffRoot, Tour.jsx) with the key
// "ann:<id>", and TOUR_staffTour resolves that to ANN_tour(id) below.
//
// Pieces:
//   announcements.js        the registry (ANN_REGISTRY), one entry per launch
//   announcementsLogic.js   the pure rules (who, when, how many); node-tested
//   ANN_store               loads this person's rows once per session
//                           (public.staff_announcements, supabase/
//                           staff-announcements.sql) and saves their answers.
//                           localStorage is a cache only: an answer the
//                           database hasn't taken yet is kept and retried; the
//                           stronger answer wins when the two disagree
//                           (ANN_merge), and the database guards the same rule.
//   ANN_Root                the notice, mounted for staff beside TOUR_StaffRoot
//                           and TIPS_Root in app.jsx
//   ANN_tour/ANN_tourList   the synthetic tours, for TOUR_staffTour and the
//                           ? menu, Cmd/Ctrl+K and Settings > Help
//   ANN_LaunchList          "Launches" at the top of the What's new article
//   ANN_UsageCard           admins' view in Usage Stats
//   ANN_visible()           true while the notice is on screen (Tips wait)
//
// Staff side only. If the table isn't there yet (SQL not applied) or the
// load fails, no notice shows; the Launches list and the tour entries still
// work because they come from the registry.

const ANN_CACHE_KEY = "mygoodbooks_announcements_v1";
const ANN_SETTLE_MS = 2500; // after the rows load, before the notice appears

let ANN_shownNow = false;
function ANN_visible() {
  return ANN_shownNow;
}

const ANN_store = (function () {
  const listeners = new Set();
  let email = null;
  let status = "idle"; // idle | loading | ready | unavailable
  let rows = {}; // { [announcement_id]: { status, later_count } }
  let accountStart = null;
  let hidden = []; // put away this page load (Later, Skip, tour started)
  let done = false; // an answer was given this page load: no second notice
  let pending = []; // ids whose last save didn't reach the database
  let version = 0;

  const sb = () => window.mgbSupabase || null;
  const emit = () => {
    version++;
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {}
    });
  };
  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(ANN_CACHE_KEY) || "null");
      return c && c.email === email && c.rows && typeof c.rows === "object" ? c : null;
    } catch (e) {
      return null;
    }
  }
  function writeCache() {
    try {
      if (email) localStorage.setItem(ANN_CACHE_KEY, JSON.stringify({ email, rows, pending }));
    } catch (e) {}
  }
  // One save at a time per id, each sending the row as it is by then, so a
  // late "seen" can't land after a Later or a finished tour.
  const inflight = {};
  function save(id) {
    const who = email;
    const run = (inflight[id] || Promise.resolve()).then(() => send(id, who));
    inflight[id] = run;
    return run;
  }
  function send(id, who) {
    const client = sb();
    const row = rows[id];
    if (!client || !email || email !== who || !row) return Promise.resolve();
    return client
      .from("staff_announcements")
      .upsert(
        { staff_email: email, announcement_id: id, status: row.status, later_count: row.later_count },
        { onConflict: "staff_email,announcement_id" },
      )
      .then(({ error }) => {
        pending = error ? pending.filter((p) => p !== id).concat(id) : pending.filter((p) => p !== id);
        writeCache();
      })
      .catch(() => {
        pending = pending.filter((p) => p !== id).concat(id);
        writeCache();
      });
  }
  async function load(forEmail) {
    const client = sb();
    if (!client) {
      status = "unavailable";
      emit();
      return;
    }
    status = "loading";
    emit();
    try {
      const [a, s] = await Promise.all([
        client.from("staff_announcements").select("announcement_id,status,later_count"),
        client.from("staff").select("created_at").eq("email", forEmail).maybeSingle(),
      ]);
      if (forEmail !== email) return;
      if (a.error) {
        status = "unavailable";
        emit();
        return;
      }
      const cache = readCache();
      const next = {};
      (a.data || []).forEach((r) => {
        next[r.announcement_id] = { status: r.status, later_count: r.later_count || 0 };
      });
      // An answer the database never took (offline, say) is kept and retried,
      // but never over a stronger answer the database already has. The same
      // goes for an answer given while this load was in flight.
      pending = cache && Array.isArray(cache.pending) ? cache.pending.filter((id) => cache.rows[id]) : [];
      pending.forEach((id) => {
        next[id] = ANN_merge(cache.rows[id], next[id]);
      });
      Object.keys(rows).forEach((id) => {
        next[id] = ANN_merge(rows[id], next[id]);
        if (pending.indexOf(id) === -1) pending.push(id);
      });
      rows = next;
      // The account's start decides which launches are new to this person.
      // Falls back to when Tips started for them, else nothing is shown.
      const tips = typeof ST_store !== "undefined" && ST_store.settings ? ST_store.settings.tips : null;
      accountStart = (s && s.data && s.data.created_at) || (tips && tips.startedAt) || null;
      status = "ready";
      writeCache();
      emit();
      pending.slice().forEach(save);
    } catch (e) {
      if (forEmail === email) {
        status = "unavailable";
        emit();
      }
    }
  }
  return {
    // Loads once per signed-in address per page load.
    init(forEmail) {
      const e = String(forEmail || "").trim().toLowerCase();
      if (!e || e === email) return;
      email = e;
      rows = {};
      hidden = [];
      done = false;
      pending = [];
      accountStart = null;
      load(e);
    },
    state() {
      return { status, rows, accountStart, hidden, done, version };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // action: "show" | "later" | "skip" | "tour" (see ANN_apply)
    record(id, action) {
      if (!email || !id) return;
      const before = rows[id];
      const next = ANN_apply(before, action);
      if (action === "show" && before) return;
      rows = { ...rows, [id]: next };
      if (action !== "show") {
        hidden = hidden.concat(id);
        done = true;
      }
      writeCache();
      emit();
      save(id);
    },
    // The tour started from the notice: put the notice away. The answer is
    // saved when the tour ends (ANN_store.record(id, "tour")).
    hide(id) {
      hidden = hidden.concat(id);
      done = true;
      emit();
    },
  };
})();

function ANN_useStore() {
  const [, setN] = React.useState(0);
  React.useEffect(() => ANN_store.subscribe(() => setN((n) => n + 1)), []);
  return ANN_store.state();
}

// ---- Tours (Tour.jsx asks for these) ---------------------------------------

// The synthetic tour for a launch: what TOUR_staffTour("ann:<id>") returns.
// It has no `setting`; TOUR_StaffRoot's end() records it through ANN_store.
function ANN_tour(id) {
  const a = ANN_REGISTRY.find((x) => x.id === id);
  if (!a) return null;
  return {
    key: "ann:" + a.id,
    ann: a.id,
    label: "New: " + a.title + " tour",
    // No closing period: the menus that list it add their own.
    sub: a.summary.replace(/[.\s]+$/, ""),
    available: (ctx) => !!ctx && !ctx.impersonating && ANN_audience([a], ctx).length > 0,
    steps: (ctx) => a.steps(ctx),
  };
}

// [{ key, label, sub }] of the launches this person can tour, newest first,
// for TOUR_staffTourList (the ? menu, Cmd/Ctrl+K, Settings > Help).
function ANN_tourList(ctx) {
  return ANN_REGISTRY.slice()
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
    .map((a) => ANN_tour(a.id))
    .filter((t) => t && t.available(ctx))
    .map((t) => ({ key: t.key, label: t.label, sub: t.sub }));
}

// ---- The notice -------------------------------------------------------------

function ANN_Root({ staffUser, impersonating, isPreviewingUser, hasTempAdminAccess, page }) {
  void hasTempAdminAccess;
  const email = staffUser ? String(staffUser.email || "").trim().toLowerCase() : "";
  React.useEffect(() => {
    if (email) ANN_store.init(email);
  }, [email]);
  const st = ANN_useStore();

  // Waits out a tour, Today's profile prompt and a short settle after the
  // rows load; checked once a second because none of those is React state.
  const [calm, setCalm] = React.useState(false);
  const readyAt = React.useRef(0); // set once, so moving between pages doesn't restart the wait
  React.useEffect(() => {
    if (st.status !== "ready") {
      setCalm(false);
      return undefined;
    }
    if (!readyAt.current) readyAt.current = Date.now();
    let tries = 0; // the profile-loading hold gives up after 15 checks, as tours do
    const check = () => {
      const busy =
        (typeof TOUR_staffBusy === "function" ? TOUR_staffBusy() : !!document.querySelector(".tour-root")) ||
        (typeof TOUR_staffHold === "function" && TOUR_staffHold(email, tries++));
      setCalm(!busy && Date.now() - readyAt.current >= ANN_SETTLE_MS);
    };
    check();
    const t = setInterval(check, 1000);
    return () => clearInterval(t);
  }, [st.status, email]);

  const ctx = {
    ...(typeof TOUR_staffCtx !== "undefined" ? TOUR_staffCtx : {}),
    busy: !calm, // a tour, the profile prompt or the settle wait (above)
    impersonating: !!impersonating,
    previewing: !!isPreviewingUser,
  };
  // The roles come from TOUR_staffCtx; hasTempAdminAccess is a prop only so a
  // grant arriving later re-renders this.
  const next = st.status === "ready" && !st.done ? ANN_pickNext(ANN_REGISTRY, st, ctx, Date.now()) : null;
  const id = next ? next.id : null;

  React.useEffect(() => {
    ANN_shownNow = !!id;
    return () => {
      ANN_shownNow = false;
    };
  }, [id]);
  // Shown: remember it, so an admin can see who has seen it.
  React.useEffect(() => {
    if (id) ANN_store.record(id, "show");
  }, [id]);

  if (!next) return null;
  const startTour = () => {
    ANN_store.hide(next.id);
    if (typeof TOUR_startStaff === "function") TOUR_startStaff("ann:" + next.id);
  };
  return (
    <section className="ann-notice" role="region" aria-label={"New: " + next.title}>
      <div className="ann-text">
        <span className="ann-kicker">New</span>
        <strong className="ann-title">{next.title}</strong>
        <span className="ann-summary">{next.summary}</span>
      </div>
      <div className="ann-actions">
        <button type="button" className="btn-primary" onClick={startTour}>
          Take the 1-minute tour
        </button>
        <button type="button" className="btn-secondary" onClick={() => ANN_store.record(next.id, "later")}>
          Later
        </button>
        <button type="button" className="link-btn ann-skip" onClick={() => ANN_store.record(next.id, "skip")}>
          Skip
        </button>
      </div>
    </section>
  );
}

// ---- What's new: Launches ---------------------------------------------------

// Every launch aimed at this person, newest first, each with Open and the tour.
function ANN_LaunchList() {
  const ctx = typeof TOUR_staffCtx !== "undefined" ? TOUR_staffCtx : {};
  const list = ANN_audience(ANN_REGISTRY, ctx)
    .slice()
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  if (!list.length) return null;
  return (
    <section className="ann-launches" aria-labelledby="ann-launches-title">
      <h3 id="ann-launches-title" className="ann-launches-title">
        Launches
      </h3>
      <p className="ann-launches-note">Each new product or feature has a 1-minute tour you can take again any time.</p>
      <ul>
        {list.map((a) => {
          const tour = ANN_tour(a.id);
          return (
            <li key={a.id}>
              <div className="ann-launch-text">
                <span className="ann-launch-date">{a.date}</span>
                <strong>{a.title}</strong>
                <span className="ann-summary">{a.summary}</span>
              </div>
              <div className="ann-actions">
                <a className="btn-secondary" href={a.hash}>
                  Open
                </a>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!tour || !tour.available(ctx)}
                  onClick={() => typeof TOUR_startStaff === "function" && TOUR_startStaff("ann:" + a.id)}
                >
                  Take the tour
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---- Usage Stats: who has seen what -----------------------------------------

function ANN_UsageCard() {
  const [res, setRes] = React.useState({ loading: true });
  React.useEffect(() => {
    let live = true;
    const sb = window.mgbSupabase;
    if (!sb) {
      setRes({ error: "Not connected." });
      return undefined;
    }
    sb.rpc("staff_announcement_report")
      .then(({ data, error }) => {
        if (live) setRes(error ? { error: error.message } : { rows: ANN_report(ANN_REGISTRY, data || []) });
      })
      .catch((e) => live && setRes({ error: String((e && e.message) || e) }));
    return () => {
      live = false;
    };
  }, []);
  // A launch behind a firm switch (visible()) is not listed here until it is on.
  const uctx = typeof TOUR_staffCtx !== "undefined" ? TOUR_staffCtx : {};
  const byId = {};
  ANN_REGISTRY.forEach((a) => {
    byId[a.id] = a;
  });
  const parts = [
    ["toured", "Toured"],
    ["seen", "Seen"],
    ["dismissed", "Skipped"],
    ["notYet", "Not yet"],
  ];
  return (
    <div className="card">
      <h3 className="card-title" style={{ marginBottom: 2 }}>
        Announcements
      </h3>
      <p className="card-subtitle" style={{ margin: "0 0 10px" }}>
        Who has seen, toured or skipped each launch notice. Seen includes Later.
      </p>
      {res.loading ? (
        <p className="card-subtitle">Loading…</p>
      ) : res.error ? (
        <p className="card-subtitle" role="alert">
          Couldn’t load announcements ({res.error}). The table comes from supabase/staff-announcements.sql.
        </p>
      ) : !res.rows.length ? (
        <p className="card-subtitle">No launches yet.</p>
      ) : (
        <ul className="ann-usage">
          {res.rows.filter((r) => ANN_listed(byId[r.id], uctx)).map((r) => (
            <li key={r.id}>
              <strong>{byId[r.id].title}</strong>
              <span className="ann-launch-date">{byId[r.id].date}</span>
              <div className="ann-usage-counts">
                {parts.map(([k, label]) => (
                  <details key={k}>
                    <summary>
                      {label} {r[k]}
                    </summary>
                    <span>{r.names[k].length ? r.names[k].join(", ") : "No one"}</span>
                  </details>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
