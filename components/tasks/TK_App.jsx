// ----------------------------------------------------------------------------
// TK_App.jsx — the Tasks page (#/tasks/...), in the portal and in the shell.
//
// TK_App({ staffUser, clients, isAdmin, shell=false })
//   Layout from TK_shellLayout: the sidebar is a rail at 900px and up and a
//   "Lists" sheet below that. Inside the shell only, on a touch-primary
//   device at 760px or less, a bottom bar (My Tasks, Lists, Search, Add)
//   replaces the sidebar button. The header has "Open in own window"
//   (data-tour tk-popout), hidden when compact, on touch-primary devices and
//   inside the shell.
//   Inside the Slate app (TK_SlateModes.jsx) the size mode replaces
//   TK_shellLayout: tk-m-<mode> on the root, a 220px rail in regular, the
//   detail pane (TK_SlatePane) in full, the sliver slot in a sliver, and
//   Templates and Manage read-only in compact.
//   Schema missing (Row 11.5): the setup card, and a tasks arrival
//   (#/tasks/...?item=task:<id>) forwards to Work › Tasks with LK_go so the
//   legacy page opens the item.
// ----------------------------------------------------------------------------

var TK_vARRIVAL_MATCH = { place: "tasks", kinds: ["task", "view"], staff: true };

function TK_vUseArrivalSafe(match, ready, onArrive) {
  // LK_useArrival is a hook; whether it exists never changes after load, so
  // the hook order stays stable.
  if (typeof LK_useArrival === "function") LK_useArrival(match, ready, onArrive);
}

function TK_vQuickAddFor(route) {
  var r = route || {};
  if (r.view === "client" && r.clientId) return { client_id: String(r.clientId) };
  if (r.view === "project" && r.projectId) return { project_id: r.projectId };
  return {};
}

