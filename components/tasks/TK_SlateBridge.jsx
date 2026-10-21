// ----------------------------------------------------------------------------
// TK_SlateBridge.jsx — the MGB Slate app: launch, install and the bridge
// between the Slate app window and the portal (spec-desk-fullpage 3, S2).
//
// Everything here is hidden behind TK_slateAppIsOn (through TK_slateFlag in
// TK_store.js): the person ticked the Slate app preview or the firm switch
// tk_settings.slate_app_enabled is on, and "Classic Slate" is not ticked.
// With the app off nothing here renders, listens or opens anything.
//
//   TK_slateAppOn() / TK_useSlateAppOn()    is the Slate app on (live)
//   TK_slateInApp() / TK_useSlateInApp()    this window IS the Slate app
//                                           (/slate, the Tasks shell, app on)
//   TK_openSlateApp(hash)                   "Open Slate app": the /slate pop-up
//   TK_slateGet()                           "Install Slate app": /slate?install=1
//   TK_SlateLaunch / TK_SlateDialog         the buttons and the dialogs
//   TK_SlateInstallBanner                   the install strip on /slate?install=1
//   TK_startSlateReceiver()                 the portal side of the channel
//   TK_slateForward / TK_slateForwardHash / TK_slateForwardChat / TK_slateDock
//                                           the app side: show it in a portal
//   TK_slateGuard(t, hint)                  LK_go's check (DeepLink.jsx)
//   TK_slateBoot()                          app.jsx calls it once for staff
//
// Channel "mgb-slate" messages are { v:1, t:<type>, from:<window id>, to? }.
// Types: who / here (find a portal), open { target | hash, hint }, open-chat
// { clientId, email }, dock-go { hash }, done. Same origin only; every hash is
// checked with TK_slateForwardOk (dock-go with TK_slateDockHashOk), wrong v and
// own messages are dropped, an action runs only when "to" is this window, and
// only a portal window (receiver started) answers. Ported from the retired
// MGB Desk window (WB_DeskApp.jsx). Pure rules: TK_viewLogic.js.
// Browser file; loads after TK_ClientDrawer.jsx, before TK_StandaloneBar.jsx.
// ----------------------------------------------------------------------------

var TK_SLATE_ASK_MS = 250; // how long the app waits for portals to answer "who"
var TK__sl = {
  ch: null,
  id: "sl" + Math.random().toString(36).slice(2, 10),
  receiving: false,
  focusedAt: Date.now(),
  collect: [], // reply collectors for who / here
  waitDone: [], // { to, fn }
  stopRecv: null,
};

function TK__slChannelName() {
  return typeof TK_SLATE_CHANNEL === "string" ? TK_SLATE_CHANNEL : "mgb-slate";
}
function TK__slName() {
  return typeof TK_SLATE_APP_NAME === "string" ? TK_SLATE_APP_NAME : "MGB Slate";
}
function TK__slTrack(name, detail) {
  try {
    if (typeof window.MGB_track === "function") window.MGB_track(name, detail);
  } catch (e) {}
}
function TK__slInstall() {
  return typeof window !== "undefined" && window.mgbInstallApp ? window.mgbInstallApp : null;
}
function TK__slMobile() {
  try {
    var ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod|Android|Mobile|Tablet/i.test(ua)) return true;
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
    if (/Linux/.test(ua) && !/CrOS/.test(ua) && navigator.maxTouchPoints > 0) return true;
  } catch (e) {}
  return false;
}
function TK__slToast(text) {
  if (typeof TK_vToast === "function") TK_vToast(text);
}
function TK__slBlocked() {
  return typeof TK_vCopy === "function" ? TK_vCopy("popupBlocked") : "Your browser blocked the new window. Allow pop-ups for this site and try again.";
}

// ---- Is the app on / is this the app ---------------------------------------------

function TK_slateAppOn() {
  try {
    return typeof TK_slateFlag !== "undefined" && TK_slateFlag ? TK_slateFlag.getState().appOn === true : false;
  } catch (e) {
    return false;
  }
}
function TK__slSubscribe(fn) {
  try {
    if (typeof TK_slateFlag !== "undefined" && TK_slateFlag) return TK_slateFlag.subscribe(fn);
  } catch (e) {}
  return function () {};
}
function TK_useSlateAppOn() {
  return React.useSyncExternalStore(TK__slSubscribe, TK_slateAppOn, TK_slateAppOn);
}

