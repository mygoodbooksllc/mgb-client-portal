// ----------------------------------------------------------------------------
// Guided tour for new client users (owner request 2026-09-30).
//
// A spotlight tour: the page dims, the target element is cut out and
// highlighted, and a small popover explains it (title, a sentence or two,
// "Step 3 of 8", Back / Next / Skip tour). After the tour a small "Get set up"
// checklist card sits at the top of the client Dashboard until dismissed
// (or the page the app opens instead, for someone without a Dashboard).
//
// Targets are marked with data-tour="..." attributes:
//   customize        Customize dashboard button (WidgetDrawer.jsx)
//   milestone        the milestone pill heading the client sidebar (app.jsx)
//   nav-<tab key>    client sidebar tabs (app.jsx Sidebar): nav-dashboard,
//                    nav-bank, nav-receivables, nav-budget, nav-reports,
//                    nav-documents, nav-messages
//   settings         the sidebar Settings gear (app.jsx Sidebar)
// A step whose target isn't on the page for this person (limited access, a
// tab not on their plan, a missing element) is left out of the tour.
//
// State lives in the settings JSON of public.user_settings under `tour`
// (supabase/user-settings.sql), written through ST_store (Settings.jsx), which
// also keeps the localStorage cache:
//   tour.status              "started" | "done" | "skipped"
//   tour.startedAt/endedAt   ISO timestamps
//   tour.checklist           { profile, notifications, invite, document, message: true }
//   tour.checklistDismissed  true once the card is closed
//   tour.home                where the checklist shows for someone with no
//                            Dashboard tab (Basic plan, limited access)
// It starts on its own only for a signed-in client user who has no tour
// status yet. Never for staff, "View as", or "Preview as a client user".
// Staff previewing can start it from client Settings > Help to see what the
// client sees; ST_store is paused then, so nothing is saved.
//
// Loaded before app.jsx in the shared global scope: every top-level name has
// a TOUR_ prefix, hooks are used as React.*, and app.jsx / Settings.jsx
// globals (ST_store, ST_useSettings) are only touched at render time.
// ----------------------------------------------------------------------------

const TOUR_START_EVENT = "mgb:tour-start";
const TOUR_DRAWER_QUERY =
  "(max-width: 760px) and (hover: none), (max-width: 760px) and (pointer: coarse)";
const TOUR_PAD = 6; // spotlight padding around the target
const TOUR_GAP = 12; // popover distance from the spotlight
const TOUR_MARGIN = 16; // popover distance from the viewport edge

// Starts the tour. Settings > Help calls this; anything else can too.
function TOUR_start() {
  try {
    window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
  } catch (e) {}
}

function TOUR_isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function TOUR_find(key) {
  const els = document.querySelectorAll('[data-tour="' + key + '"]');
  for (let i = 0; i < els.length; i++) {
    // display:none (and hidden ancestors) give no client rects.
    if (els[i].getClientRects().length > 0) return els[i];
  }
  return null;
}

function TOUR_inDrawerMode() {
  return typeof window.matchMedia === "function" && window.matchMedia(TOUR_DRAWER_QUERY).matches;
}

function TOUR_inSidebar(el) {
  return !!(el && el.closest && el.closest(".sidebar"));
}

