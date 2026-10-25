// ----------------------------------------------------------------------------
// WB_HubClient: the Client tab of the Workbench hub (Workbench Hub spec H4).
//
// One client's tasks without leaving the page. A picker on top (pinned
// clients first, then recent ones, then every client I can see; typing
// filters the same list, no server query), then the client's tasks drawn by
// TK_ClientTasksBody, the same body the client panel (t) uses: the add row,
// the groups with subtasks inline, and the client's contacts.
//
//   The client         On a client page that client is picked when the tab
//                      mounts or the page changes; otherwise the one the tab
//                      showed last (hub.clientId, saved with the hub).
//   Pins               mgb_wb_pins:<email>, at most 8 (WB_pinToggle, from the
//                      pins on screen). A pin for a client I can't open is
//                      hidden, never deleted (the list may still be partial).
//   Picker list        WB_hubPickerPool: no MGB (internal); test clients only
//                      with "Show test clients" on. Access uses the full list.
//   Recents            the client switcher's own list (WB_recentsRead/Push).
//   The list           TK_vUseList("wb:client:<id>", ...): its OWN key, so the
//                      client panel's Show done never reloads this tab and
//                      back. TK_stMatches places new and moved tasks in it, so
//                      it never needs a reload loop.
//   Access             only clients in my list (the clients prop) ever show;
//                      tasks come from TK_api.listScope under my JWT (RLS and
//                      the existing RPCs decide what I see, private tasks
//                      included). An id I can't open says so and shows no name.
//
// Browser file; loads after WB_HubTasks.jsx. Uses TK_* globals at render time.
// ----------------------------------------------------------------------------

// "Show test clients" (CF_useShowTest in components/staff/ClientFlags.jsx),
// read the way CF_usePicked does; off when ClientFlags isn't loaded. The
// choice is made on the first render (every file is loaded by then) and then
// kept, so the hook order never changes.
function WB__noShowTest() {
  return [false];
}
var WB__showTestHook = null;
function WB__useShowTest(email) {
  if (!WB__showTestHook) WB__showTestHook = typeof CF_useShowTest === "function" ? CF_useShowTest : WB__noShowTest;
  return WB__showTestHook((typeof window !== "undefined" && window.mgbViewerEmail) || email);
}

function WB_HubClient(props) {
  var ok = typeof TK_vUseSchema === "function" && typeof TK_vUseList === "function" && typeof TK_ClientTasksBody === "function";
  if (!ok) {
    return (
      <p className="wb-filtered-empty" role="status">
        Client tasks aren't available here yet. <a href="#/tasks/my">Slate</a>
      </p>
    );
  }
  return <WB_HubClientGate {...props} />;
}

function WB_HubClientGate(props) {
  var schema = TK_vUseSchema();
  var onReady = props.onReady;
  var settled = schema === "missing";
  React.useEffect(
    function () {
      if (settled && onReady) onReady();
    },
    [settled],
  );
  if (schema === "missing") {
    return (
      <p className="wb-filtered-empty" role="status">
        Slate is being set up. Try again in a little while.
      </p>
    );
  }
  if (schema !== "ok") {
    return (
      <div className="tk-view">
        <TK_vSkeletonRows count={5} />
      </div>
    );
  }
  return <WB_HubClientBody {...props} />;
}

