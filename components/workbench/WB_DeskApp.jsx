// ----------------------------------------------------------------------------
// WB_DeskApp: MGB Desk in its own window (docs: specs/spec-mgb-desk-app.md).
//
// The Desk column can open as a small window of its own: a pop-up (Open MGB
// Desk, every browser) or an installed app (Get MGB Desk, Chrome and Edge on a
// computer, its own manifest /desk.webmanifest and id). Everything here is
// hidden behind WB_deskAppIsOn: the Desk is live and the person ticked "MGB
// Desk window preview" or the firm switch tk_settings.desk_app_enabled is on.
//
//   WB_deskOpenWindow()    the pop-up launcher (reuses the window named mgb-desk)
//   WB_deskGet()           opens /desk?install=1 in a normal tab (install page)
//   WB_DeskMenu            the "MGB Desk app" hover menu in the portal Desk head
//   WB_DeskAppShell        the window itself (app.jsx renders it on /desk)
//   WB_startDeskReceiver() the portal side of the BroadcastChannel "mgb-desk"
//   WB_deskForward / WB_deskForwardChat / WB_deskDock  the window side
//
// Channel messages are { v:1, t:<type>, from:<window id>, to?:<window id> }.
// Types: who / here (find a portal), open { target | hash, hint }, open-chat
// { clientId, email }, dock-go { tab, taskId }, done, desk-here { installed }.
// Same-origin only; every hash is checked with WB_deskForwardOk, wrong v and
// own messages are dropped, and an action runs only when "to" is this window.
// Browser file; loads after WB_HubClient.jsx. Pure rules: WB_logic.js.
// ----------------------------------------------------------------------------

var WB_DESK_CH = "mgb-desk";
var WB_DESK_ASK_MS = 250; // how long the window waits for portals to answer "who"
var WB_DESK_SHELL_KEY = "mgb_shell_v1";
var WB__dk = {
  ch: null,
  id: "dk" + Math.random().toString(36).slice(2, 10),
  receiving: false,
  focusedAt: Date.now(),
  collect: [], // reply collectors for who / here
  waitDone: [], // { to, fn }
  seen: { at: 0, installed: false }, // the last desk-here this portal heard
  stops: [],
};

function WB__dkLs(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function WB__dkTrack(name, detail) {
  try {
    if (typeof window.MGB_track === "function") window.MGB_track(name, detail);
  } catch (e) {}
}
function WB__dkMobile() {
  try {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod|Android|Mobile|Tablet/i.test(ua)) return true;
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
    if (/Linux/.test(ua) && !/CrOS/.test(ua) && navigator.maxTouchPoints > 0) return true;
  } catch (e) {}
  return false;
}
function WB__dkInstall() {
  return typeof window !== "undefined" && window.mgbInstallApp ? window.mgbInstallApp : null;
}
function WB__dkClearShell() {
  try {
    window.sessionStorage.removeItem(WB_DESK_SHELL_KEY);
  } catch (e) {}
  try {
    window.MGB_SHELL = null;
  } catch (e) {}
}

// ---- The channel ------------------------------------------------------------
function WB__dkPlain(o, keys, cap) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const out = {};
  const max = cap || 10;
  Object.keys(o).forEach((k) => {
    if (keys && keys.indexOf(k) < 0) return;
    if (Object.keys(out).length >= max) return;
    const v = o[k];
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" && isFinite(v)) out[k] = String(v);
  });
  return Object.keys(out).length ? out : null;
}
// An LK target ({ clientId, tab, sub, item, month, account } or { place, ... }).
function WB__dkTarget(t) {
  return WB__dkPlain(t, ["clientId", "place", "tab", "sub", "item", "month", "account", "client"], 10);
}
function WB__dkHint(h) {
  return WB__dkPlain(h, null, 10);
}

function WB__dkChan() {
  if (WB__dk.ch) return WB__dk.ch;
  try {
    if (typeof BroadcastChannel === "function") {
      WB__dk.ch = new BroadcastChannel(WB_DESK_CH);
      WB__dk.ch.onmessage = (ev) => WB__dkOnMsg(ev && ev.data);
    }
  } catch (e) {
    WB__dk.ch = null;
  }
  return WB__dk.ch;
}
function WB__dkPost(msg) {
  const c = WB__dkChan();
  if (!c) return false;
  try {
    c.postMessage(Object.assign({ v: 1, from: WB__dk.id }, msg));
    return true;
  } catch (e) {
    return false;
  }
}