function TK__slOnSlatePath() {
  try {
    return /^\/slate\/?$/.test(window.location.pathname);
  } catch (e) {
    return false;
  }
}
// This window is the Slate app (the /slate pop-up or the installed app).
function TK_slateInApp() {
  return TK_slateAppOn() && window.MGB_SHELL === "tasks" && TK__slOnSlatePath();
}
function TK_useSlateInApp() {
  return React.useSyncExternalStore(TK__slSubscribe, TK_slateInApp, TK_slateInApp);
}

// ---- The channel ----------------------------------------------------------------

function TK__slPlain(o, keys, cap) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  var out = {};
  var max = cap || 10;
  Object.keys(o).forEach(function (k) {
    if (keys && keys.indexOf(k) < 0) return;
    if (Object.keys(out).length >= max) return;
    var v = o[k];
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" && isFinite(v)) out[k] = String(v);
  });
  return Object.keys(out).length ? out : null;
}
// An LK target ({ clientId, tab, sub, item, month, account } or { place, ... }).
function TK__slTarget(t) {
  return TK__slPlain(t, ["clientId", "place", "tab", "sub", "item", "month", "account", "client"], 10);
}
function TK__slHint(h) {
  return TK__slPlain(h, null, 10);
}

function TK__slChan() {
  if (TK__sl.ch) return TK__sl.ch;
  try {
    if (typeof BroadcastChannel === "function") {
      TK__sl.ch = new BroadcastChannel(TK__slChannelName());
      TK__sl.ch.onmessage = function (ev) {
        TK__slOnMsg(ev && ev.data);
      };
    }
  } catch (e) {
    TK__sl.ch = null;
  }
  return TK__sl.ch;
}
function TK__slPost(msg) {
  var c = TK__slChan();
  if (!c) return false;
  try {
    c.postMessage(Object.assign({ v: 1, from: TK__sl.id }, msg));
    return true;
  } catch (e) {
    return false;
  }
}

function TK__slOnMsg(m) {
  if (!m || typeof m !== "object" || m.v !== 1 || typeof m.t !== "string") return;
  if (m.from === TK__sl.id || typeof m.from !== "string") return;
  if (m.to && m.to !== TK__sl.id) return;
  if (m.t === "here") {
    TK__sl.collect.forEach(function (fn) {
      fn(m);
    });
    return;
  }
  if (m.t === "done") {
    TK__sl.waitDone.slice().forEach(function (w) {
      w.fn(m);
    });
    return;
  }
  // Only a portal window answers or acts.
  if (!TK__sl.receiving) return;
  if (m.t === "who") {
    TK__slPost({ t: "here", to: m.from, focusedAt: TK__sl.focusedAt, visible: document.visibilityState === "visible" });
    return;
  }
  if (m.to !== TK__sl.id) return;
  var reply = function () {
    TK__slPost({ t: "done", to: m.from });
  };
  var raise = function () {
    try {
      window.focus();
    } catch (e) {}
  };
  if (m.t === "open") {
    var href = null;
    var tgt = null;
    if (typeof m.hash === "string") href = m.hash;
    else {
      tgt = TK__slTarget(m.target);
      if (tgt && typeof LK_href === "function") href = LK_href(tgt);
    }
    if (!href || !TK_slateForwardOk(href)) return;
    if (tgt && typeof LK_go === "function") LK_go(tgt, TK__slHint(m.hint));
    else {
      try {
        window.location.hash = href;
      } catch (e) {}
    }
    raise();
    reply();
    return;
  }
  if (m.t === "open-chat") {
    var cid = typeof m.clientId === "string" ? m.clientId : "";
    if (!/^[\w.-]{1,120}$/.test(cid)) return;
    var email = typeof m.email === "string" && m.email.length <= 200 ? m.email : null;
    var detail = { clientId: cid, email: email, handled: false };
    try {
      window.dispatchEvent(new CustomEvent("mgb:open-chat", { detail: detail }));
    } catch (e) {}
    // The chat drawer declines on the Inbox page itself (that page is the chat):
    // fall back to the client's Messages tab.
    if (!detail.handled && typeof LK_go === "function") LK_go({ clientId: cid, tab: "messages" }, email ? { email: email } : null);
    raise();
    reply();
    return;
  }
  if (m.t === "dock-go") {
    var hash = typeof m.hash === "string" && TK_slateDockHashOk(m.hash) ? m.hash : "#/tasks/my";
    try {
      if (window.location.hash !== hash) window.location.hash = hash;
    } catch (e) {}
    raise();
    reply();
  }
}

