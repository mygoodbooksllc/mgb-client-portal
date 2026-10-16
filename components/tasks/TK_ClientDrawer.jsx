// ----------------------------------------------------------------------------
// TK_ClientDrawer.jsx — the client tasks strip, the client tasks panel and the
// pop-out's "Follow my client" hook (2026-10-11b).
//
// Exports: TK_ClientStrip, TK_ClientDrawerHost, TK_ClientDrawerPanel,
//          TK_useFollowClient, TK_cdRequest, TK_useCdState, TK_cdSet,
//          TK_cdLoader, TK_cdUseClientList
//
// Staff only. app.jsx mounts the strip under the client header and the host
// once, and only for staff (never the client portal, never while viewing as
// someone or previewing the client view). The pure rules (page match, groups,
// summary, follow checks) live in TK_clientLogic.js.
//
// The strip and the panel share one list of their own, key "clientcd:<id>",
// separate from the full client list (#/tasks/c/<id>, key "client:<id>") so
// Show done here never changes what that page holds. TK_stMatches treats both
// keys alike, so Realtime, BroadcastChannel and our own ticks reach them with
// no extra work. Every write goes through
// the shared helpers (TK_vComplete, TK_vSetStatus, TK_vAddRow, TK_openTask),
// so the review gate and its toasts stay in one place.
//
// The only new window globals are TK_clientDrawerReady and TK_clientDrawerOpen,
// and the events tk:client-drawer (a request: open, close or toggle) and
// tk:client-drawer-state (the answer: { open, ready }). Only a client's record
// id ever goes through BroadcastChannel. Never a name or an email.
// ----------------------------------------------------------------------------

// ---- Shared view state ---------------------------------------------------------------

var TK_cdState = { open: false, ready: false, clientId: null };
var TK_cdShowDone = false; // module level; the panel resets it when its client changes or it closes

function TK_cdSet(patch) {
  var changed = false;
  for (var k in patch) {
    if (Object.prototype.hasOwnProperty.call(patch, k) && TK_cdState[k] !== patch[k]) {
      TK_cdState[k] = patch[k];
      changed = true;
    }
  }
  if (!changed) return;
  try {
    window.TK_clientDrawerReady = TK_cdState.ready;
    window.TK_clientDrawerOpen = TK_cdState.open;
    window.dispatchEvent(new CustomEvent("tk:client-drawer-state", { detail: { open: TK_cdState.open, ready: TK_cdState.ready } }));
  } catch (e) {}
}

// { open, ready }, live.
function TK_useCdState() {
  var pair = React.useState(function () {
    return { open: TK_cdState.open, ready: TK_cdState.ready };
  });
  var setS = pair[1];
  React.useEffect(function () {
    var on = function () {
      setS(function (cur) {
        return cur.open === TK_cdState.open && cur.ready === TK_cdState.ready ? cur : { open: TK_cdState.open, ready: TK_cdState.ready };
      });
    };
    window.addEventListener("tk:client-drawer-state", on);
    on();
    return function () {
      window.removeEventListener("tk:client-drawer-state", on);
    };
  }, []);
  return pair[0];
}

// action: "open" | "close" | "toggle". from: "pill" | "strip" | "key" | "chat".
function TK_cdRequest(action, from) {
  try {
    window.dispatchEvent(new CustomEvent("tk:client-drawer", { detail: { action: action, from: from || null } }));
  } catch (e) {}
}

function TK_cdHostUp() {
  try {
    return window.TK_drawerHostReady === true;
  } catch (e) {
    return false;
  }
}

// One loader for the strip and the panel (they share the "clientcd:<id>" list).
function TK_cdLoader(clientId) {
  return function () {
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.listScope !== "function") return Promise.resolve([]);
    return TK_api.listScope({ clientId: clientId }, { showDone: TK_cdShowDone, showOlder: false });
  };
}

// { tasks, loading, error, reload, loaded } for one client's list. loaded turns
// true after the first answer, so a view never flashes "no tasks" before it
// has asked.
function TK_cdUseClientList(clientId) {
  var key = clientId ? "clientcd:" + clientId : null;
  var list = TK_vUseList(key, TK_cdLoader(clientId));
  var at = TK_vUseStore(function (s) {
    var L = key && s && s.lists ? s.lists[key] : null;
    return L && L.at != null ? L.at : null;
  });
  return { tasks: list.tasks || [], loading: !!list.loading, error: list.error || null, reload: list.reload, loaded: at != null };
}

