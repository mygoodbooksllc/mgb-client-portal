// ----------------------------------------------------------------------------
// TK_StandaloneBar.jsx — the slim bar on top of the Tasks shell (Row 11.2)
// and the portal side of Dock.
//
// TK_StandaloneBar({ staffUser, clients })
//   The gold logo badge on navy deep, the "Tasks" wordmark, a search button
//   (#/tasks/search), the "Follow my client" switch (a menu item on touch
//   screens; mgb_tk_follow_v1; TK_useFollowClient in TK_ClientDrawer.jsx),
//   "Dock in portal", and an avatar menu with "Open full portal" and
//   "Help". While mounted it adds body.tk-shell (which hides the
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

function TK_StandaloneBar(props) {
  var staffUser = props.staffUser || {};
  var width = TK_vUseWidth();
  var touch = TK_vUseTouch();
  var phone = width <= 760;
  var info = TK_vOpenerInfo();
  var showDock = info.hasOpener || !touch;
  var name = staffUser.name || staffUser.full_name || staffUser.email || "";

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
    cancelRef.current = TK_vDock(currentHash());
  };
  var openPortal = function () {
    TK_vClearShellFlag();
    try {
      window.location.assign("/#/today");
    } catch (e) {}
  };
  var help = function () {
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

  return (
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
      <span className="tk-sbar-live tk-sr" aria-live="polite">
        {follow.liveText}
      </span>
      <div className="tk-sbar-actions">
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
        {touch ? null : (
          <span className="tk-sbar-follow-wrap" title="Show the tasks for the client open in your portal window">
            <TK_vSwitch className="tk-sbar-follow" label="Follow my client" checked={followOn} onChange={setFollow} />
          </span>
        )}
        {showDock && !phone ? (
          <button type="button" className="tk-sbar-btn tk-sbar-dock" onClick={dock} title="Dock in portal">
            <TK_vIcon name="dock" size={17} />
            <span>Dock in portal</span>
          </button>
        ) : null}
        <TK_vMenuButton
          className="tk-sbar-avatar"
          ariaLabel="Account menu"
          title="Account menu"
          menuLabel="Account"
          align="right"
          label={<TK_vAvatar name={name} size="sm" decorative />}
        >
          {function (close) {
            var items = [];
            if (showDock && phone) {
              items.push(
                <button
                  key="dock"
                  type="button"
                  role="menuitem"
                  className="tk-menu-item"
                  onClick={function () {
                    close();
                    dock();
                  }}
                >
                  Dock in portal
                </button>,
              );
            }
            if (touch) {
              items.push(
                <button
                  key="follow"
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={followOn ? "true" : "false"}
                  className="tk-menu-item"
                  onClick={function () {
                    close();
                    setFollow(!followOn);
                  }}
                >
                  Follow my client
                </button>,
              );
            }
            items.push(
              <button
                key="portal"
                type="button"
                role="menuitem"
                className="tk-menu-item"
                onClick={function () {
                  close();
                  openPortal();
                }}
              >
                Open full portal
              </button>,
              <button
                key="help"
                type="button"
                role="menuitem"
                className="tk-menu-item"
                onClick={function () {
                  close();
                  help();
                }}
              >
                Help
              </button>,
            );
            return items;
          }}
        </TK_vMenuButton>
      </div>
    </header>
  );
}