// Ask the portals who is there; cb(portalId | null) after TK_SLATE_ASK_MS.
function TK__slAsk(cb) {
  var replies = [];
  var collector = function (m) {
    replies.push({ from: m.from, focusedAt: m.focusedAt, visible: m.visible === true });
  };
  TK__sl.collect.push(collector);
  var posted = TK__slPost({ t: "who" });
  setTimeout(
    function () {
      TK__sl.collect = TK__sl.collect.filter(function (f) {
        return f !== collector;
      });
      cb(posted ? TK_slateDockPick(replies) : null);
    },
    posted ? TK_SLATE_ASK_MS : 0,
  );
}

// A portal window (not the Tasks shell) listens for the Slate app. One
// listener however often it is called. Returns a stop function (or null when
// the browser has no BroadcastChannel).
function TK_startSlateReceiver() {
  if (TK__sl.receiving) return TK__sl.stopRecv;
  if (!TK__slChan()) return null;
  TK__sl.receiving = true;
  var stamp = function () {
    if (document.visibilityState === "visible") TK__sl.focusedAt = Date.now();
  };
  window.addEventListener("focus", stamp);
  document.addEventListener("visibilitychange", stamp);
  stamp();
  TK__sl.stopRecv = function () {
    TK__sl.receiving = false;
    TK__sl.stopRecv = null;
    window.removeEventListener("focus", stamp);
    document.removeEventListener("visibilitychange", stamp);
  };
  return TK__sl.stopRecv;
}

// ---- The app side: forward, chat, dock -----------------------------------------------

// The portal said "done": tell the person where the link went (Chrome does not
// raise a background tab on focus()).
function TK__slAwaitDone(portal) {
  var finished = false;
  var onDone = function (m) {
    if (finished || m.from !== portal) return;
    finished = true;
    TK__sl.waitDone = TK__sl.waitDone.filter(function (w) {
      return w.fn !== onDone;
    });
    TK__slToast("Opened in your portal window");
  };
  TK__sl.waitDone.push({ to: portal, fn: onDone });
  setTimeout(function () {
    if (finished) return;
    finished = true;
    TK__sl.waitDone = TK__sl.waitDone.filter(function (w) {
      return w.fn !== onDone;
    });
  }, 2000);
}
function TK__slSend(portal, msg) {
  if (!portal) return false;
  TK__slAwaitDone(portal);
  return TK__slPost(Object.assign({ to: portal }, msg));
}

// No portal answered: a new portal tab ("/?shell=portal" leaves the shell).
function TK__slOpenTab(href) {
  try {
    var w = window.open("/?shell=portal" + href, "_blank");
    if (w) w.opener = null;
    else TK__slToast(TK__slBlocked());
  } catch (e) {}
}

// Show an LK target ({ clientId, tab, ... } or { place, ... }) in a portal
// window. o = { t, hint }. Nobody answering opens a new portal tab.
function TK_slateForward(o) {
  var tgt = o && o.t;
  if (!tgt || typeof LK_href !== "function") return;
  var href = LK_href(tgt);
  if (!TK_slateForwardOk(href)) return;
  TK__slTrack("slate-app-forward");
  var target = TK__slTarget(tgt);
  var hint = TK__slHint(o.hint);
  TK__slAsk(function (portal) {
    if (portal && target && TK__slSend(portal, { t: "open", target: target, hint: hint })) return;
    TK__slOpenTab(href);
  });
}

// A plain "#/..." place (a link clicked inside the app, Help, Open full portal).
function TK_slateForwardHash(hash) {
  if (!TK_slateForwardOk(hash)) return;
  TK__slTrack("slate-app-forward", "hash");
  TK__slAsk(function (portal) {
    if (portal && TK__slSend(portal, { t: "open", hash: hash })) return;
    TK__slOpenTab(hash);
  });
}

// Open the staff chat on a client and person in a portal window. Returns true
// (the answer is not known yet), so callers never fall back to something else.
function TK_slateForwardChat(clientId, email) {
  var cid = String(clientId || "");
  if (!/^[\w.-]{1,120}$/.test(cid)) return false;
  TK__slTrack("slate-app-forward", "chat");
  TK__slAsk(function (portal) {
    if (portal && TK__slSend(portal, { t: "open-chat", clientId: cid, email: email || null })) return;
    TK__slOpenTab(typeof LK_href === "function" ? LK_href({ clientId: cid, tab: "messages" }) : "#/inbox");
  });
  return true;
}