// ---- Strip ---------------------------------------------------------------------------------

function TK_ClientStrip(props) {
  var client = props.client || null;
  var isAdmin = !!props.isAdmin;
  var page = props.page || null;
  var clientId = client && client.id != null ? String(client.id) : null;
  var name = client && client.name ? client.name : "this client";
  var schema = TK_vUseSchema();
  var hPair = React.useState(TK_cdHostUp);
  var hostUp = hPair[0];
  var setHostUp = hPair[1];
  React.useEffect(
    function () {
      setHostUp(TK_cdHostUp());
      var t = setTimeout(function () {
        setHostUp(TK_cdHostUp());
      }, 0);
      return function () {
        clearTimeout(t);
      };
    },
    [schema],
  );
  var active = schema === "ok" && hostUp && typeof TK_openTask === "function" && !!clientId;
  var list = TK_cdUseClientList(active ? clientId : null);
  var cd = TK_useCdState();
  var online = TK_vUseOnline();
  var touch = TK_vUseTouch();
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  if (!active) return null;

  var today = TK_vToday();
  var summary = TK_cdSummary(list.tasks, today, page);
  var next = summary.next;
  var title = next ? next.text || "Untitled task" : "";
  var nextInReview = !!(next && typeof TK_effectiveStatus === "function" && TK_effectiveStatus(next) === "ready_for_review");
  var canApprove = !!(nextInReview && typeof TK_reviewRole === "function" && TK_reviewRole(next, { me: TK_vMe(), isAdmin: isAdmin }).canApprove);
  // Tasks p2 s3: a gated task goes to review for admins too.
  var gated = !!(next && next.review_required && !nextInReview);
  var tickLabel = (canApprove ? "Approve: " : gated ? "Send for review: " : "Mark done: ") + title;
  // Already waiting on review: nothing to tick unless this admin can approve it.
  var inReview = nextInReview && !canApprove;

  var tick = function () {
    if (!next || busy || !online) return;
    setBusy(true);
    TK_vComplete(next, isAdmin).then(
      function () {
        setBusy(false);
      },
      function () {
        setBusy(false);
      },
    );
  };

  var body;
  if (!list.loaded && list.error) {
    body = (
      <React.Fragment>
        <span className="tk-cd-strip-msg">Couldn't load tasks.</span>
        <button type="button" className="tk-cd-strip-retry" onClick={list.reload}>
          Try again
        </button>
      </React.Fragment>
    );
  } else if (!list.loaded) {
    body = (
      <span className="tk-cd-strip-msg" role="status">
        Loading tasks…
      </span>
    );
  } else if (summary.open === 0) {
    body = (
      <React.Fragment>
        <span className="tk-cd-strip-msg">{"No open tasks for " + name + "."}</span>
        <button
          type="button"
          className="tk-cd-strip-add"
          onClick={function () {
            try {
              window.dispatchEvent(new CustomEvent("tk:quick-add", { detail: { client_id: clientId } }));
            } catch (e) {}
          }}
        >
          Add task
        </button>
      </React.Fragment>
    );
  } else {
    body = (
      <React.Fragment>
        <span className="tk-cd-strip-count">
          {summary.open + " open"}
          {summary.overdue > 0 ? (
            <React.Fragment>
              {" · "}
              <span className="tk-cd-strip-over">{summary.overdue + " overdue"}</span>
            </React.Fragment>
          ) : null}
        </span>
        {next ? (
          <span className="tk-cd-strip-next">
            <span className="tk-cd-strip-nlabel">Next</span>
            {inReview ? null : (
              <button
                type="button"
                className="tk-check tk-cd-strip-tick"
                aria-label={tickLabel}
                title={online ? tickLabel : TK_vCopy("offline")}
                disabled={busy || !online}
                onClick={tick}
              />
            )}
            <button
              type="button"
              className="tk-cd-strip-title"
              title={title}
              onClick={function () {
                TK_openTask(next.id, { from: "strip" });
              }}
            >
              {title}
            </button>
            <span className="tk-cd-strip-due">
              <TK_DuePill task={next} today={today} />
            </span>
          </span>
        ) : null}
      </React.Fragment>
    );
  }

  return (
    <div className="tk-cd-strip" data-tour="tk-strip" role="region" aria-label={"Tasks for " + name}>
      <span className="tk-cd-strip-label">
        <TK_vIcon name="check" size={15} />
        Tasks
      </span>
      {body}
      <span className="tk-cd-strip-gap" />
      <button
        type="button"
        className="tk-cd-strip-open"
        aria-haspopup="dialog"
        aria-expanded={cd.open ? "true" : "false"}
        aria-controls="tk-cd-panel"
        onClick={function () {
          TK_cdRequest("toggle", "strip");
        }}
      >
        All tasks
        {touch ? null : (
          <kbd className="tk-kbd" aria-hidden="true">
            t
          </kbd>
        )}
      </button>
    </div>
  );
}