function WB__dkOnMsg(m) {
  if (!m || typeof m !== "object" || m.v !== 1 || typeof m.t !== "string") return;
  if (m.from === WB__dk.id || typeof m.from !== "string") return;
  if (m.to && m.to !== WB__dk.id) return;
  if (m.t === "here") {
    WB__dk.collect.forEach((fn) => fn(m));
    return;
  }
  if (m.t === "done") {
    WB__dk.waitDone.slice().forEach((w) => w.fn(m));
    return;
  }
  if (m.t === "desk-here") {
    WB__dk.seen = { at: Date.now(), installed: m.installed === true };
    return;
  }
  if (!WB__dk.receiving) return;
  if (m.t === "who") {
    WB__dkPost({ t: "here", to: m.from, focusedAt: WB__dk.focusedAt, visible: document.visibilityState === "visible" });
    return;
  }
  // Everything below acts, so it is for this window only.
  if (m.to !== WB__dk.id) return;
  const reply = () => WB__dkPost({ t: "done", to: m.from });
  const raise = () => {
    try {
      window.focus();
    } catch (e) {}
  };
  if (m.t === "open") {
    let href = null;
    let tgt = null;
    if (typeof m.hash === "string") href = m.hash;
    else {
      tgt = WB__dkTarget(m.target);
      if (tgt && typeof LK_href === "function") href = LK_href(tgt);
    }
    if (!href || !WB_deskForwardOk(href)) return;
    if (tgt && typeof LK_go === "function") LK_go(tgt, WB__dkHint(m.hint));
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
    const cid = typeof m.clientId === "string" ? m.clientId : "";
    if (!/^[\w.-]{1,120}$/.test(cid)) return;
    const email = typeof m.email === "string" && m.email.length <= 200 ? m.email : null;
    const detail = { clientId: cid, email: email, handled: false };
    try {
      window.dispatchEvent(new CustomEvent("mgb:open-chat", { detail: detail }));
    } catch (e) {}
    // The chat drawer declines on the Inbox page itself (that page is the chat).
    // Fall back to the client's Messages tab, the same place the portal row goes.
    if (!detail.handled && typeof LK_go === "function") LK_go({ clientId: cid, tab: "messages" }, email ? { email: email } : null);
    raise();
    reply();
    return;
  }
  if (m.t === "dock-go") {
    try {
      WB_store.setDrawerOpen(true, "dock");
      const tab = typeof m.tab === "string" && WB_hubTabIds(true).indexOf(m.tab) >= 0 ? m.tab : null;
      if (tab) WB_store.setHub({ tab: tab });
      const tid = typeof m.taskId === "string" || typeof m.taskId === "number" ? String(m.taskId) : "";
      if (tid && /^[\w.-]{1,120}$/.test(tid)) WB_store.drill(tid, { from: "dock" });
    } catch (e) {}
    raise();
    reply();
  }
}

// Ask the portals who is there; cb(portalId | null) after WB_DESK_ASK_MS.
function WB__dkAsk(cb) {
  const replies = [];
  const collector = (m) => replies.push({ from: m.from, focusedAt: m.focusedAt, visible: m.visible === true });
  WB__dk.collect.push(collector);
  const posted = WB__dkPost({ t: "who" });
  setTimeout(
    () => {
      WB__dk.collect = WB__dk.collect.filter((f) => f !== collector);
      cb(posted ? WB_deskDockPick(replies) : null);
    },
    posted ? WB_DESK_ASK_MS : 0,
  );
}

// A portal window (not the desk shell) listens for the Desk window. One
// listener however often it is called. Returns a stop function.
function WB_startDeskReceiver() {
  if (WB__dk.receiving) return WB__dk.stopRecv || function () {};
  if (!WB__dkChan()) return null;
  WB__dk.receiving = true;
  const stamp = () => {
    if (document.visibilityState === "visible") WB__dk.focusedAt = Date.now();
  };
  window.addEventListener("focus", stamp);
  document.addEventListener("visibilitychange", stamp);
  stamp();
  WB__dk.stopRecv = () => {
    WB__dk.receiving = false;
    WB__dk.stopRecv = null;
    window.removeEventListener("focus", stamp);
    document.removeEventListener("visibilitychange", stamp);
  };
  return WB__dk.stopRecv;
}

