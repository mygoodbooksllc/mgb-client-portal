// ----------------------------------------------------------------------------
// TK_StandaloneBar.jsx — the slim bar on top of the Tasks shell (Row 11.2)
// and the portal side of Dock.
//
// TK_StandaloneBar({ staffUser, clients, theme, onToggleTheme, isAdmin, onSignOut })
//   The gold logo badge on navy deep, the "Slate" wordmark, search, one
//   "+ Add" (app only, and only where the rail has no Create and there is no
//   phone bottom bar: TK_useNewTaskButtons), the Settings gear (app), and the
//   avatar menu: the one stop (Slate UX review, Stage A, 2026-11-02) for My
//   profile and Notifications (portal Settings), Dark/Light mode, the window
//   controls (the size presets, Dock in portal, Follow my client:
//   mgb_tk_follow_v1, TK_useFollowClient in TK_ClientDrawer.jsx), Open full
//   portal, Help, the Slate tour, Admin settings (admins: portal HR ›
//   Members) and Sign out. Inside the Slate app (TK_slateInApp,
//   TK_SlateBridge.jsx) portal pages open in a portal window over the
//   "mgb-slate" channel instead, and the install strip shows on
//   /slate?install=1. Back, Forward and Refresh (AN_AppNav) show only in an
//   app window with no browser toolbar (TK_vNeedsAppNav).
//   While mounted it adds body.tk-shell (which hides the
//   chat button) and, when the window has an opener, remembers its size in
//   mgb_tk_popout_v1 (debounced 500 ms).
// TK_startDockReceiver()
//   The portal side: on a "dock" message addressed to this tab, it opens the
//   hash, focuses the window and replies "docked". Idempotent. App calls it
//   once outside the shell.
// ----------------------------------------------------------------------------

var TK_vSHELL_KEY = "mgb_shell_v1";
var TK_vDockReceiverOff = null;

function TK_vClearShellFlag() {
  try {
    window.sessionStorage.removeItem(TK_vSHELL_KEY);
  } catch (e) {}
  try {
    window.MGB_SHELL = null;
  } catch (e) {}
}

// The opener's TK_sync tab id, or null (same origin; any error means none).
function TK_vOpenerInfo() {
  var out = { hasOpener: false, openerClosed: false, openerTabId: null };
  var op = null;
  try {
    op = window.opener || null;
  } catch (e) {
    op = null;
  }
  if (!op) return out;
  out.hasOpener = true;
  try {
    out.openerClosed = !!op.closed;
  } catch (e) {
    out.openerClosed = true;
  }
  if (out.openerClosed) return out;
  try {
    out.openerTabId = op.TK_sync && op.TK_sync.tabId ? String(op.TK_sync.tabId) : null;
  } catch (e) {
    out.openerTabId = null;
  }
  return out;
}

function TK_vSyncReady() {
  return typeof TK_sync !== "undefined" && TK_sync && typeof TK_sync.post === "function" && typeof TK_sync.on === "function";
}