// Step definitions. `targets` are tried in order; the first on the page wins.
// Steps without targets are centered (welcome, done).
function TOUR_steps(ctx) {
  const name = ctx.clientName || "your organization";
  return [
    {
      id: "welcome",
      title: "Welcome to your portal",
      body: () =>
        `This quick tour shows you around ${name}'s books and how to finish setting up your account. It takes about a minute.`,
    },
    {
      id: "dashboard",
      targets: ["customize", "nav-dashboard"],
      title: "Your dashboard",
      body: (key) =>
        key === "customize"
          ? "Your financial snapshot at a glance. Use Customize dashboard to pick which cards show and put them in the order you like."
          : "Your financial snapshot at a glance, kept up to date by your bookkeeper.",
    },
    {
      id: "milestone",
      targets: ["milestone"],
      title: "Your milestone",
      body: () =>
        "This shows where your organization stands on MyGoodBooks pricing. Open it to see what's included and what's next.",
    },
    {
      id: "bank",
      targets: ["nav-bank"],
      title: "Bank accounts",
      body: () => "Balances and recent activity for the bank accounts and credit cards in your books.",
    },
    {
      id: "cash-flow",
      targets: ["nav-receivables"],
      title: "Cash flow",
      body: () => "See money coming in and bills going out, so you know what's owed to you and what you owe.",
    },
    {
      id: "budget",
      targets: ["nav-budget"],
      title: "Budget",
      body: () => "Compare what you planned to spend with what you actually spent, category by category.",
    },
    {
      id: "reports",
      targets: ["nav-reports"],
      title: "Reports",
      body: () => "Download your financial statements and summaries, like the profit and loss and balance sheet.",
    },
    {
      id: "documents",
      targets: ["nav-documents"],
      title: "Documents",
      body: () =>
        "When your bookkeeper asks for something, like a bank statement or a receipt, upload it here. You'll see a reminder until it's in.",
    },
    {
      id: "messages",
      targets: ["nav-messages"],
      title: "Messages",
      body: () => "Talk to your bookkeeper here. Ask a question any time, and you'll get an email when they reply.",
    },
    {
      id: "settings",
      targets: ["settings"],
      title: "Settings",
      body: () =>
        ctx.fullAccess
          ? "Update your profile and email notifications, invite teammates under Organization, and see your plan."
          : "Update your profile and email notifications, and see your plan.",
    },
    {
      id: "done",
      title: "You're all set",
      body: () =>
        ctx.withChecklist
          ? "A short setup checklist is waiting at the top of the page. You can restart this tour any time from Settings, under Help."
          : "You can restart this tour any time from Settings, under Help.",
    },
  ];
}

// The steps this person will actually see: centered steps always, others
// only when one of their targets is on the page.
function TOUR_visibleSteps(ctx) {
  return TOUR_steps(ctx).filter(
    (s) =>
      !s.targets ||
      s.targets.some(
        (k) => (!k.startsWith("nav-") || !ctx.tabs || ctx.tabs.has(k.slice(4))) && document.querySelector('[data-tour="' + k + '"]'),
      ),
  );
}

// Where the popover goes, given the spotlight rect and the popover size.
function TOUR_place(rect, w, h) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const M = TOUR_MARGIN;
  const clampX = (x) => Math.max(M, Math.min(x, vw - w - M));
  const clampY = (y) => Math.max(M, Math.min(y, vh - h - M));
  if (!rect) return { top: clampY((vh - h) / 2), left: clampX((vw - w) / 2), side: "center" };
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (rect.right + TOUR_GAP + w + M <= vw) return { top: clampY(cy - h / 2), left: rect.right + TOUR_GAP, side: "right" };
  if (rect.bottom + TOUR_GAP + h + M <= vh) return { top: rect.bottom + TOUR_GAP, left: clampX(cx - w / 2), side: "bottom" };
  if (rect.top - TOUR_GAP - h >= M) return { top: rect.top - TOUR_GAP - h, left: clampX(cx - w / 2), side: "top" };
  if (rect.left - TOUR_GAP - w >= M) return { top: clampY(cy - h / 2), left: rect.left - TOUR_GAP - w, side: "left" };
  // Nothing fits beside it (phone, tall target): pin to the bottom edge.
  return { top: vh - h - M, left: clampX((vw - w) / 2), side: "bottom-edge" };
}