// ---- The window side: forward, chat, dock ------------------------------------
function WB__dkOpenTab(href) {
  try {
    const w = window.open("/?shell=portal" + href, "_blank");
    if (w) w.opener = null;
    else WB_toast("Your browser blocked the new tab. Allow pop-ups for this site, then try again.");
  } catch (e) {}
}

// Show an LK target ({ clientId, tab, ... } or { place, ... }) in a portal
// window. o = { t, hint }. Nobody answering opens a new portal tab.
function WB_deskForward(o) {
  const tgt = o && o.t;
  if (!tgt || typeof LK_href !== "function") return;
  const href = LK_href(tgt);
  if (!WB_deskForwardOk(href)) return;
  WB__dkTrack("desk-app-forward");
  const target = WB__dkTarget(tgt);
  const hint = WB__dkHint(o.hint);
  WB__dkAsk((portal) => {
    if (portal && target && WB__dkPost({ t: "open", to: portal, target: target, hint: hint })) return;
    WB__dkOpenTab(href);
  });
}

// A plain "#/..." link clicked inside the window (the hashchange catch-all).
function WB_deskForwardHash(hash) {
  if (!WB_deskForwardOk(hash)) return;
  WB__dkTrack("desk-app-forward", "hash");
  WB__dkAsk((portal) => {
    if (portal && WB__dkPost({ t: "open", to: portal, hash: hash })) return;
    WB__dkOpenTab(hash);
  });
}

// Open the staff chat on a client and person in a portal window. Returns true
// (the answer is not known yet), so callers never fall back to something else.
function WB_deskForwardChat(clientId, email) {
  const cid = String(clientId || "");
  if (!/^[\w.-]{1,120}$/.test(cid)) return false;
  WB__dkTrack("desk-app-forward", "chat");
  WB__dkAsk((portal) => {
    if (portal && WB__dkPost({ t: "open-chat", to: portal, clientId: cid, email: email || null })) return;
    WB__dkOpenTab(typeof LK_href === "function" ? LK_href({ clientId: cid, tab: "messages" }) : "#/inbox");
  });
  return true;
}

// Dock back: the portal opens the Desk column on the same tab and task, then
// this window closes. cb("stay") when the browser would not close it.
function WB_deskDock(cb) {
  WB__dkTrack("desk-app-dock");
  let tab = "inbox";
  let taskId = null;
  try {
    const st = WB_store.getState();
    tab = st.hub && st.hub.tab ? st.hub.tab : "inbox";
    const top = st.drill && st.drill.length ? st.drill[st.drill.length - 1] : null;
    taskId = top ? String(top.id) : null;
  } catch (e) {}
  // Opened inside the click so the browser lets it through; used only if no
  // portal answers.
  let blank = null;
  try {
    blank = window.open("", "_blank");
    if (blank) blank.opener = null;
  } catch (e) {
    blank = null;
  }
  const closeSelf = () => {
    try {
      if (window.opener && !window.opener.closed) window.opener.focus();
    } catch (e) {}
    try {
      window.close();
    } catch (e) {}
    setTimeout(() => {
      if (typeof cb === "function") cb("stay");
    }, 300);
  };
  WB__dkAsk((portal) => {
    if (portal) {
      try {
        if (blank) blank.close();
      } catch (e) {}
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        WB__dk.waitDone = WB__dk.waitDone.filter((w) => w.fn !== onDone);
        closeSelf();
      };
      const onDone = (m) => {
        if (m.from === portal) finish();
      };
      WB__dk.waitDone.push({ to: portal, fn: onDone });
      if (!WB__dkPost({ t: "dock-go", to: portal, tab: tab, taskId: taskId })) finish();
      else setTimeout(finish, 700);
      return;
    }
    if (blank) {
      try {
        blank.location.href = "/?shell=portal#/today";
      } catch (e) {}
      closeSelf();
      return;
    }
    // The blank window was blocked too: this window becomes the portal.
    WB__dkClearShell();
    window.location.assign("/?shell=portal#/today");
  });
}