// props: me (lowercase email), isAdmin, clients, clientId (hub.clientId),
// currentClientId (the client page I am on, or null), page, onReady(),
// showing (false while another tab shows; Desk additions read only then).
function WB_HubClientBody(props) {
  // Desk additions (WB_plus.js): off = this tab renders exactly as before.
  var plusOn = typeof WB_useDeskPlus === "function" ? WB_useDeskPlus(true) : false;
  var email = String(props.me || "").toLowerCase();
  var clients = Array.isArray(props.clients) ? props.clients : [];
  var routeId = props.currentClientId == null || props.currentClientId === "" ? null : String(props.currentClientId);
  var paneRef = React.useRef(null);

  var pinsPair = React.useState(function () {
    return WB_pinsRead(email);
  });
  var pins = pinsPair[0];
  var setPins = pinsPair[1];
  // A pin made elsewhere (the staff sidebar) in this tab shows here at once.
  React.useEffect(
    function () {
      var onPins = function (e) {
        var who = e && e.detail && e.detail.email;
        if (!who || who === String(email || "").trim().toLowerCase()) setPins(WB_pinsRead(email));
      };
      // A pin made in another tab arrives through the storage event.
      var onStore = function (e) {
        if (e && e.key && e.key === WB_pinsKey(email)) setPins(WB_pinsRead(email));
      };
      window.addEventListener("mgb:wb-pins", onPins);
      window.addEventListener("storage", onStore);
      return function () {
        window.removeEventListener("mgb:wb-pins", onPins);
        window.removeEventListener("storage", onStore);
      };
    },
    [email],
  );
  var recentPair = React.useState(function () {
    return WB_recentsRead(email);
  });
  var recents = recentPair[0];
  var setRecents = recentPair[1];

  // The client page I am on wins when the tab mounts and whenever the page
  // changes; until the hub state catches up this render already uses it.
  var appliedRef = React.useRef(null);
  var routePending = routeId != null && appliedRef.current !== routeId;
  var pick = WB_hubPickClient(props.clientId, routePending ? routeId : null, clients);
  React.useEffect(
    function () {
      appliedRef.current = routeId;
      if (routeId != null && routeId !== props.clientId) WB_store.setHub({ clientId: routeId });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeId],
  );

  // A pin for a client I can't open (or that isn't in the list yet) is only
  // hidden: the picker lists pins found in the client list, and saved pins
  // are never rewritten from a list that may still be partial.

  // The picker lists my clients without MGB (internal), and without test
  // clients while my "Show test clients" switch is off (ClientFlags.jsx);
  // the full list (clients) still decides access.
  var showTest = WB__useShowTest(email)[0];

  var id = pick.access === true ? pick.id : null;
  var pickerClients = React.useMemo(
    function () {
      return WB_hubPickerPool(clients, !!showTest, id);
    },
    [clients, showTest, id],
  );
  var name = pick.client ? String(pick.client.name || "") : "";
  var pinned = id != null && pins.indexOf(id) >= 0;

  // Picking another client starts the pane at the top.
  var seenRef = React.useRef(pick.id);
  React.useEffect(
    function () {
      if (seenRef.current === pick.id) return;
      seenRef.current = pick.id;
      var body = paneRef.current && paneRef.current.closest ? paneRef.current.closest(".wb-panel-body") : null;
      if (body) body.scrollTop = 0;
      WB_store.setHub({ scroll: { client: 0 } }, true);
    },
    [pick.id],
  );

  var choose = function (cid) {
    if (cid == null) return;
    var next = String(cid);
    setRecents(WB_recentsPush(email, next));
    WB_track("wb-hub", "client:pick");
    if (next !== props.clientId) WB_store.setHub({ clientId: next, lastFocus: null });
  };
  var togglePin = function () {
    if (id == null) return;
    var r = WB_pinToggle(email, id, pins);
    setPins(r.pins);
    if (r.on && r.dropped) {
      var gone = clients.find(function (c) {
        return c && String(c.id) === r.dropped;
      });
      WB_toast("Pinned. " + (gone && gone.name ? gone.name : "Your oldest pin") + " was unpinned (" + WB_PINS_CAP + " at most).");
    }
  };
  var addTask = function () {
    if (id == null) return;
    WB_track("wb-action", "task:add");
    try {
      window.dispatchEvent(new CustomEvent("tk:quick-add", { detail: { client_id: id } }));
    } catch (e) {}
  };
  var openClient = function (e) {
    if (id == null) return;
    if (e && (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
    if (e) e.preventDefault();
    WB_track("wb-action", "client:open");
    WB_store.setDrawerOpen(false);
    if (typeof LK_go === "function") LK_go({ clientId: id });
    else window.location.hash = "#/client/" + encodeURIComponent(id);
  };

  var settledNoList = pick.access !== true;
  var onReady = props.onReady;
  React.useEffect(
    function () {
      if (settledNoList && onReady) onReady();
    },
    [settledNoList],
  );

  var body;
  if (pick.id == null) {
    body = (
      <div className="tk-cd-empty wb-hub-client-empty">
        <p>Pick a client to see their tasks here.</p>
        <p className="tk-cd-empty-sub">Pin the ones you work on most with the star.</p>
      </div>
    );
  } else if (pick.access === false) {
    body = (
      <p className="wb-filtered-empty" role="status">
        You don't have access to this client.
      </p>
    );
  } else if (pick.access == null) {
    body = (
      <p className="wb-filtered-empty" role="status">
        No clients to show yet.
      </p>
    );
  } else {
    body = (
      <WB_HubClientTasks
        key={id}
        clientId={id}
        clientName={name}
        me={email}
        isAdmin={!!props.isAdmin}
        clients={clients}
        page={id === routeId ? props.page || null : null}
        onReady={onReady}
      />
    );
  }

  return (
    <div className="wb-hub-client" ref={paneRef} data-tour="wb-hub-client">
      <WB_HubClientPicker clients={pickerClients} pins={pins} recents={recents} currentId={id} onPick={choose} />
      {id != null ? (
        <div className="wb-hub-client-head">
          <h3 className="wb-hub-client-name">{name}</h3>
          <button
            type="button"
            className={"wb-pin" + (pinned ? " is-on" : "")}
            aria-pressed={pinned ? "true" : "false"}
            aria-label={pinned ? "Unpin " + name : "Pin " + name}
            title={pinned ? "Unpin" : "Pin to the top of the picker"}
            data-tour="wb-pin"
            onClick={togglePin}
          >
            <span aria-hidden="true">{pinned ? "★" : "☆"}</span>
          </button>
          <span className="wb-hub-client-gap" />
          <button type="button" className="btn-secondary wb-hub-add" onClick={addTask}>
            + Task
          </button>
          <a className="wb-hub-link" href={typeof LK_href === "function" ? LK_href({ clientId: id }) : "#/client/" + encodeURIComponent(id)} onClick={openClient}>
            Open client
          </a>
        </div>
      ) : null}
      {body}
      {plusOn && id != null && pick.access === true && typeof WB_cxFetch === "function" && typeof WB_cxStep === "function" ? (
        <WB_HubClientExtras clientId={id} showing={props.showing !== false} isAdmin={!!props.isAdmin} />
      ) : null}
    </div>
  );
}

// ---- Desk additions S2 (hidden; WB_plus.js gate) ----
// Below the client's tasks: Waiting on client, recent messages, recent files
// (WB_clientExtras.js). Mounted only while the gate is on and a client I can
// open is chosen. Three reads per client, only while the Client tab shows;
// the effect keys on the client alone (a repeat run for the same client,
// e.g. a double effect, reads nothing). Each section keeps its own loading
// state, error line and Retry; replies for another client are never drawn.
function WB_HubClientExtras(props) {
  var cid = String(props.clientId);
  var isAdmin = !!props.isAdmin;
  var showing = props.showing !== false;
  var stPair = React.useState({});
  var st = stPair[0];
  var setSt = stPair[1];
  var seqRef = React.useRef(null);
  if (!seqRef.current) seqRef.current = WB_cxSeq();
  // {cid, loaded, dirty}: the load rules live in WB_cxStep / WB_cxChanged.
  var memRef = React.useRef(null);
  if (!memRef.current) memRef.current = WB_cxMem(cid);
  var showRef = React.useRef(showing);
  showRef.current = showing;

  var apply = React.useCallback(function (sec, val) {
    setSt(function (prev) {
      var next = Object.assign({}, prev);
      next[sec] = val;
      return next;
    });
  }, []);
  var run = React.useCallback(
    function (sections) {
      var sb = typeof window !== "undefined" ? window.mgbSupabase : null;
      WB_cxFetch(sb, memRef.current.cid, seqRef.current, sections, apply);
    },
    [apply],
  );

  React.useEffect(
    function () {
      var step = WB_cxStep(memRef.current, cid, showing);
      // Another client: anything still in flight for the old one is stale.
      if (step.reset) seqRef.current.reset();
      if (step.run === "all") run(null);
      else if (step.run === "waiting") run(["waiting"]);
    },
    [cid, showing, run],
  );

  // Unmounted (client closed, gate off, Desk closed): drop any reply still in flight.
  React.useEffect(function () {
    return function () {
      if (seqRef.current) seqRef.current.reset();
    };
  }, []);

  // A request asked, answered, reminded or canceled anywhere in this tab:
  // reload Waiting on client now, or when the tab shows again.
  React.useEffect(
    function () {
      var on = function () {
        if (WB_cxChanged(memRef.current, showRef.current) === "waiting") run(["waiting"]);
      };
      window.addEventListener("mgb:tk-requests-changed", on);
      return function () {
        window.removeEventListener("mgb:tk-requests-changed", on);
      };
    },
    [run],
  );

  var now = new Date();
  var part = function (sec) {
    var s = st[sec];
    return s && s.clientId === cid ? s : { status: "loading", rows: null };
  };
  var remember = function (key) {
    WB_store.setHub({ lastFocus: key }, true);
  };
  var leave = function (target) {
    WB_store.setDrawerOpen(false);
    if (typeof LK_go === "function") LK_go(target);
    else if (typeof LK_href === "function") window.location.hash = LK_href(target);
  };
  // Tasks › Waiting on client starts on "Just my tasks" for everyone but
  // admins, which hides requests on other people's tasks: say how to see them.
  var leaveToWaiting = function () {
    leave({ place: "tasks", tab: "waiting" });
    if (!isAdmin && typeof WB_toast === "function") WB_toast("Opened Waiting on client. Untick Just my tasks to see requests on tasks that aren't yours.");
  };
  var openWaiting = function (r) {
    WB_track("wb-hub", "client-waiting");
    remember("cx:" + r.key);
    if (r.route === "task" && r.taskId && typeof TK_vOpenTask === "function") {
      TK_vOpenTask(r.taskId, { from: "wb-hub" });
      return;
    }
    leaveToWaiting();
  };
  var openMessage = function (m) {
    WB_track("wb-hub", "client-msg");
    remember("cx:" + m.key);
    if (typeof WB__openChat === "function" && WB__openChat(cid, m.email)) return;
    // The app declined (the Inbox page itself, or staff chat isn't here):
    // go to the client's messages on that person.
    WB_store.setDrawerOpen(false);
    if (typeof LK_go === "function") LK_go({ clientId: cid, tab: "messages", item: "msg:" + m.id }, m.email ? { email: m.email } : null);
  };
  var openFile = function (f) {
    WB_track("wb-hub", "client-file");
    remember("cx:" + f.key);
    if (f.inDrive && typeof WB__openDriveFile === "function" && typeof DRV_link === "function") {
      WB__openDriveFile(f.id, { failHint: "Try again, or open it from the client's Documents.", track: false });
      return;
    }
    leave({ clientId: cid, tab: "documents" });
  };

  var section = function (sec, title, opts) {
    var p = part(sec);
    var rows = Array.isArray(p.rows) ? p.rows : [];
    var hid = "wb-cx-h-" + sec;
    var content;
    if (p.status === "error") {
      content = (
        <div className="wb-error wb-cx-error" role="alert">
          <span>{opts.errorText}</span>
          <button type="button" className="btn-secondary" onClick={() => run([sec])}>
            Retry
          </button>
        </div>
      );
    } else if (p.status !== "ok") {
      content = (
        <p className="wb-cx-note">Loading…</p>
      );
    } else if (!rows.length) {
      content = <p className="wb-cx-note">{opts.empty}</p>;
    } else {
      content = opts.list(rows);
    }
    return (
      <section className="wb-cx-sec" aria-labelledby={hid} aria-busy={p.status === "loading" ? "true" : undefined}>
        <h4 className="wb-cx-head" id={hid} {...(opts.tour ? { "data-tour": opts.tour } : {})}>
          {title}
          {p.status === "ok" && rows.length ? <span className="wb-chip-n">{opts.count != null ? opts.count : rows.length}</span> : null}
        </h4>
        {content}
      </section>
    );
  };

  var waitingAll = part("waiting").status === "ok" && Array.isArray(part("waiting").rows) ? part("waiting").rows : [];
  return (
    <div className="wb-cx" data-tour="wb-client-extras">
      <p className="tk-sr" role="status" aria-live="polite">
        {["waiting", "messages", "files"].some(function (k) {
          return part(k).status === "loading";
        })
          ? "Loading waiting, messages and files…"
          : ""}
      </p>
      {section("waiting", "Waiting on client", {
        tour: "wb-client-waiting",
        errorText: "Couldn't load what's waiting on this client.",
        empty: "Nothing waiting on this client.",
        count: waitingAll.length,
        list: function (rows) {
          var shown = rows.slice(0, WB_CX_WAIT_CAP);
          var more = rows.length - shown.length;
          return (
            <>
              <ul className="wb-cx-rows">
                {shown.map(function (r) {
                  var meta = [];
                  if (r.askedAt) meta.push("Asked " + WB_cxShortDate(r.askedAt, now));
                  var d = WB_cxDaysLabel(r.days);
                  if (d) meta.push(d);
                  if (r.nudge) meta.push(r.nudge);
                  return (
                    <li key={r.key} className="wb-cx-item">
                      <button type="button" className="wb-cx-row" data-wb-key={"cx:" + r.key} onClick={() => openWaiting(r)}>
                        <span className="wb-row-main">
                          <span className="wb-row-title">{r.label}</span>
                          {r.taskTitle ? <span className="wb-row-detail wb-cx-line">{"on " + r.taskTitle}</span> : null}
                          {meta.length ? <span className="wb-row-meta">{meta.join(" · ")}</span> : null}
                        </span>
                        <span className="tk-sr">{r.route === "task" ? ", opens the task" : ", opens Waiting on client"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {more > 0 ? (
                <button type="button" className="link-btn wb-cx-more" onClick={leaveToWaiting}>
                  {"See all " + rows.length + " in Waiting on client"}
                </button>
              ) : null}
            </>
          );
        },
      })}
      {section("messages", "Recent messages", {
        errorText: "Couldn't load recent messages.",
        empty: "No messages yet.",
        list: function (rows) {
          return (
            <ul className="wb-cx-rows">
              {rows.map(function (m) {
                return (
                  <li key={m.key} className="wb-cx-item">
                    <button type="button" className="wb-cx-row" data-wb-key={"cx:" + m.key} onClick={() => openMessage(m)}>
                      <span className="wb-row-main">
                        <span className="wb-row-meta">
                          <b className="wb-cx-who">{m.who}</b>
                          <span>{m.kindLabel}</span>
                          <span>{WB_cxWhen(m.at, now)}</span>
                        </span>
                        <span className={"wb-row-detail wb-cx-line" + (m.attachmentOnly ? " is-muted" : "")}>{m.text}</span>
                      </span>
                      <span className="tk-sr">, opens the chat</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          );
        },
      })}
      {section("files", "Recent files", {
        errorText: "Couldn't load recent files.",
        empty: "No files yet.",
        list: function (rows) {
          return (
            <ul className="wb-cx-rows">
              {rows.map(function (f) {
                return (
                  <li key={f.key} className="wb-cx-item">
                    <button type="button" className="wb-cx-row" data-wb-key={"cx:" + f.key} onClick={() => openFile(f)}>
                      <span className="wb-row-main">
                        <span className="wb-row-title">{f.name}</span>
                        <span className="wb-row-meta">
                          <span>{f.kind}</span>
                          {f.at ? <span>{WB_cxShortDate(f.at, now)}</span> : null}
                        </span>
                      </span>
                      <span className="tk-sr">{f.inDrive ? ", opens in Google Drive in a new tab" : ", opens the client's Documents"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          );
        },
      })}
    </div>
  );
}

// The tasks for one client, under the tab's own list key.
function WB_HubClientTasks(props) {
  var clientId = props.clientId;
  var key = WB_hubClientListKey(clientId);
  var loader = function () {
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.listScope !== "function") return Promise.resolve([]);
    return TK_api.listScope({ clientId: clientId }, { showDone: false, showOlder: false });
  };
  var list = TK_vUseList(key, loader);
  var at = TK_vUseStore(function (s) {
    var L = key && s && s.lists ? s.lists[key] : null;
    return L && L.at != null ? L.at : null;
  });
  var tasks = Array.isArray(list.tasks) ? list.tasks : [];
  // A row whose task moved to another client leaves at once (the store also
  // moves it; this covers the render in between).
  var mine = tasks.filter(function (t) {
    return t && t.client_id != null && String(t.client_id) === String(clientId);
  });
  var view = { tasks: mine, loaded: at != null, error: list.error || null, reload: list.reload };
  var settled = view.loaded || !!view.error;
  var onReady = props.onReady;
  React.useEffect(
    function () {
      if (settled && onReady) onReady();
    },
    [settled],
  );

  var remember = function (id) {
    WB_store.setHub({ lastFocus: "tk:" + id }, true);
    WB_track("wb-action", WB__taskDrawerReady() ? "task:open-in-place" : "task:open");
  };
  var open = function (id) {
    remember(id);
    TK_vOpenTask(id, { from: "wb-hub" });
  };
  // A plain click on a row's title link (TK_TaskRow opens it itself): keep the
  // row for focus return and log it the same way.
  var onClickCapture = function (e) {
    var t = e.target;
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = t && t.closest ? t.closest("a.tk-row-title") : null;
    var row = a ? a.closest("[data-tk-id],[data-tk-sub]") : null;
    if (!row) return;
    var id = row.getAttribute("data-tk-id") || row.getAttribute("data-tk-sub");
    if (id) remember(id);
  };
  // Enter on a focused row opens it (focus lands back on the row after Back or
  // Esc), the same as the Slate tab.
  var onKeyDown = function (e) {
    if (e.key !== "Enter" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    var t = e.target;
    if (!t || !t.matches) return;
    var id = t.matches("li.tk-row[data-tk-id]") ? t.getAttribute("data-tk-id") : t.matches("li[data-tk-sub]") ? t.getAttribute("data-tk-sub") : null;
    if (!id) return;
    e.preventDefault();
    open(id);
  };

  return (
    <div className="tk-cd-body wb-hub-client-body" onClickCapture={onClickCapture} onKeyDown={onKeyDown}>
      <TK_ClientTasksBody
        clientId={clientId}
        clientName={props.clientName}
        staffUser={{ email: props.me }}
        isAdmin={props.isAdmin}
        clients={props.clients}
        list={view}
        showDone={false}
        page={props.page}
        from="wb-hub"
        hideQuickKey={true}
        onOpen={open}
      />
    </div>
  );
}

// The client picker: an ARIA combobox. Arrow keys move, Enter picks, Esc
// closes the list (the hub sees the list as a layer, so it stays open), a
// second Esc clears the text, and the next one closes the hub.
function WB_HubClientPicker(props) {
  var qPair = React.useState("");
  var query = qPair[0];
  var setQuery = qPair[1];
  var oPair = React.useState(false);
  var open = oPair[0];
  var setOpen = oPair[1];
  var aPair = React.useState(0);
  var active = aPair[0];
  var setActive = aPair[1];
  var inputRef = React.useRef(null);
  var listRef = React.useRef(null);

  var opts = WB_hubClientOptions(props.clients, props.pins, props.recents, query);
  var items = opts.items;
  var at = Math.min(active, Math.max(0, items.length - 1));
  var activeId = open && items.length ? "wb-pick-opt-" + at : undefined;

  React.useEffect(
    function () {
      if (!open || !listRef.current || !activeId) return;
      var el = document.getElementById(activeId);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    },
    [open, activeId],
  );

  var pickAt = function (i) {
    var it = items[i];
    if (!it) return;
    props.onPick(it.id);
    setQuery("");
    setOpen(false);
    setActive(0);
  };
  var onKeyDown = function (e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      if (!items.length) return;
      var d = e.key === "ArrowDown" ? 1 : -1;
      setActive((at + d + items.length) % items.length);
      return;
    }
    if (e.key === "Enter") {
      if (!open || !items.length) return;
      e.preventDefault();
      pickAt(at);
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (query) {
        e.preventDefault();
        e.stopPropagation();
        setQuery("");
      }
    }
  };

  var n = -1;
  return (
    <div className="wb-pick">
      <label className="tk-sr" htmlFor="wb-pick-input">
        Client
      </label>
      <input
        ref={inputRef}
        id="wb-pick-input"
        className="wb-pick-input"
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={open ? "true" : "false"}
        aria-controls="wb-pick-list"
        aria-activedescendant={activeId}
        placeholder={props.currentId ? "Switch client…" : "Find a client…"}
        value={query}
        onChange={function (e) {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onClick={function () {
          setOpen(true);
        }}
        onBlur={function () {
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <div className="wb-pick-list" id="wb-pick-list" role="listbox" aria-label="Clients" ref={listRef}>
          {items.length ? (
            opts.sections.map(function (sec) {
              return (
                <div key={sec.id} role="group" aria-labelledby={"wb-pick-sec-" + sec.id} className="wb-pick-sec">
                  <div className="wb-pick-sec-head" id={"wb-pick-sec-" + sec.id} role="presentation">
                    {sec.label}
                  </div>
                  {sec.items.map(function (it) {
                    n++;
                    var i = n;
                    return (
                      <div
                        key={it.id}
                        id={"wb-pick-opt-" + i}
                        role="option"
                        aria-selected={i === at ? "true" : "false"}
                        className={"wb-pick-opt" + (i === at ? " is-active" : "") + (it.id === props.currentId ? " is-current" : "")}
                        onMouseDown={function (e) {
                          e.preventDefault(); // keep focus in the input
                        }}
                        onMouseEnter={function () {
                          setActive(i);
                        }}
                        onClick={function () {
                          pickAt(i);
                        }}
                      >
                        <span className="wb-pick-name">{it.name}</span>
                        {it.pinned ? (
                          <span className="wb-pick-star" aria-label="Pinned">
                            ★
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })
          ) : (
            <div className="wb-pick-none" role="presentation">
              {query ? "No client matches “" + query.trim() + "”." : "No clients yet."}
            </div>
          )}
          {opts.capped ? (
            <div className="wb-pick-more" role="presentation">
              {"Showing " + items.length + " of " + opts.total + ", type to narrow"}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