function TK_App(props) {
  var staffUser = props.staffUser || {};
  var prefs = typeof TK_usePrefs === "function" ? TK_usePrefs(staffUser.email) : null;
  var isAdmin = !!props.isAdmin;
  var shell = props.shell === true;
  var clients = props.clients || [];
  var schema = TK_vUseSchema();
  var route = TK_useRoute();
  var width = TK_vUseWidth();
  var touch = TK_vUseTouch();
  var layout = TK_shellLayout(width, touch);
  // Inside the Slate app the size mode (TK_SlateModes.jsx) replaces
  // TK_shellLayout; slm stays null on the portal page and with the app off.
  var sm = typeof TK_useSlateMode === "function" ? TK_useSlateMode() : null;
  var slm = shell ? sm : null;
  var sl = slm && typeof TK_slateLayout === "function" ? TK_slateLayout(slm.mode, touch) : null;
  var obsRef = typeof TK_useSlateModeObserver === "function" ? TK_useSlateModeObserver(!!slm) : null;
  var bottomBar = sl ? sl.bottomBar : shell && layout.bottomBar;
  var rail = sl ? sl.rail : layout.sidebar === "rail" && !bottomBar;
  var compactNow = sl ? sl.compact : layout.compact;
  var showPopOut = !layout.compact && !touch && !shell;
  // The Slate app (TK_SlateBridge.jsx): "Open Slate app" replaces the pop-out.
  var slateOn = typeof TK_useSlateAppOn === "function" ? TK_useSlateAppOn() : false;
  var lPair = React.useState(false);
  var listsOpen = lPair[0];
  var setListsOpen = lPair[1];

  TK_vUseArrivalSafe(TK_vARRIVAL_MATCH, schema === "missing", function (a) {
    if (typeof LK_go !== "function") return;
    var t = { place: "work", tab: "tasks" };
    if (a && a.kind === "task" && a.id) t.item = "task:" + a.id;
    LK_go(t);
  });

  React.useEffect(
    function () {
      if (!shell && typeof TK_startDockReceiver === "function") TK_startDockReceiver();
    },
    [shell],
  );

  // The sheet closes on its own when the window grows into the rail.
  React.useEffect(
    function () {
      if (rail && listsOpen) setListsOpen(false);
    },
    [rail, listsOpen],
  );

  var navigate = function (r) {
    setListsOpen(false);
    TK_navigate(r);
  };

  // Slate plus (hidden): the icon rail replaces the text sidebar in the rail
  // layout only (TK_SlateRail.jsx). Off: railPlus false, markup unchanged.
  var plusOn = typeof TKP_useOn === "function" ? TKP_useOn() : false;
  var railPlus = !!(rail && plusOn && typeof TKR_Rail === "function");
  var rp = typeof TKR_usePrefs === "function" ? TKR_usePrefs(staffUser.email, railPlus) : null;

  if (schema === "missing") {
    return (
      <div className={"tk-app" + (shell ? " is-shell" : "") + (slm ? " " + TK_slateModeClasses(slm) : "") + (slm && prefs && TK_prefsDensityClass(prefs) ? " " + TK_prefsDensityClass(prefs) : "")} ref={obsRef || undefined}>
        <TK_SetupCard />
      </div>
    );
  }

  var sidebar = <TK_Sidebar route={route} clients={clients} isAdmin={isAdmin} staffUser={staffUser} onNavigate={navigate} />;

  var main;
  if (route.view === "my") main = <TK_MyTasks staffUser={staffUser} clients={clients} isAdmin={isAdmin} />;
  else if (route.view === "search") main = <TK_SearchView staffUser={staffUser} clients={clients} isAdmin={isAdmin} />;
  else if (route.view === "review") main = <TK_ReviewQueue staffUser={staffUser} clients={clients} isAdmin={isAdmin} />;
  else if (route.view === "waiting") main = <TK_WaitingList staffUser={staffUser} clients={clients} isAdmin={isAdmin} />;
  else if (route.view === "templates") main = <TK_Templates staffUser={staffUser} clients={clients} isAdmin={isAdmin} />;
  else if (route.view === "settings" && typeof TK_SlateSettings === "function" && TK_slateInApp()) main = <TK_SlateSettings staffUser={staffUser} />;
  else if (route.view === "settings") {
    main = (
      <div className="tk-state" role="status">
        <p>Settings live in the Slate app.</p>
        <button type="button" className="btn btn-primary" onClick={function () { if (typeof TK_openSlateApp === "function") TK_openSlateApp("#/tasks/settings"); }}>Open Slate app</button>
      </div>
    );
  }
  else if (route.view === "manage") main = <TK_ManageProjects staffUser={staffUser} clients={clients} isAdmin={isAdmin} />;
  else if (route.view === "client" || route.view === "project" || route.view === "person") {
    main = <TK_List route={route} staffUser={staffUser} clients={clients} isAdmin={isAdmin} />;
  } else if (route.view === "profile" && typeof TK_Profile === "function" && typeof TKP_on === "function" && TKP_on()) {
    // Slate plus person profile (hidden; TK_parseRoute only returns it while the gate is on).
    main = <TK_Profile route={route} staffUser={staffUser} clients={clients} isAdmin={isAdmin} />;
  } else {
    main = (
      <div className="tk-state" role="status">
        <p>{TK_vCopy("notFound", "We couldn't find that list.")}</p>
        <a
          className="btn-secondary"
          href="#/tasks/my"
          onClick={function (e) {
            if (!TK_vPlainClick(e)) return;
            e.preventDefault();
            navigate({ view: "my" });
          }}
        >
          Go to Slate
        </a>
      </div>
    );
  }
  // Compact in the app: Templates and Manage are read-only with a note.
  if (slm && (route.view === "templates" || route.view === "manage") && typeof TK_SlateReadOnly === "function") {
    main = <TK_SlateReadOnly>{main}</TK_SlateReadOnly>;
  }

  var needBar = !rail && !bottomBar;
  return (
    <div
      className={
        "tk-app" + (shell ? " is-shell" : "") + (rail ? " has-rail" : "") + (bottomBar ? " has-bottom-bar" : "") + (compactNow ? " is-compact" : "") + (slm ? " " + TK_slateModeClasses(slm) : "") + (slm && prefs && TK_prefsDensityClass(prefs) ? " " + TK_prefsDensityClass(prefs) : "") + (railPlus ? " has-tkr" + (rp && rp.pinned && rp.section ? " tkr-pinned" : "") : "")
      }
      ref={obsRef || undefined}
    >
      <h1 className="tk-sr">Slate</h1>
      {rail ? <aside className={"tk-app-rail" + (railPlus ? " tkr-host" : "")}>{railPlus ? <TK_Sidebar route={route} clients={clients} isAdmin={isAdmin} staffUser={staffUser} onNavigate={navigate} variant="icons" /> : sidebar}</aside> : null}
      <div className="tk-app-main" tabIndex={slm ? -1 : undefined}>
        {needBar || showPopOut ? (
          <div className="tk-app-bar">
            {needBar ? (
              <button
                type="button"
                className="tk-tool-btn tk-lists-btn"
                aria-haspopup="dialog"
                onClick={function () {
                  setListsOpen(true);
                }}
              >
                <TK_vIcon name="list" size={16} />
                <span>Lists</span>
              </button>
            ) : null}
            <span className="tk-app-bar-gap" />
            {showPopOut && slateOn && typeof TK_SlateLaunch === "function" ? (
              <TK_SlateLaunch
                tour="tk-popout"
                getHash={function () {
                  var h = "";
                  try {
                    h = window.location.hash || "";
                  } catch (e) {}
                  return /^#\/tasks(\/|\?|$)/.test(h) ? h : "#/tasks/my";
                }}
              />
            ) : showPopOut ? (
              <button
                type="button"
                className="tk-tool-btn tk-popout-btn"
                data-tour="tk-popout"
                title="Open Slate in its own window"
                onClick={function () {
                  var h = "";
                  try {
                    h = window.location.hash || "";
                  } catch (e) {}
                  TK_popOut(/^#\/tasks(\/|\?|$)/.test(h) ? h : "#/tasks/my");
                }}
              >
                <TK_vIcon name="window" size={16} />
                <span>Open in own window</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {main}
      </div>
      {slm && slm.mode === "full" && typeof TK_SlatePane === "function" ? <TK_SlatePane view={route.view} /> : null}
      {slm && slm.mode === "sliver" && typeof TK_SlateSliverSlot === "function" ? <TK_SlateSliverSlot shape={slm.shape} staffUser={staffUser} clients={clients} isAdmin={isAdmin} /> : null}

      {listsOpen && !rail ? (
        <TK_vModal
          onClose={function () {
            setListsOpen(false);
          }}
          labelledBy="tk-lists-title"
          className="tk-modal tk-sheet tk-lists-sheet"
        >
          <div className="modal-header">
            <h3 className="card-title" id="tk-lists-title" style={{ margin: 0 }}>
              Lists
            </h3>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={function () {
                setListsOpen(false);
              }}
            >
              ×
            </button>
          </div>
          <div className="modal-body">{sidebar}</div>
        </TK_vModal>
      ) : null}

      {bottomBar ? (
        <nav className="tk-bottom-bar" aria-label="Slate">
          <a
            className={"tk-bb-item" + (route.view === "my" ? " is-active" : "")}
            href="#/tasks/my"
            aria-current={route.view === "my" ? "page" : undefined}
            onClick={function (e) {
              if (!TK_vPlainClick(e)) return;
              e.preventDefault();
              navigate({ view: "my" });
            }}
          >
            <TK_vIcon name="home" size={20} />
            <span>Slate</span>
          </a>
          <button
            type="button"
            className={"tk-bb-item" + (route.view === "client" || route.view === "project" || route.view === "person" || route.view === "profile" ? " is-active" : "")}
            aria-haspopup="dialog"
            onClick={function () {
              setListsOpen(true);
            }}
          >
            <TK_vIcon name="list" size={20} />
            <span>Lists</span>
          </button>
          <a
            className={"tk-bb-item" + (route.view === "search" ? " is-active" : "")}
            href="#/tasks/search"
            aria-current={route.view === "search" ? "page" : undefined}
            onClick={function (e) {
              if (!TK_vPlainClick(e)) return;
              e.preventDefault();
              navigate({ view: "search" });
            }}
          >
            <TK_vIcon name="search" size={20} />
            <span>Search</span>
          </a>
          <button
            type="button"
            className="tk-bb-item tk-bb-add"
            onClick={function () {
              try {
                window.dispatchEvent(new CustomEvent("tk:quick-add", { detail: TK_vQuickAddFor(route) }));
              } catch (e) {}
            }}
          >
            <TK_vIcon name="plus" size={20} />
            <span>Add</span>
          </button>
        </nav>
      ) : null}
    </div>
  );
}