function TK_startDockReceiver() {
  if (TK_vDockReceiverOff) return TK_vDockReceiverOff;
  if (!TK_vSyncReady()) return null;
  TK_vDockReceiverOff = TK_sync.on("dock", function (msg) {
    if (!msg || msg.to !== TK_sync.tabId) return;
    var hash = typeof msg.hash === "string" ? msg.hash : "";
    // Only a Tasks hash may move this window.
    if (!/^#\/tasks(\/[A-Za-z0-9%._~-]+){0,3}(\?item=[a-z]+:[A-Za-z0-9%._~-]+)?$/.test(hash)) hash = "#/tasks/my";
    try {
      if (window.location.hash !== hash) window.location.hash = hash;
    } catch (e) {}
    try {
      window.focus();
    } catch (e) {}
    if (msg.from) TK_sync.post({ type: "docked", to: msg.from });
  });
  return TK_vDockReceiverOff;
}

// Runs TK_dockPlan step by step. Returns a cancel function.
function TK_vDock(hash) {
  var h = typeof hash === "string" && hash ? hash : "#/tasks/my";
  var info = TK_vOpenerInfo();
  var waitMs = typeof TK_DOCK_WAIT_MS === "number" ? TK_DOCK_WAIT_MS : 600;
  var plan = function (posted, replied, elapsed) {
    if (typeof TK_dockPlan === "function") {
      return TK_dockPlan({
        hasOpener: info.hasOpener,
        openerClosed: info.openerClosed,
        openerTabId: info.openerTabId,
        posted: posted,
        replied: replied,
        elapsedMs: elapsed,
      });
    }
    if (!info.hasOpener || info.openerClosed || !info.openerTabId) return "navigate";
    if (!posted) return "post";
    if (replied) return "close";
    return elapsed >= waitMs ? "navigate" : "wait";
  };
  var navigate = function () {
    TK_vClearShellFlag();
    try {
      window.location.assign("/" + h);
    } catch (e) {}
  };
  var done = false;
  var off = null;
  var timer = null;
  var finish = function () {
    done = true;
    if (off) off();
    if (timer) clearTimeout(timer);
  };
  TK_vTrack("tasks-dock");
  var first = plan(false, false, 0);
  if (first !== "post" || !TK_vSyncReady()) {
    finish();
    navigate();
    return finish;
  }
  var replied = false;
  off = TK_sync.on("docked", function (msg) {
    if (done || !msg || msg.to !== TK_sync.tabId) return;
    replied = true;
    finish();
    if (plan(true, true, 0) === "close") {
      try {
        window.close();
      } catch (e) {}
    }
  });
  var started = Date.now();
  var sent = TK_sync.post({ type: "dock", hash: h, to: info.openerTabId });
  if (!sent) {
    finish();
    navigate();
    return finish;
  }
  timer = setTimeout(function () {
    if (done) return;
    var step = plan(true, replied, Math.max(waitMs, Date.now() - started));
    finish();
    if (step === "close") {
      try {
        window.close();
      } catch (e) {}
    } else {
      navigate();
    }
  }, waitMs);
  return finish;
}

// Back, Forward and Refresh are needed only where the window has no browser
// toolbar: an installed app window (AN_AppNav shows itself there) or the
// Slate pop-up (window.toolbar.visible is false). In an ordinary browser tab
// the browser's own buttons do the same thing, so the bar leaves them out.
function TK_vNeedsAppNav() {
  try {
    return !!(window.toolbar && window.toolbar.visible === false);
  } catch (e) {
    return false;
  }
}

// Which Slate add button shows here (TK_newTaskButtons in TK_viewLogic.js):
// { bar, head }. Used by the bar's + Add and by My Tasks' header Add task, so
// each screen has one New task button (plus q and the in-list Add task rows).
function TK_useNewTaskButtons(embedded) {
  var inApp = typeof TK_useSlateInApp === "function" ? TK_useSlateInApp() : false;
  var sm = typeof TK_useSlateMode === "function" ? TK_useSlateMode() : null;
  var createOn = typeof CM_useCreateMenu === "function" ? CM_useCreateMenu() : false;
  var plusOn = typeof TKP_useOn === "function" ? TKP_useOn() : false;
  var touch = TK_vUseTouch();
  var mode = inApp && sm ? sm.mode : null;
  var lay = mode && typeof TK_slateLayout === "function" ? TK_slateLayout(mode, touch) : null;
  var railCreate = !!(inApp && lay && lay.rail && plusOn && createOn && typeof TKR_Rail === "function" && typeof TB_NavCreate === "function");
  var shell = false;
  try {
    shell = window.MGB_SHELL === "tasks";
  } catch (e) {}
  if (typeof TK_newTaskButtons !== "function") return { bar: !!mode, head: !mode };
  return TK_newTaskButtons({
    inApp: !!mode,
    railCreate: railCreate,
    bottomBar: !!(lay && lay.bottomBar),
    createOn: createOn,
    shell: shell,
    embedded: !!embedded,
  });
}

function TK_StandaloneBar(props) {
  var staffUser = props.staffUser || {};
  var width = TK_vUseWidth();
  var touch = TK_vUseTouch();
  var info = TK_vOpenerInfo();
  var showDock = info.hasOpener || !touch;
  var name = staffUser.name || staffUser.full_name || staffUser.email || "";
  var inApp = typeof TK_useSlateInApp === "function" ? TK_useSlateInApp() : false;
  // Size mode (app only; null on the portal page and with the app off).
  var smNow = typeof TK_useSlateMode === "function" ? TK_useSlateMode() : null;
  var slm = inApp ? smNow : null;
  var slWide = !!slm && (slm.mode === "regular" || slm.mode === "full");
  var presets = typeof TK_useSlatePresets === "function" ? TK_useSlatePresets() : { ok: false };
  var route = TK_useRoute();
  var phone = slm ? !slWide : width <= 760;
  // Window controls (sizes, Dock in portal, Follow my client) live in the
  // avatar menu (Slate UX review, Stage A item 4).
  var addBtns = TK_useNewTaskButtons(false);
  // Slate plus Profile 2: the unified search replaces the bar's search box
  // while the gate is on. Off, the old box / link render exactly as before.
  var tksOn = (typeof TKP_useOn === "function" ? TKP_useOn() : false) && typeof TKS_SearchBox === "function";

  // Follow my client: the list follows the client open in the portal window.
  var fPair = React.useState(function () {
    return TK_vLsGet("mgb_tk_follow_v1", false) === true;
  });
  var followOn = fPair[0];
  var setFollowOn = fPair[1];
  var setFollow = function (v) {
    TK_vLsSet("mgb_tk_follow_v1", !!v);
    setFollowOn(!!v);
    if (v) TK_vTrack("tasks-follow");
  };
  var follow = TK_useFollowClient({ enabled: followOn, clients: props.clients || [] });

  // body.tk-shell while the bar is up.
  React.useEffect(function () {
    try {
      document.body.classList.add("tk-shell");
    } catch (e) {}
    return function () {
      try {
        document.body.classList.remove("tk-shell");
      } catch (e) {}
    };
  }, []);

  // Remember the window size for the next pop-out (only for a real pop-out).
  React.useEffect(function () {
    var t = null;
    var on = function () {
      var has = false;
      try {
        has = !!window.opener;
      } catch (e) {
        has = false;
      }
      if (!has) return;
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        var key = typeof TK_POPOUT_KEY === "string" ? TK_POPOUT_KEY : "mgb_tk_popout_v1";
        var w = window.outerWidth || window.innerWidth;
        var h = window.outerHeight || window.innerHeight;
        if (w > 0 && h > 0) TK_vLsSet(key, { w: Math.round(w), h: Math.round(h) });
      }, 500);
    };
    window.addEventListener("resize", on);
    return function () {
      if (t) clearTimeout(t);
      window.removeEventListener("resize", on);
    };
  }, []);

  var cancelRef = React.useRef(null);
  React.useEffect(function () {
    return function () {
      if (cancelRef.current) cancelRef.current();
    };
  }, []);

  var currentHash = function () {
    var h = "";
    try {
      h = window.location.hash || "";
    } catch (e) {}
    return /^#\/tasks(\/|\?|$)/.test(h) ? h : "#/tasks/my";
  };
  var dock = function () {
    if (cancelRef.current) cancelRef.current();
    if (inApp) {
      cancelRef.current = null;
      TK_slateDock(currentHash(), function (r) {
        if (r === "stay") TK_vToast("You can close this window now.");
      });
      return;
    }
    cancelRef.current = TK_vDock(currentHash());
  };
  // A portal page: in the app it goes to a portal window (TK_slateForwardHash);
  // in a plain Tasks pop-out the opener goes there (like Help); with no opener
  // this window leaves the shell for it.
  var goPortal = function (hash) {
    if (inApp) {
      TK_slateForwardHash(hash);
      return;
    }
    var op = null;
    try {
      op = window.opener && !window.opener.closed ? window.opener : null;
    } catch (e) {
      op = null;
    }
    if (op) {
      try {
        op.location.hash = hash;
        op.focus();
        return;
      } catch (e) {}
    }
    TK_vClearShellFlag();
    try {
      window.location.assign("/" + hash);
    } catch (e) {}
  };
  // Open full portal keeps its old behavior: outside the app this window
  // itself becomes the portal.
  var openPortal = function () {
    if (inApp) {
      TK_slateForwardHash("#/today");
      return;
    }
    TK_vClearShellFlag();
    try {
      window.location.assign("/#/today");
    } catch (e) {}
  };
  var help = function () {
    if (inApp) {
      TK_slateForwardHash("#/help/tasks-own-window");
      return;
    }
    var op = null;
    try {
      op = window.opener && !window.opener.closed ? window.opener : null;
    } catch (e) {
      op = null;
    }
    if (op) {
      try {
        op.location.hash = "#/help/my-tasks";
        op.focus();
        return;
      } catch (e) {}
    }
    try {
      window.location.hash = "#/help/my-tasks";
    } catch (e) {}
  };

  var bar = (
    <header className={"tk-sbar" + (phone ? " is-compact" : "")} role="banner">
      <a
        className="tk-sbar-brand"
        href="#/tasks/my"
        aria-label="Slate home"
        onClick={function (e) {
          if (!TK_vPlainClick(e)) return;
          e.preventDefault();
          TK_navigate({ view: "my" });
        }}
      >
        <span className="tk-sbar-badge">
          <span className="staff-rail-mark brand-logo-box" aria-hidden="true" />
        </span>
        <span className="tk-sbar-word">Slate</span>
      </a>
      {!phone && typeof AN_AppNav === "function" && TK_slateInApp() ? <AN_AppNav variant="sbar" always={TK_vNeedsAppNav()} /> : null}
      <span className="tk-sbar-live tk-sr" aria-live="polite">
        {follow.liveText}
      </span>
      <div className="tk-sbar-actions">
        {tksOn ? (
          <TKS_SearchBox variant="sbar" compact={phone} clients={props.clients || []} isAdmin={staffUser.role === "admin"} />
        ) : slWide && typeof TK_SlateSearchBox === "function" ? (
          <TK_SlateSearchBox />
        ) : (
          <a
            className="tk-sbar-btn"
            href="#/tasks/search"
            aria-label="Search tasks"
            title="Search tasks"
            onClick={function (e) {
              if (!TK_vPlainClick(e)) return;
              e.preventDefault();
              TK_navigate({ view: "search" });
            }}
          >
            <TK_vIcon name="search" size={18} />
          </a>
        )}
        {slm && addBtns.bar ? (
          <button
            type="button"
            className="tk-sbar-btn tk-sbar-add"
            data-tour="tk-sbar-add"
            title="Add a task (q)"
            aria-label="Add a task"
            onClick={function () {
              try {
                window.dispatchEvent(new CustomEvent("tk:quick-add", { detail: typeof TK_vQuickAddFor === "function" ? TK_vQuickAddFor(route) : {} }));
              } catch (e) {}
            }}
          >
            <TK_vIcon name="plus" size={17} />
            <span>Add</span>
          </button>
        ) : null}
        {slm ? (
          <a
            className={"tk-sbar-btn tk-sbar-gear" + (route.view === "settings" ? " is-active" : "")}
            data-tour="tk-sbar-gear"
            href="#/tasks/settings"
            aria-label="Slate settings"
            title="Slate settings"
            aria-current={route.view === "settings" ? "page" : undefined}
            onClick={function (e) {
              if (!TK_vPlainClick(e)) return;
              e.preventDefault();
              TK_navigate({ view: "settings" });
            }}
          >
            <TK_vIcon name="gear" size={17} />
          </a>
        ) : null}
        <TK_vMenuButton
          className="tk-sbar-avatar"
          tour="tk-sbar-avatar"
          ariaLabel="Account menu"
          title="Account menu"
          menuLabel="Account"
          align="right"
          label={<TK_vAvatar name={name} size="sm" decorative />}
        >
          {function (close) {
            // One stop for the person's own things (Slate UX review, Stage A):
            // profile, notifications and theme; the window controls; portal,
            // help and tour; Admin settings for admins; Sign out.
            var items = [];
            var item = function (key, label, onPick, extra) {
              return (
                <button
                  key={key}
                  type="button"
                  role={(extra && extra.role) || "menuitem"}
                  aria-checked={extra && extra.checked != null ? (extra.checked ? "true" : "false") : undefined}
                  title={(extra && extra.title) || undefined}
                  className="tk-menu-item"
                  onClick={function () {
                    close();
                    onPick();
                  }}
                >
                  {extra && extra.checked ? (
                    <span className="tk-sbar-check" aria-hidden="true">
                      <TK_vIcon name="check" size={14} />
                    </span>
                  ) : null}
                  {label}
                </button>
              );
            };
            var sep = function (key) {
              return <span key={key} className="tk-menu-sep" role="separator" aria-hidden="true" />;
            };
            if (name) {
              items.push(
                <div key="who" className="tk-menu-note tk-sbar-who">
                  {name}
                </div>,
              );
            }
            items.push(
              item("profile", "My profile", function () { goPortal("#/settings?tab=profile"); }, { title: "Name, title, photo and phone (portal Settings)" }),
              item("notify", "Notifications", function () { goPortal("#/settings?tab=notifications"); }, { title: "Which emails and bell alerts you get (portal Settings)" }),
            );
            if (typeof props.onToggleTheme === "function") {
              items.push(item("theme", props.theme === "dark" ? "Light mode" : "Dark mode", props.onToggleTheme));
            }
            items.push(item("display", "Display settings", function () { goPortal("#/settings?tab=appearance"); }, { title: "Theme and start page (portal Settings)" }));
            // Window controls.
            var win = [];
            if (slm && presets.ok && typeof TK_SLATE_PRESET_ITEMS !== "undefined") {
              TK_SLATE_PRESET_ITEMS.forEach(function (it) {
                win.push(item("size-" + it.id, "Size: " + it.label, function () { presets.apply(it.id); }));
              });
            }
            if (showDock) win.push(item("dock", "Dock in portal", dock));
            win.push(
              item("follow", "Follow my client", function () { setFollow(!followOn); }, {
                role: "menuitemcheckbox",
                checked: followOn,
                title: "Show the tasks for the client open in your portal window",
              }),
            );
            items.push(sep("sep-win"));
            items = items.concat(win);
            items.push(sep("sep-help"), item("portal", "Open full portal", openPortal), item("help", "Help", help));
            // The presenter tour, run right here in the app (Tour.jsx).
            if (inApp && typeof window.TK_replaySlateTour === "function") {
              items.push(item("tour", "Take the Slate tour", function () { window.TK_replaySlateTour(); }));
            }
            var tail = [];
            // Admins: the portal's staff access page (HR › Members). Nothing
            // about staff, pay or access is edited inside Slate itself.
            if (props.isAdmin) tail.push(item("admin", "Admin settings", function () { goPortal("#/hr/members"); }, { title: "Staff and their access (portal HR › Members)" }));
            if (typeof props.onSignOut === "function") tail.push(item("signout", "Sign out", props.onSignOut));
            if (tail.length) items = items.concat([sep("sep-acct")], tail);
            return items;
          }}
        </TK_vMenuButton>
      </div>
    </header>
  );
  if (!inApp || typeof TK_SlateInstallBanner !== "function") return bar;
  return (
    <>
      {bar}
      <TK_SlateInstallBanner />
    </>
  );
}