// ---- Launchers (portal side) ------------------------------------------------
// Open MGB Desk in a pop-up. The same named window is reused: a second click
// focuses it. Called inside the click so the pop-up blocker lets it through.
function WB_deskOpenWindow() {
  let saved = null;
  try {
    saved = JSON.parse(WB__dkLs(WB_DESK_WIN_KEY) || "null");
  } catch (e) {
    saved = null;
  }
  const scr = typeof window.screen === "object" && window.screen ? window.screen : {};
  const size = WB_deskWinSize(saved, scr);
  let w = null;
  try {
    w = window.open("", "mgb-desk", WB_deskWinFeatures(size));
  } catch (e) {
    w = null;
  }
  if (!w) {
    WB_toast("Your browser blocked the MGB Desk window. Allow pop-ups for " + window.location.host + ", then try again.");
    WB__dkTrack("desk-app-open", "blocked:true");
    return false;
  }
  let fresh = true;
  try {
    fresh = !w.location.href || w.location.href === "about:blank";
  } catch (e) {}
  if (fresh) {
    try {
      w.location.href = "/desk";
    } catch (e) {}
  } else {
    try {
      w.focus();
    } catch (e) {}
  }
  if (WB__dk.seen.installed && Date.now() - WB__dk.seen.at < 60000) WB_toast("The MGB Desk app is already open.");
  WB__dkTrack(fresh ? "desk-app-open" : "desk-app-focus");
  return true;
}

// Get MGB Desk: the install page in a normal tab (a pop-up usually gets no
// install prompt). Returns "standalone" inside an installed app, where the
// caller shows the copy-link dialog instead.
function WB_deskGet() {
  const ia = WB__dkInstall();
  if (ia && ia.deskStandalone && ia.deskStandalone()) return "standalone";
  WB__dkTrack("desk-app-get");
  let w = null;
  try {
    w = window.open("/desk?install=1", "_blank");
  } catch (e) {
    w = null;
  }
  if (!w) WB_toast("Your browser blocked the new tab. Allow pop-ups for " + window.location.host + ", then try again.");
  return w ? "opened" : "blocked";
}