// Dock in portal: the portal picked by TK_slateDockPick opens its Slate page on
// the same route, then this window tries to close. No portal: a new portal tab
// on that route. cb("stay") when the browser would not close this window.
function TK_slateDock(hash, cb) {
  var h = TK_slateDockHashOk(hash) ? hash : "#/tasks/my";
  TK__slTrack("slate-app-forward", "dock");
  // Opened inside the click so the pop-up blocker lets it through; used only
  // when no portal answers.
  var blank = null;
  try {
    blank = window.open("", "_blank");
    if (blank) blank.opener = null;
  } catch (e) {
    blank = null;
  }
  var closeSelf = function () {
    try {
      window.close();
    } catch (e) {}
    setTimeout(function () {
      if (typeof cb === "function") cb("stay");
    }, 300);
  };
  TK__slAsk(function (portal) {
    if (portal) {
      try {
        if (blank) blank.close();
      } catch (e) {}
      var finished = false;
      var onDone = function (m) {
        if (m.from === portal) finish();
      };
      var finish = function () {
        if (finished) return;
        finished = true;
        TK__sl.waitDone = TK__sl.waitDone.filter(function (w) {
          return w.fn !== onDone;
        });
        closeSelf();
      };
      TK__sl.waitDone.push({ to: portal, fn: onDone });
      if (!TK__slPost({ t: "dock-go", to: portal, hash: h })) finish();
      else setTimeout(finish, 700);
      return;
    }
    if (blank) {
      try {
        blank.location.href = "/?shell=portal" + h;
      } catch (e) {}
      closeSelf();
      return;
    }
    TK__slToast(TK__slBlocked());
    if (typeof cb === "function") cb("stay");
  });
}

// LK_go's check (DeepLink.jsx). Inside the Slate app a place that is not a
// Tasks page opens in a portal window; returns true when it took the link.
// Tasks pages, and the legacy Work › Tasks task links (opened here on My tasks
// with the task drawer), stay in the app.
function TK_slateGuard(t, hint) {
  if (!t || !TK_slateInApp()) return false;
  var href = typeof LK_href === "function" ? LK_href(t) : "";
  if (TK_slateIsTasksHash(href)) return false;
  if (!t.clientId && t.place === "work" && t.tab === "tasks") {
    var item = String(t.item || "");
    var id = item.indexOf("task:") === 0 ? item.slice(5) : "";
    var to = id && /^[A-Za-z0-9%._~-]{1,120}$/.test(id) ? "#/tasks/my?item=task:" + id : "#/tasks/my";
    if (typeof TK_navigate === "function") TK_navigate(to);
    else {
      try {
        window.location.hash = to;
      } catch (e) {}
    }
    return true;
  }
  TK_slateForward({ t: t, hint: hint || null });
  return true;
}

// ---- Launchers (portal side) ----------------------------------------------------

// "Open Slate app" when it is not installed: the /slate pop-up (TK_popOut with
// opts.app). Called inside the click so the pop-up blocker lets it through.
function TK_openSlateApp(hash) {
  var w = typeof TK_popOut === "function" ? TK_popOut(hash, { app: true }) : null;
  TK__slTrack("slate-app-open", w ? undefined : "blocked:true");
  return w;
}

// "Install Slate app": the install page in a normal tab (a pop-up usually gets
// no install prompt). Returns "standalone" inside an installed app, where the
// caller shows the copy-link dialog instead.
function TK_slateGet() {
  var ia = TK__slInstall();
  if (ia && ia.slateStandalone && ia.slateStandalone()) return "standalone";
  TK__slTrack("slate-app-install", "get");
  var w = null;
  try {
    w = window.open("/slate?install=1", "_blank");
    if (w) w.opener = null;
  } catch (e) {
    w = null;
  }
  if (!w) TK__slToast(TK__slBlocked());
  return w ? "opened" : "blocked";
}

function TK__slCopyLink(url) {
  var done = function () {
    TK__slToast("Link copied.");
  };
  var fail = function () {
    TK__slToast("Couldn't copy. Select the link and copy it.");
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fail);
    else fail();
  } catch (e) {
    fail();
  }
}