// ---- Panel ---------------------------------------------------------------------------------

function TK_cdFocusables(root) {
  var out = [];
  if (!root) return out;
  var list = root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  for (var i = 0; i < list.length; i++) {
    var el = list[i];
    if (el.disabled) continue;
    if (el.getAttribute("tabindex") === "-1") continue;
    if (el.offsetParent === null && !(el.getClientRects && el.getClientRects().length)) continue;
    out.push(el);
  }
  return out;
}

function TK_ClientDrawerPanel(props) {
  var clientId = props.clientId || null;
  var name = props.clientName || "";
  var staffUser = props.staffUser || {};
  var isAdmin = !!props.isAdmin;
  var page = props.page || null;
  var onClose = props.onClose;
  var online = TK_vUseOnline();
  var touch = TK_vUseTouch();
  var staff = TK_vUseStaff(true) || [];
  var list = TK_cdUseClientList(clientId);
  var asideRef = React.useRef(null);
  var sPair = React.useState(function () {
    return TK_cdShowDone;
  });
  var showDone = sPair[0];
  var setShowDone = sPair[1];
  var lPair = React.useState("");
  var liveText = lPair[0];
  var setLiveText = lPair[1];
  var drawerId = TK_vUseStore(function (s) {
    return s ? s.drawerId : null;
  });
  var lastIdRef = React.useRef(null);
  if (drawerId) lastIdRef.current = drawerId;

  // A different client starts with Show done off. This runs while rendering so
  // the reload that follows reads the new value.
  var seenClientRef = React.useRef(clientId);
  var clientChanged = seenClientRef.current !== clientId;
  if (clientChanged) {
    seenClientRef.current = clientId;
    TK_cdShowDone = false;
  }
  React.useEffect(
    function () {
      if (!clientChanged) return;
      setShowDone(false);
      if (name) {
        setLiveText("Showing " + name + "'s tasks.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientId],
  );
  React.useEffect(
    function () {
      if (!liveText) return undefined;
      var t = setTimeout(function () {
        setLiveText("");
      }, 4000);
      return function () {
        clearTimeout(t);
      };
    },
    [liveText],
  );
  // Closing the panel leaves Show done off for the strip and the next opening.
  React.useEffect(function () {
    return function () {
      TK_cdShowDone = false;
    };
  }, []);

  // Focus the panel when it opens.
  React.useLayoutEffect(function () {
    var el = asideRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch (e) {}
  }, []);

  // Stacked under the details drawer: inert while a task is open on top.
  React.useLayoutEffect(
    function () {
      var el = asideRef.current;
      if (!el) return undefined;
      if (drawerId) {
        el.inert = true;
        el.setAttribute("aria-hidden", "true");
        return undefined;
      }
      var wasInert = el.inert === true || el.getAttribute("aria-hidden") === "true";
      el.inert = false;
      el.removeAttribute("aria-hidden");
      if (!wasInert) return undefined;
      var t = setTimeout(function () {
        var a = asideRef.current;
        if (!a) return;
        if (document.activeElement && a.contains(document.activeElement)) return;
        var target = null;
        try {
          if (lastIdRef.current) target = a.querySelector('[data-tk-id="' + CSS.escape(String(lastIdRef.current)) + '"] .tk-row-title');
        } catch (e) {
          target = null;
        }
        try {
          (target || a).focus({ preventScroll: true });
        } catch (e) {}
      }, 30);
      return function () {
        clearTimeout(t);
      };
    },
    [drawerId],
  );

  // Escape and Tab, in the capture phase so the page behind never sees them.
  React.useEffect(function () {
    var onKey = function (e) {
      if (e.key !== "Escape" && e.key !== "Tab") return;
      var aside = asideRef.current;
      if (!aside) return;
      if (document.querySelector(".tk-dw-layer, .modal-overlay, .tour-root")) return;
      var menus = aside.querySelectorAll('[role="menu"]');
      for (var i = 0; i < menus.length; i++) {
        if (menus[i].offsetParent !== null || menus[i].getClientRects().length) return;
      }
      if (e.key === "Escape") {
        var t = e.target;
        var tag = t && t.tagName ? t.tagName.toLowerCase() : "";
        if ((tag === "input" || tag === "textarea") && t.value) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      var items = TK_cdFocusables(aside);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      var first = items[0];
      var last = items[items.length - 1];
      var active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === aside || !aside.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !aside.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return function () {
      document.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  var today = TK_vToday();
  var groups = TK_cdGroups(list.tasks, { today: today, page: page, showDone: showDone });
  // Subtasks open inline under their parent (same group only).
  var subs = TK_vUseSubtasks(list.tasks);
  groups = TK_subNestGroups(groups, subs.kidsOf);
  var summary = TK_cdSummary(list.tasks, today);
  var ids = [];
  groups.forEach(function (g) {
    g.tasks.forEach(function (t) {
      ids.push(t.id);
    });
  });
  var counts = TK_vUseChecklist(ids);
  var nameOf = function (email) {
    return typeof TK_vStaffName === "function" ? TK_vStaffName(staff, email) : email || "";
  };

  var go = function (route) {
    return function (e) {
      if (!TK_vPlainClick(e)) return;
      e.preventDefault();
      onClose();
      TK_navigate(route);
    };
  };
  var fullRoute = clientId ? { view: "client", clientId: clientId } : null;
  var fullHref = fullRoute ? TK_formatRoute(fullRoute) : "";

  var failed = !!list.error && !list.tasks.length;
  var showLoading = !list.loaded && !failed;
  var empty = !!clientId && list.loaded && !failed && summary.open === 0;

  var panel = (
    <div className="tk-cd-layer">
      <div className="tk-cd-scrim" aria-hidden="true" onClick={onClose} />
      <aside className="tk-cd" id="tk-cd-panel" role="dialog" aria-modal="true" aria-labelledby="tk-cd-title" tabIndex={-1} ref={asideRef}>
        <span className="tk-cd-grab" aria-hidden="true" />
        <header className="tk-cd-head">
          {clientId ? <p className="tk-cd-eyebrow">Client tasks</p> : null}
          <h2 className="tk-cd-title" id="tk-cd-title">
            {clientId ? name : "Client tasks"}
          </h2>
          {clientId && props.isLast ? <p className="tk-cd-note">Last client you opened</p> : null}
          <button type="button" className="tk-cd-close" aria-label="Close client tasks" onClick={onClose}>
            ×
          </button>
          {clientId && list.loaded ? (
            <p className="tk-cd-sum">
              {summary.open + " open"}
              {summary.overdue > 0 ? (
                <React.Fragment>
                  {" · "}
                  <span className="tk-cd-over">{summary.overdue + " overdue"}</span>
                </React.Fragment>
              ) : null}
            </p>
          ) : null}
        </header>
        <div className="tk-cd-body">
          {clientId ? (
            <React.Fragment>
              <ul className="tk-rows tk-cd-add" role="grid" aria-label="Add a task">
                <TK_vAddRow
                  ctx={{ clientId: clientId, email: staffUser.email, staff: staff, clients: props.clients || [] }}
                  sectionName={name}
                  disabled={!online}
                />
              </ul>
              {online ? null : <TK_vOfflineBanner />}
              {showLoading ? <TK_vSkeletonRows count={5} /> : null}
              {failed ? <TK_vErrorState text="Couldn't load tasks." onRetry={list.reload} /> : null}
              {empty ? (
                <div className="tk-cd-empty">
                  <p>{"No open tasks for " + name + "."}</p>
                  <p className="tk-cd-empty-sub">{touch ? "Add one above." : "Add one above, or press q."}</p>
                </div>
              ) : null}
              {groups.map(function (g) {
                return (
                  <section className="tk-cd-group" data-group={g.id} key={g.id}>
                    <h3 className="tk-cd-group-head">
                      <span>{g.label}</span> <span className="tk-cd-group-n">{g.tasks.length}</span>
                    </h3>
                    <ul className="tk-rows" role="grid" aria-label={g.label}>
                      {g.tasks.map(function (t) {
                        return (
                          <TK_TaskRow
                            key={t.id}
                            task={t}
                            today={today}
                            subs={subs}
                            showClient={false}
                            showAssignee={true}
                            assigneeName={t.assignee_email ? nameOf(t.assignee_email) : ""}
                            onClaim={online ? TK_vClaim : undefined}
                            isAdmin={isAdmin}
                            canEdit={online}
                            columns={false}
                            checklist={counts[t.id] || null}
                            onOpen={function (id) {
                              TK_openTask(id, { from: "client-drawer" });
                            }}
                            onToggleDone={function (task) {
                              TK_vComplete(task, isAdmin);
                            }}
                            onStatus={function (task, s, note) {
                              TK_vSetStatus(task, s, note, isAdmin);
                            }}
                          />
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              {typeof TK_ClientContacts === "function" ? <TK_ClientContacts clientId={clientId} online={online} /> : null}
            </React.Fragment>
          ) : (
            <div className="tk-cd-empty">
              <p>Open a client to see its tasks.</p>
              <p className="tk-cd-empty-sub">
                <a href="#/tasks/my" onClick={go({ view: "my" })}>
                  Go to My Tasks
                </a>
              </p>
            </div>
          )}
        </div>
        <footer className="tk-cd-foot">
          {clientId ? (
            <TK_vSwitch
              className="tk-cd-done"
              label="Show done"
              checked={showDone}
              onChange={function (v) {
                TK_cdShowDone = !!v;
                setShowDone(!!v);
                if (list.reload) list.reload();
              }}
            />
          ) : null}
          <nav className="tk-cd-links" aria-label="More tasks">
            {clientId ? (
              <a href={fullHref} onClick={go(fullRoute)}>
                Full list
              </a>
            ) : null}
            <a href="#/tasks/my" onClick={go({ view: "my" })}>
              My Tasks
            </a>
          </nav>
          {touch ? null : (
            <p className="tk-cd-hint">
              <kbd className="tk-kbd">t</kbd> opens and closes this
            </p>
          )}
        </footer>
        <p className="tk-cd-live tk-sr" aria-live="polite">
          {liveText}
        </p>
      </aside>
    </div>
  );
  return TK_dwPortal(panel);
}

// ---- Host ----------------------------------------------------------------------------------

function TK_ClientDrawerHost(props) {
  var p = props || {};
  var clients = Array.isArray(p.clients) ? p.clients : [];
  var available = !!p.available;
  var schema = TK_vUseSchema();
  var hPair = React.useState(TK_cdHostUp);
  var hostUp = hPair[0];
  var setHostUp = hPair[1];
  React.useEffect(
    function () {
      setHostUp(TK_cdHostUp());
      var t = setTimeout(function () {
        setHostUp(TK_cdHostUp());
      }, 0);
      return function () {
        clearTimeout(t);
      };
    },
    [schema],
  );

  var wanted = p.openClientId || p.lastClientId || null;
  var found = null;
  if (wanted != null) {
    for (var i = 0; i < clients.length; i++) {
      if (String(clients[i].id) === String(wanted)) {
        found = clients[i];
        break;
      }
    }
  }
  var clientId = found ? String(found.id) : null;
  var clientName = found && found.name ? found.name : "";
  var isLast = !p.openClientId && !!clientId;
  var ready = available && schema === "ok" && hostUp && typeof TK_openTask === "function";

  var oPair = React.useState(false);
  var open = oPair[0];
  var setOpen = oPair[1];
  var openRef = React.useRef(false);
  var readyRef = React.useRef(ready);
  readyRef.current = ready;
  var clientIdRef = React.useRef(clientId);
  clientIdRef.current = clientId;
  var openerRef = React.useRef(null);

  // Tell the top bar when the panel can open.
  React.useEffect(
    function () {
      TK_cdSet({ ready: ready });
    },
    [ready],
  );
  React.useEffect(function () {
    return function () {
      TK_cdSet({ ready: false, open: false });
    };
  }, []);
  React.useEffect(
    function () {
      TK_cdSet({ open: open, clientId: clientId });
    },
    [open, clientId],
  );

  var close = React.useCallback(function () {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    var el = openerRef.current;
    openerRef.current = null;
    setTimeout(function () {
      try {
        if (el && document.contains(el) && !document.querySelector(".tk-dw-layer")) el.focus({ preventScroll: true });
      } catch (e) {}
    }, 0);
  }, []);

  var openIt = React.useCallback(function () {
    if (!readyRef.current || openRef.current) return;
    try {
      openerRef.current = document.activeElement;
    } catch (e) {
      openerRef.current = null;
    }
    openRef.current = true;
    setOpen(true);
    // Closes the chat and widget drawers; the details host ignores it.
    try {
      window.dispatchEvent(new CustomEvent("tk:drawer-open", { detail: { id: null, from: "client" } }));
    } catch (e) {}
    TK_vTrack("tasks-client-drawer");
  }, []);

  var toggle = React.useCallback(
    function () {
      if (openRef.current) close();
      else openIt();
    },
    [close, openIt],
  );

  React.useEffect(
    function () {
      var on = function (e) {
        var d = (e && e.detail) || {};
        if (d.action === "open") openIt();
        else if (d.action === "close") close();
        else if (d.action === "toggle") toggle();
      };
      window.addEventListener("tk:client-drawer", on);
      return function () {
        window.removeEventListener("tk:client-drawer", on);
      };
    },
    [openIt, close, toggle],
  );

  // Close when it can no longer be shown, or when the client goes away.
  var hadClientRef = React.useRef(!!clientId);
  React.useEffect(
    function () {
      var lost = hadClientRef.current && !clientId;
      hadClientRef.current = !!clientId;
      if (open && (!ready || lost)) close();
    },
    [open, ready, clientId, close],
  );

  // body.tk-cd-open while the panel is up.
  React.useEffect(
    function () {
      if (!open) return undefined;
      try {
        document.body.classList.add("tk-cd-open");
      } catch (e) {}
      return function () {
        try {
          document.body.classList.remove("tk-cd-open");
        } catch (e) {}
      };
    },
    [open],
  );

  // The t and q keys.
  React.useEffect(
    function () {
      if (!ready) return undefined;
      var onKey = function (e) {
        if (e.key !== "t" && e.key !== "q") return;
        if (document.querySelector(".tk-dw-layer")) return;
        if (typeof TK_shouldHandleKey !== "function" || typeof TK_vKeyCtx !== "function") return;
        var kc = TK_vKeyCtx();
        var ctx = { modalOpen: !!document.querySelector(".modal-overlay"), menuOpen: kc.menuOpen, tourOpen: kc.tourOpen, scope: "global" };
        if (!TK_shouldHandleKey(e, ctx)) return;
        if (e.key === "q") {
          if (!openRef.current || !clientIdRef.current) return; // closed: TK_QuickAddHost owns q
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent("tk:quick-add", { detail: { client_id: String(clientIdRef.current) } }));
          } catch (err) {}
          if (typeof TK_vTrackKey === "function") TK_vTrackKey("q");
          return;
        }
        e.preventDefault();
        toggle();
        if (typeof TK_vTrackKey === "function") TK_vTrackKey("t");
      };
      window.addEventListener("keydown", onKey);
      return function () {
        window.removeEventListener("keydown", onKey);
      };
    },
    [ready, toggle],
  );

  // Follow (portal side): tell the Tasks pop-out which client is open. Only the
  // record id goes out.
  var openClientId = p.openClientId != null ? String(p.openClientId) : null;
  var lastFocusAtRef = React.useRef(0);
  var openClientRef = React.useRef(openClientId);
  openClientRef.current = openClientId;
  var announce = React.useCallback(function (at) {
    if (typeof TK_sync === "undefined" || !TK_sync || typeof TK_sync.post !== "function") return;
    if (!openClientRef.current) return;
    TK_sync.post({ type: "client-focus", clientId: openClientRef.current, at: at });
  }, []);
  React.useEffect(
    function () {
      if (!available || !openClientId) return;
      var visible = true;
      try {
        visible = document.visibilityState === "visible";
      } catch (e) {}
      if (!visible) return;
      lastFocusAtRef.current = Date.now();
      announce(lastFocusAtRef.current);
    },
    [available, openClientId, announce],
  );
  React.useEffect(
    function () {
      if (!available) return undefined;
      var onFocus = function () {
        if (!openClientRef.current) return;
        lastFocusAtRef.current = Date.now();
        announce(lastFocusAtRef.current);
      };
      window.addEventListener("focus", onFocus);
      var off = null;
      if (typeof TK_sync !== "undefined" && TK_sync && typeof TK_sync.on === "function") {
        off = TK_sync.on("client-ask", function () {
          if (openClientRef.current && lastFocusAtRef.current) announce(lastFocusAtRef.current);
        });
      }
      return function () {
        window.removeEventListener("focus", onFocus);
        if (off) off();
      };
    },
    [available, announce],
  );

  if (!open || !ready) return null;
  return (
    <TK_ClientDrawerPanel
      clientId={clientId}
      clientName={clientName}
      isLast={isLast}
      staffUser={p.staffUser}
      clients={clients}
      isAdmin={!!p.isAdmin}
      page={p.page}
      onClose={close}
    />
  );
}

// ---- Follow my client (the pop-out) ------------------------------------------------------------

// Returns { liveText }. While enabled, a client-focus message from the portal
// window moves this window's list to that client.
function TK_useFollowClient(opts) {
  var o = opts || {};
  var enabled = !!o.enabled;
  var clientsRef = React.useRef(o.clients || []);
  clientsRef.current = o.clients || [];
  var lastAtRef = React.useRef(0);
  var askedWithClientsRef = React.useRef(false);
  var lPair = React.useState("");
  var liveText = lPair[0];
  var setLiveText = lPair[1];

  React.useEffect(
    function () {
      if (!enabled) return undefined;
      if (typeof TK_sync === "undefined" || !TK_sync || typeof TK_sync.on !== "function") return undefined;
      lastAtRef.current = 0;
      var off = TK_sync.on("client-focus", function (msg) {
        var list = clientsRef.current || [];
        var ids = list.map(function (c) {
          return String(c.id);
        });
        if (!TK_cdAcceptFollow(lastAtRef.current, msg, ids)) return;
        lastAtRef.current = msg.at;
        var here = null;
        try {
          here = TK_parseRoute(window.location.hash || "");
        } catch (e) {
          here = null;
        }
        if (here && here.view === "client" && String(here.clientId) === msg.clientId) return;
        TK_navigate({ view: "client", clientId: msg.clientId }, { replace: true });
        var nm = "";
        for (var i = 0; i < list.length; i++) {
          if (String(list[i].id) === msg.clientId) nm = list[i].name || "";
        }
        if (nm) setLiveText("Now showing " + nm + "'s tasks.");
      });
      askedWithClientsRef.current = (clientsRef.current || []).length > 0;
      if (typeof TK_sync.post === "function") TK_sync.post({ type: "client-ask" });
      return function () {
        if (off) off();
      };
    },
    [enabled],
  );
  // On a cold start the client list can arrive after the portal's first reply,
  // which is then rejected (it names a client this window doesn't know yet).
  // Ask again once the list is loaded, if nothing has been followed yet.
  var hasClients = (o.clients || []).length > 0;
  React.useEffect(
    function () {
      if (!enabled || !hasClients || lastAtRef.current || askedWithClientsRef.current) return;
      askedWithClientsRef.current = true;
      if (typeof TK_sync === "undefined" || !TK_sync || typeof TK_sync.post !== "function") return;
      TK_sync.post({ type: "client-ask" });
    },
    [enabled, hasClients],
  );
  React.useEffect(
    function () {
      if (!liveText) return undefined;
      var t = setTimeout(function () {
        setLiveText("");
      }, 4000);
      return function () {
        clearTimeout(t);
      };
    },
    [liveText],
  );
  return { liveText: enabled ? liveText : "" };
}