// ---- Dialogs ------------------------------------------------------------------
function WB_DeskDialog({ kind, onClose }) {
  if (typeof ModalShell !== "function" || !kind) return null;
  const url = window.location.origin + "/desk";
  const copy = () => {
    const done = () => WB_toast("Link copied.");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => WB_toast("Couldn't copy. Select the link and copy it."));
      else WB_toast("Couldn't copy. Select the link and copy it.");
    } catch (e) {
      WB_toast("Couldn't copy. Select the link and copy it.");
    }
  };
  return (
    <ModalShell onClose={onClose} labelledBy="dk-dlg-title" className="confirm-modal">
      {kind === "installed" ? (
        <>
          <h3 id="dk-dlg-title">Open {WB_DESK_APP_NAME}</h3>
          <p>Open {WB_DESK_APP_NAME} from your Dock, Start menu or taskbar.</p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onClose();
                WB_deskOpenWindow();
              }}
            >
              Open in a window instead
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <h3 id="dk-dlg-title">Get {WB_DESK_APP_NAME}</h3>
          <p>
            Open <b>{window.location.host}/desk</b> in Chrome or Edge to install {WB_DESK_APP_NAME}. An installed app can't install another one.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={copy}>
              Copy link
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// The "MGB Desk app" menu in the portal Desk head (opens on hover). The caller (WB_Hub) mounts it only
// when WB_deskAppIsOn is true and the Desk is not the phone sheet.
function WB_DeskMenu() {
  const [dlg, setDlg] = React.useState(null);
  const ia = WB__dkInstall();
  const items = WB_deskLaunchItems({
    installed: !!(ia && ia.deskInstalled && ia.deskInstalled()),
    canInstall: !!(ia && ia.deskSupported && ia.deskSupported()),
    standalone: !!(ia && ia.deskStandalone && ia.deskStandalone()),
    mobile: WB__dkMobile(),
    narrow: false,
  });
  if (!items.length || typeof TK_vMenuButton !== "function") return null;
  const run = (id, close) => {
    close();
    if (id === "open") WB_deskOpenWindow();
    else if (id === "open-app") setDlg("installed");
    else if (id === "get") {
      if (WB_deskGet() === "standalone") setDlg("standalone");
    } else if (id === "help") {
      if (typeof LK_go === "function") LK_go({ place: "help", tab: "workbench" });
      else window.location.hash = "#/help/workbench";
    }
  };
  return (
    <>
      <span data-tour="wb-desk-menu">
        <TK_vMenuButton className="wb-more-btn" label={WB_DESK_APP_NAME + " app"} title={"Open or install the " + WB_DESK_APP_NAME + " app (hover to see options)"} hoverOpen={true} ariaLabel={WB_DESK_APP_NAME + " app options"} menuLabel={WB_NAME + " menu"} align="right">
          {(close) =>
            items.map((it) => (
              <button key={it.id} type="button" role="menuitem" className="tk-menu-item" onClick={() => run(it.id, close)}>
                {it.label}
              </button>
            ))
          }
        </TK_vMenuButton>
      </span>
      {dlg && <WB_DeskDialog kind={dlg} onClose={() => setDlg(null)} />}
    </>
  );
}

// ---- The window --------------------------------------------------------------
function WB__dkGoPortal() {
  WB__dkClearShell();
  window.location.assign("/?shell=portal");
}

function WB_DeskNotice({ phone }) {
  return (
    <main className="dk-panel" role="main">
      <h1 className="dk-panel-title">{WB_DESK_APP_NAME}</h1>
      {phone ? (
        <p>{WB_DESK_APP_NAME} works on a computer.</p>
      ) : (
        <p>{WB_DESK_APP_NAME} isn't turned on for you yet.</p>
      )}
      <button type="button" className="btn-primary" onClick={WB__dkGoPortal}>
        Open the portal
      </button>
    </main>
  );
}

// "Install MGB Desk" on /desk?install=1 (a normal tab; the desk shell holds the
// browser's install prompt).
function WB_DeskInstallBanner() {
  const ia = WB__dkInstall();
  const [, bump] = React.useState(0);
  const [state, setState] = React.useState(ia && ia.deskInstalled && ia.deskInstalled() ? "installed" : "idle");
  React.useEffect(() => {
    const on = () => bump((n) => n + 1);
    const inst = () => setState("installed");
    window.addEventListener("mgb-desk-prompt", on);
    window.addEventListener("mgb-desk-installed", inst);
    return () => {
      window.removeEventListener("mgb-desk-prompt", on);
      window.removeEventListener("mgb-desk-installed", inst);
    };
  }, []);
  if (!ia) return null;
  if (ia.deskStandalone && ia.deskStandalone()) return null;
  let asked = false;
  try {
    asked = new URLSearchParams(window.location.search).get("install") === "1";
  } catch (e) {}
  if (!asked) return null;
  const install = () => {
    WB__dkTrack("desk-app-install");
    ia.prompt().then((r) => {
      if (r === "accepted") setState("installed");
      else bump((n) => n + 1);
    });
  };
  return (
    <div className="dk-banner" role="status">
      {state === "installed" ? (
        <>
          <span>Installed. Open {WB_DESK_APP_NAME} from your Dock or Start menu.</span>
          <button type="button" className="btn-secondary" onClick={() => window.close()}>
            Close this tab
          </button>
        </>
      ) : ia.deskCanPrompt && ia.deskCanPrompt() ? (
        <>
          <span>Install {WB_DESK_APP_NAME} as an app on this computer.</span>
          <button type="button" className="btn-primary" onClick={install}>
            Install
          </button>
        </>
      ) : (
        <span>Click the install icon at the right end of the address bar, or the browser menu, then Install {WB_DESK_APP_NAME}.</span>
      )}
    </div>
  );
}

// props: the same ones app.jsx passes WB_Drawer (me, isAdmin, clients,
// currentClientId, page, messagesUnread, chatClientId, clientCounts,
// pageClient, staffUser, canManageTemplates, canCreateTemplates,
// onOpenTemplates). Rendered only for a signed-in staff member on /desk.
function WB_DeskAppShell(props) {
  const s = WB_useStore(null, false, false);
  const [count, setCount] = React.useState(0);
  const [stay, setStay] = React.useState(false);
  const [docking, setDocking] = React.useState(false);
  React.useEffect(() => {
    try {
      if (!s.flagKnown) WB_store.readFlag();
      if (!s.appFlagKnown) WB_store.readAppFlag();
    } catch (e) {}
  }, []);
  const plan = WB_deskShellPlan({
    shell: "desk",
    pathname: window.location.pathname,
    signedIn: true,
    isStaff: true,
    isClient: false,
    impersonating: false,
    appOn: !!s.appOn,
    flagsKnown: !!(s.flagKnown && s.appFlagKnown),
    mobile: WB__dkMobile(),
  });
  const live = plan === "desk";

  React.useEffect(() => {
    document.body.classList.add("dk-shell");
    return () => document.body.classList.remove("dk-shell");
  }, []);
  React.useEffect(() => {
    document.title = (live && count > 0 ? "(" + count + ") " : "") + WB_DESK_APP_NAME;
  });
  // Say hello (so a portal knows the app is open) and remember the pop-up's size.
  React.useEffect(() => {
    if (!live) return undefined;
    const ia = WB__dkInstall();
    const hello = () => WB__dkPost({ t: "desk-here", installed: !!(ia && ia.deskStandalone && ia.deskStandalone()) });
    hello();
    const iv = setInterval(hello, 30000);
    let timer = 0;
    const popup = window.name === "mgb-desk" && !(ia && ia.deskStandalone && ia.deskStandalone());
    const onResize = () => {
      if (!popup) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const w = window.outerWidth;
          const h = window.outerHeight;
          if (w > 0 && h > 0) window.localStorage.setItem(WB_DESK_WIN_KEY, JSON.stringify({ w: w, h: h }));
        } catch (e) {}
      }, 500);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearInterval(iv);
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [live]);
  // A link the person clicks inside the window that changes the hash (for
  // example "Slate" under the list) opens in a portal instead, and the
  // window's own hash is put back. Hash changes the app makes itself carry no
  // user activation and are left alone.
  React.useEffect(() => {
    if (!live) return undefined;
    let last = window.location.hash;
    const onHash = () => {
      const h = window.location.hash;
      if (h === last) return;
      const prev = last;
      last = h;
      let active = false;
      try {
        active = !!(navigator.userActivation && navigator.userActivation.isActive);
      } catch (e) {}
      if (!active || !h) return;
      WB_deskForwardHash(h);
      try {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + prev);
        last = prev;
      } catch (e) {}
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [live]);
  // A different person signed in on this browser: never show one person's
  // Desk under another's session.
  React.useEffect(() => {
    const email = props.staffUser && props.staffUser.email ? String(props.staffUser.email).toLowerCase() : "";
    const c = typeof window !== "undefined" ? window.mgbSupabase : null;
    if (!c || !c.auth || typeof c.auth.onAuthStateChange !== "function") return undefined;
    let sub = null;
    try {
      const r = c.auth.onAuthStateChange((ev, session) => {
        const now = session && session.user && session.user.email ? String(session.user.email).toLowerCase() : "";
        if (now && email && now !== email) window.location.reload();
      });
      sub = r && r.data ? r.data.subscription : null;
    } catch (e) {}
    return () => {
      try {
        if (sub) sub.unsubscribe();
      } catch (e) {}
    };
  }, []);

  if (plan === "wait") return <div className="dk-wait" role="status">Loading {WB_DESK_APP_NAME}…</div>;
  if (plan === "off" || plan === "phone") return <WB_DeskNotice phone={plan === "phone"} />;
  if (plan !== "desk") return null;

  const openPortal = () => {
    try {
      const w = window.open("/?shell=portal", "_blank");
      if (w) w.opener = null;
    } catch (e) {}
  };
  const dock = () => {
    setDocking(true);
    WB_deskDock((r) => {
      setDocking(false);
      if (r === "stay") setStay(true);
    });
  };
  return (
    <div className="dk-stage">
      <header className="dk-bar">
        <h1 className="dk-brand">
          {WB_DESK_APP_NAME}
          {count > 0 && <span className="wb-chip-n">{count}</span>}
        </h1>
        {stay && <span className="dk-stay" role="status">You can close this window now.</span>}
        <button type="button" className="btn-secondary dk-dock" onClick={dock} disabled={docking}>
          Dock back
        </button>
        {typeof TK_vMenuButton === "function" && (
          <TK_vMenuButton className="btn-secondary dk-account" label="Menu" ariaLabel="MGB Desk window menu" menuLabel="Window menu" align="right">
            {(close) => (
              <>
                <button type="button" role="menuitem" className="tk-menu-item" onClick={() => { close(); openPortal(); }}>
                  Open full portal
                </button>
                <button type="button" role="menuitem" className="tk-menu-item" onClick={() => { close(); WB_deskForward({ t: { place: "help", tab: "workbench" } }); }}>
                  Help
                </button>
              </>
            )}
          </TK_vMenuButton>
        )}
      </header>
      <WB_DeskInstallBanner />
      <div className="dk-body">
        <WB_Drawer variant="window" onCount={setCount} {...props} />
      </div>
    </div>
  );
}