// kind "installed": open it from the Dock, or a window instead.
// kind "standalone": an installed app can't install another; copy the link.
function TK_SlateDialog(props) {
  var kind = props.kind;
  var onClose = props.onClose;
  if (!kind || typeof TK_vModal !== "function") return null;
  var name = TK__slName();
  return (
    <TK_vModal onClose={onClose} labelledBy="tk-slate-dlg-title" className="confirm-modal">
      {kind === "installed" ? (
        <>
          <h3 id="tk-slate-dlg-title">Open {name}</h3>
          <p>Open it from your Dock or Start menu.</p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={function () {
                onClose();
                TK_openSlateApp(props.hash);
              }}
            >
              Open in a window instead
            </button>
            <button
              type="button"
              className="btn-secondary"
              title={"Removed " + name + "? Install it again"}
              onClick={function () {
                onClose();
                TK_slateGet();
              }}
            >
              Install again
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <h3 id="tk-slate-dlg-title">Install {name}</h3>
          <p>
            Open <b>{window.location.host}/slate</b> in Chrome or Edge to install {name}. An installed app can't install another one.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={function () {
                TK__slCopyLink(window.location.origin + "/slate");
              }}
            >
              Copy link
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </TK_vModal>
  );
}

// The launch buttons: "Open Slate app" plus "Install Slate app" where the
// browser can install apps. props: { hash | getHash(), tour, iconSize,
// className }. The caller renders it only when TK_useSlateAppOn() is true.
function TK_SlateLaunch(props) {
  var dPair = React.useState(null);
  var dlg = dPair[0];
  var setDlg = dPair[1];
  var ia = TK__slInstall();
  var items = TK_slateLaunchItems({
    installed: !!(ia && ia.slateInstalled && ia.slateInstalled()),
    canInstall: !!(ia && ia.slateSupported && ia.slateSupported()),
    mobile: TK__slMobile(),
  });
  if (!items.length) return null;
  var hashNow = function () {
    if (typeof props.getHash === "function") return props.getHash();
    return props.hash || "#/tasks/my";
  };
  var size = props.iconSize || 16;
  var cls = props.className || "tk-tool-btn tk-popout-btn";
  var run = function (id) {
    if (id === "open") TK_openSlateApp(hashNow());
    else if (id === "open-app") setDlg("installed");
    else if (id === "install") {
      if (TK_slateGet() === "standalone") setDlg("standalone");
    }
  };
  return (
    <>
      {items.map(function (it, i) {
        var first = i === 0;
        return (
          <button
            key={it.id}
            type="button"
            className={cls}
            data-tour={first && props.tour ? props.tour : undefined}
            title={it.id === "install" ? "Install " + TK__slName() + " on this computer" : "Open " + TK__slName() + " in its own window"}
            onClick={function () {
              run(it.id);
            }}
          >
            <TK_vIcon name={it.id === "install" ? "plus" : "window"} size={size} />
            <span>{it.label}</span>
          </button>
        );
      })}
      {dlg ? (
        <TK_SlateDialog
          kind={dlg}
          hash={hashNow()}
          onClose={function () {
            setDlg(null);
          }}
        />
      ) : null}
    </>
  );
}

// "Install MGB Slate" on /slate?install=1 inside the app (a normal tab; the
// index.html install script holds the browser's install prompt there).
function TK_SlateInstallBanner() {
  var ia = TK__slInstall();
  var bPair = React.useState(0);
  var bump = bPair[1];
  var sPair = React.useState(ia && ia.slateInstalled && ia.slateInstalled() ? "installed" : "idle");
  var state = sPair[0];
  var setState = sPair[1];
  React.useEffect(function () {
    var on = function () {
      bump(function (n) {
        return n + 1;
      });
    };
    var inst = function () {
      setState("installed");
    };
    window.addEventListener("mgb-slate-prompt", on);
    window.addEventListener("mgb-slate-installed", inst);
    return function () {
      window.removeEventListener("mgb-slate-prompt", on);
      window.removeEventListener("mgb-slate-installed", inst);
    };
  }, []);
  if (!ia) return null;
  if (ia.slateStandalone && ia.slateStandalone()) return null;
  var asked = false;
  try {
    asked = new URLSearchParams(window.location.search).get("install") === "1";
  } catch (e) {}
  if (!asked) return null;
  var name = TK__slName();
  var install = function () {
    TK__slTrack("slate-app-install", "prompt");
    ia.prompt().then(function (r) {
      if (r === "accepted") setState("installed");
      else
        bump(function (n) {
          return n + 1;
        });
    });
  };
  var style = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "10px",
    padding: "8px 14px",
    background: "var(--warm-bg)",
    color: "var(--warm-text)",
    borderBottom: "1px solid var(--warm-border)",
    fontSize: "13px",
  };
  return (
    <div className="tk-slate-banner" role="status" style={style}>
      {state === "installed" ? (
        <>
          <span>Installed. Open {name} from your Dock or Start menu.</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={function () {
              window.close();
            }}
          >
            Close this tab
          </button>
        </>
      ) : ia.slateCanPrompt && ia.slateCanPrompt() ? (
        <>
          <span>Install {name} as an app on this computer.</span>
          <button type="button" className="btn-primary" onClick={install}>
            Install
          </button>
        </>
      ) : (
        <span>Click the install icon at the right end of the address bar, or the browser menu, then Install {name}.</span>
      )}
    </div>
  );
}