// ---------------------------------------------------------------------------
// Spotlight + popover
// ---------------------------------------------------------------------------
function TOUR_Overlay({ steps, index, onBack, onNext, onSkip, onFinish, setMobileNavOpen }) {
  const step = steps[index];
  const total = steps.length;
  const isLast = index === total - 1;
  const [rect, setRect] = React.useState(null);
  const [targetKey, setTargetKey] = React.useState(null);
  const [pos, setPos] = React.useState(null);
  const [ready, setReady] = React.useState(false);
  const popRef = React.useRef(null);
  const titleRef = React.useRef(null);
  const elRef = React.useRef(null);
  const drawerOpenedRef = React.useRef(false);
  const titleId = "tour-title";
  const bodyId = "tour-body";

  const measure = React.useCallback(() => {
    const el = elRef.current;
    if (!el || !el.isConnected) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Off screen or collapsed: center the popover instead.
    if (r.width === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
      setRect(null);
      return;
    }
    setRect({
      top: Math.max(0, r.top - TOUR_PAD),
      left: Math.max(0, r.left - TOUR_PAD),
      width: r.width + TOUR_PAD * 2,
      height: r.height + TOUR_PAD * 2,
      right: r.right + TOUR_PAD,
      bottom: r.bottom + TOUR_PAD,
    });
  }, []);

  // Find the target, open the phone drawer for sidebar steps, scroll it
  // into view, then measure.
  React.useEffect(() => {
    let cancelled = false;
    setReady(false);
    let el = null;
    let key = null;
    for (const k of step.targets || []) {
      el = TOUR_find(k);
      if (el) {
        key = k;
        break;
      }
    }
    // On a phone the sidebar tabs sit in the off-canvas drawer, so a hidden
    // drawer still gives rects: find() can't tell, so check the class.
    const needsDrawer = !!el && TOUR_inSidebar(el) && TOUR_inDrawerMode();
    let wait = 0;
    if (needsDrawer && !drawerOpenedRef.current) {
      setMobileNavOpen(true);
      drawerOpenedRef.current = true;
      wait = 280;
    } else if (!needsDrawer && drawerOpenedRef.current) {
      setMobileNavOpen(false);
      drawerOpenedRef.current = false;
      wait = 280;
    }
    elRef.current = el;
    setTargetKey(key);
    // The drawer slides in; measure again once it has settled.
    const sidebar = wait ? document.querySelector(".sidebar") : null;
    const onSettled = () => {
      if (cancelled) return;
      if (el && el.isConnected) {
        try {
          el.scrollIntoView({ block: "nearest", inline: "nearest" });
        } catch (e) {}
      }
      measure();
    };
    if (sidebar) sidebar.addEventListener("transitionend", onSettled);
    const t2 = wait ? setTimeout(onSettled, 650) : 0;
    const t = setTimeout(() => {
      if (cancelled) return;
      if (el && el.isConnected) {
        try {
          el.scrollIntoView({ block: key === "customize" ? "center" : "nearest", inline: "nearest" });
        } catch (e) {}
      }
      measure();
      setReady(true);
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearTimeout(t2);
      if (sidebar) sidebar.removeEventListener("transitionend", onSettled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step.id]);

  // Close the drawer if the tour opened it.
  React.useEffect(
    () => () => {
      if (drawerOpenedRef.current) setMobileNavOpen(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Follow the target on scroll and resize.
  React.useEffect(() => {
    let raf = 0;
    const onMove = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [measure]);

  // Place the popover once its size is known.
  React.useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    setPos(TOUR_place(rect, pop.offsetWidth, pop.offsetHeight));
  }, [rect, index, ready]);

  // Focus the popover heading on each step.
  React.useEffect(() => {
    if (ready && titleRef.current) {
      try {
        titleRef.current.focus({ preventScroll: true });
      } catch (e) {}
    }
  }, [ready, index]);

  // Keyboard: Esc skips, arrows move, Tab stays inside the popover.
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        isLast ? onFinish() : onSkip();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        isLast ? onFinish() : onNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (index > 0) onBack();
      } else if (e.key === "Tab" && popRef.current) {
        const f = Array.from(popRef.current.querySelectorAll("button:not([disabled]), [tabindex='-1']"));
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        const inside = popRef.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [index, isLast, onBack, onNext, onSkip, onFinish]);

  const body = step.body(targetKey);
  return ReactDOM.createPortal(
    <div className="tour-root">
      {/* Blocks clicks on the page while the tour is open. */}
      <div className={"tour-blocker" + (rect ? "" : " tour-dim")} aria-hidden="true" />
      {rect && (
        <div
          className="tour-spotlight"
          aria-hidden="true"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}
      <div
        ref={popRef}
        className={"tour-pop" + (ready && pos ? " tour-pop-on" : "") + (pos ? " tour-pop-" + pos.side : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      >
        <div className="tour-step">
          Step {index + 1} of {total}
        </div>
        <h2 className="tour-title" id={titleId} ref={titleRef} tabIndex={-1}>
          {step.title}
        </h2>
        <p className="tour-body" id={bodyId}>
          {body}
        </p>
        <div className="tour-actions">
          {!isLast && (
            <button type="button" className="tour-btn tour-btn-link" onClick={onSkip}>
              Skip tour
            </button>
          )}
          <span className="tour-actions-spacer" />
          {index > 0 && (
            <button type="button" className="tour-btn tour-btn-ghost" onClick={onBack}>
              Back
            </button>
          )}
          <button type="button" className="tour-btn tour-btn-primary" onClick={isLast ? onFinish : onNext}>
            {isLast ? "Finish" : index === 0 ? "Start tour" : "Next"}
          </button>
        </div>
        <div className="tour-sr" aria-live="polite">
          {ready ? `Step ${index + 1} of ${total}: ${step.title}. ${body}` : ""}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// "Get set up" checklist (top of the client Dashboard)
// ---------------------------------------------------------------------------
function TOUR_Checklist({ items, onDismiss, previewing }) {
  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;
  return (
    <section className="card tour-check" aria-labelledby="tour-check-title">
      <div className="tour-check-head">
        <div>
          <h2 className="tour-check-title" id="tour-check-title">
            {allDone ? "You're all set up" : "Get set up"}
          </h2>
          <p className="tour-check-sub">
            {allDone
              ? "Nice work. You can close this card."
              : `${doneCount} of ${items.length} done.` + (previewing ? " Preview only, nothing is saved." : "")}
          </p>
        </div>
        <button type="button" className="tour-check-close" onClick={onDismiss} aria-label="Dismiss the setup checklist">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div
        className="tour-check-bar"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={doneCount}
      >
        <span style={{ width: (items.length ? (doneCount / items.length) * 100 : 0) + "%" }} />
      </div>
      <ul className="tour-check-list">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className={"tour-check-item" + (it.done ? " is-done" : "")} onClick={it.onClick}>
              <span className="tour-check-box" aria-hidden="true">
                {it.done && (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </span>
              <span className="tour-check-text">
                <span className="tour-check-label">{it.label}</span>
                <span className="tour-check-hint">{it.hint}</span>
              </span>
              <span className="tour-sr">{it.done ? "(done)" : "(not done)"}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Root: mounted once in App's <main>, just above the page content.
// ---------------------------------------------------------------------------
function TOUR_Root({
  client,
  access,
  page,
  onSelectPage,
  onOpenSettings,
  setMobileNavOpen,
  clientPortalUser,
  isStaffSession,
  isPreviewingUser,
  impersonating,
}) {
  const st = ST_useSettings();
  // Only a real client user, signed in as themselves, saves anything.
  const isRealClient = !!clientPortalUser && !isStaffSession && !impersonating && !isPreviewingUser;
  const email = clientPortalUser ? String(clientPortalUser.email || "").trim().toLowerCase() : null;
  const ownSettings = isRealClient && st.email === email;
  const saved = ownSettings && TOUR_isObj(st.settings && st.settings.tour) ? st.settings.tour : {};
  const s = (ownSettings && st.settings) || {};
  const [run, setRun] = React.useState(null); // { steps, index, persist }
  // Staff previewing: a checklist that lives only in this tab.
  const [previewChecklist, setPreviewChecklist] = React.useState(null); // null | { ticks: {} }
  const autoStarted = React.useRef(false);
  const returnFocus = React.useRef(null);
  const fullAccess = !!(access && access.isFullAccess);
  const tabs = access && access.tabs;

  const save = React.useCallback(
    (patch) => {
      if (isRealClient) ST_store.update({ tour: patch });
    },
    [isRealClient],
  );

  const begin = React.useCallback(
    (persist) => {
      returnFocus.current = document.activeElement;
      if (onSelectPage) onSelectPage("dashboard");
      // A restart keeps the old status (and the checklist) until it ends.
      if (persist && !saved.status) save({ status: "started", startedAt: new Date().toISOString() });
      // Let the Dashboard (and its Customize button) render first.
      setTimeout(() => {
        const steps = TOUR_visibleSteps({
          clientName: client && client.name,
          fullAccess,
          tabs,
          withChecklist: true,
        });
        setRun({ steps, index: 0, persist });
      }, 350);
    },
    [client, fullAccess, tabs, onSelectPage, save, saved.status],
  );

  // First sign-in: start once settings have loaded and say it hasn't run.
  React.useEffect(() => {
    if (!isRealClient || autoStarted.current || run) return;
    if (!ownSettings || (st.status !== "ready" && st.status !== "local")) return;
    if (saved.status) return;
    // The flag is set when the timer fires, so a re-render that reschedules
    // this effect can't cancel the only start.
    const t = setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      begin(true);
    }, 600);
    return () => clearTimeout(t);
  }, [isRealClient, ownSettings, st.status, saved.status, run, begin]);

  // Manual start (Settings > Help, "Restart the tour").
  React.useEffect(() => {
    const onStart = () => {
      if (run) return;
      // Staff in the bookkeeper view (not previewing) have no client tour.
      if (isStaffSession && !isPreviewingUser) return;
      begin(isRealClient);
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, [run, isStaffSession, isPreviewingUser, isRealClient, begin]);

  // Leaving the client (or starting a preview) ends a running tour.
  const clientId = client && client.id;
  React.useEffect(() => {
    setRun(null);
    setPreviewChecklist(null);
  }, [clientId, isPreviewingUser]);

  // The checklist lives on the Dashboard, or for someone without one (Basic
  // plan, limited access) on the page the app opened in its place.
  const hasDashboard = !!(tabs && tabs.has("dashboard"));
  const end = (status) => {
    const persist = run && run.persist;
    const home = hasDashboard ? undefined : page;
    setRun(null);
    if (persist) save({ status, endedAt: new Date().toISOString(), ...(home ? { home } : {}) });
    else if (!isRealClient && isPreviewingUser) setPreviewChecklist((p) => p || { ticks: {}, home });
    if (status === "done" && onSelectPage) onSelectPage("dashboard");
    const back = returnFocus.current;
    setTimeout(() => {
      if (back && back.isConnected && typeof back.focus === "function") {
        try {
          back.focus({ preventScroll: true });
        } catch (e) {}
      }
    }, 0);
  };

  // ---- checklist ----
  const ticks = isRealClient ? (TOUR_isObj(saved.checklist) ? saved.checklist : {}) : (previewChecklist && previewChecklist.ticks) || {};
  const tick = (id) => {
    if (isRealClient) save({ checklist: { [id]: true } });
    else setPreviewChecklist((p) => ({ ...(p || {}), ticks: { ...((p && p.ticks) || {}), [id]: true } }));
  };
  const notifySet = TOUR_isObj(s.notify) && TOUR_isObj(s.notify.email) && Object.keys(s.notify.email).length > 0;
  const items = [
    {
      id: "profile",
      label: "Add your profile details",
      hint: "Your name and phone number, so your bookkeeper knows how to reach you.",
      done: !!ticks.profile || !!(s.name || s.phone),
      onClick: () => {
        tick("profile");
        onOpenSettings && onOpenSettings("profile");
      },
    },
    {
      id: "notifications",
      label: "Review your notification emails",
      hint: "Choose which emails you get from the portal.",
      done: !!ticks.notifications || notifySet,
      onClick: () => {
        tick("notifications");
        onOpenSettings && onOpenSettings("notifications");
      },
    },
    ...(fullAccess
      ? [
          {
            id: "invite",
            label: "Invite a teammate",
            hint: "Ask us to add someone from your organization.",
            done: !!ticks.invite,
            onClick: () => {
              tick("invite");
              onOpenSettings && onOpenSettings("organization");
            },
          },
        ]
      : []),
    ...(tabs && tabs.has("documents")
      ? [
          {
            id: "document",
            label: "Upload your first requested document",
            hint: "Anything your bookkeeper has asked for shows up in Documents.",
            done: !!ticks.document,
            onClick: () => {
              tick("document");
              onSelectPage && onSelectPage("documents");
            },
          },
        ]
      : []),
    ...(tabs && tabs.has("messages")
      ? [
          {
            id: "message",
            label: "Send your bookkeeper a message",
            hint: "Say hello or ask a question.",
            done: !!ticks.message,
            onClick: () => {
              tick("message");
              onSelectPage && onSelectPage("messages");
            },
          },
        ]
      : []),
  ];
  const homePage = hasDashboard
    ? "dashboard"
    : (isRealClient ? saved.home : previewChecklist && previewChecklist.home) || "reports";
  const showChecklist =
    page === homePage &&
    !run &&
    (isRealClient ? !!saved.status && saved.status !== "started" && !saved.checklistDismissed : !!previewChecklist);

  return (
    <>
      {showChecklist && (
        <TOUR_Checklist
          items={items}
          previewing={!isRealClient}
          onDismiss={() => {
            if (isRealClient) save({ checklistDismissed: true });
            else setPreviewChecklist(null);
          }}
        />
      )}
      {run && run.steps.length > 0 && (
        <TOUR_Overlay
          steps={run.steps}
          index={run.index}
          setMobileNavOpen={setMobileNavOpen || (() => {})}
          onNext={() => setRun((r) => (r ? { ...r, index: Math.min(r.index + 1, r.steps.length - 1) } : r))}
          onBack={() => setRun((r) => (r ? { ...r, index: Math.max(r.index - 1, 0) } : r))}
          onSkip={() => end("skipped")}
          onFinish={() => end("done")}
        />
      )}
    </>
  );
}