// ---- Boot (app.jsx, once for a signed-in staff member) --------------------------------
// Reads the Slate app flag, tells the index.html install script (it only acts
// on /slate), runs the portal receiver while the app is on (outside the shell)
// and, inside the app, sends links that leave Tasks to a portal. Returns a
// cleanup. With the app off it only reads the flag and says "off" on /slate.
function TK_slateBoot() {
  var stopRecv = null;
  var stopHash = null;
  var stopTitle = null;
  var told = null;
  // The window title inside the app is "MGB Slate"; app.jsx's page-title
  // effect keeps writing its own, so a small observer puts it back.
  var startTitle = function () {
    var name = TK__slName();
    var put = function () {
      try {
        if (document.title !== name) document.title = name;
      } catch (e) {}
    };
    put();
    var mo = null;
    try {
      if (typeof MutationObserver === "function" && document.head) {
        mo = new MutationObserver(put);
        mo.observe(document.head, { childList: true, subtree: true, characterData: true });
      }
    } catch (e) {
      mo = null;
    }
    return function () {
      try {
        if (mo) mo.disconnect();
      } catch (e) {}
    };
  };
  var startHashGuard = function () {
    // The previous hash comes from the event itself (TK_navigate moves with
    // pushState, which fires no hashchange, so a remembered hash goes stale).
    var onHash = function (ev) {
      if (!ev || !ev.isTrusted) return; // our own synthetic event below
      var h = window.location.hash;
      var prev = "";
      try {
        prev = new URL(ev.oldURL).hash;
      } catch (e) {
        prev = "";
      }
      if (h === prev) return;
      var active = false;
      try {
        active = !!(navigator.userActivation && navigator.userActivation.isActive);
      } catch (e) {}
      // Hash changes the app makes itself carry no user activation, and Tasks
      // pages stay here.
      if (!active || !h || TK_slateIsTasksHash(h) || !TK_slateForwardOk(h)) return;
      TK_slateForwardHash(h);
      var back = TK_slateIsTasksHash(prev) ? prev : "#/tasks/my";
      try {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + back);
        window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: ev.newURL, newURL: window.location.href }));
      } catch (e) {}
    };
    window.addEventListener("hashchange", onHash);
    return function () {
      window.removeEventListener("hashchange", onHash);
    };
  };
  var sync = function () {
    var st = null;
    try {
      st = TK_slateFlag.getState();
    } catch (e) {
      st = null;
    }
    if (!st) return;
    var on = st.appOn === true;
    var ia = TK__slInstall();
    if ((on || st.appFlagKnown) && told !== on && ia && typeof ia.setSlate === "function") {
      told = on;
      try {
        ia.setSlate(on);
      } catch (e) {}
    }
    var portal = window.MGB_SHELL !== "tasks";
    if (on && portal && !stopRecv) stopRecv = TK_startSlateReceiver();
    else if ((!on || !portal) && stopRecv) {
      stopRecv();
      stopRecv = null;
    }
    var inApp = on && !portal && TK__slOnSlatePath();
    if (inApp && !stopHash) stopHash = startHashGuard();
    else if (!inApp && stopHash) {
      stopHash();
      stopHash = null;
    }
    if (inApp && !stopTitle) stopTitle = startTitle();
    else if (!inApp && stopTitle) {
      stopTitle();
      stopTitle = null;
    }
  };
  var unsub = TK__slSubscribe(sync);
  sync();
  try {
    if (typeof TK_readSlateAppFlag === "function") TK_readSlateAppFlag();
  } catch (e) {}
  return function () {
    try {
      unsub();
    } catch (e) {}
    if (stopRecv) stopRecv();
    if (stopHash) stopHash();
    if (stopTitle) stopTitle();
    stopRecv = null;
    stopHash = null;
    stopTitle = null;
  };
}
