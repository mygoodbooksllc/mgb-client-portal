// ----------------------------------------------------------------------------
// WB_QuickActions: small pieces shared by the Desk additions (hidden preview,
// WB_plus.js gate; docs/workbench-hub-spec.md section 3, slices S3 and S4).
//
// WB_AskClientModal({ clientId, clientName, onClose })
//   TK_AskClientModal, unmodified, opened task-less (taskId: null). The server
//   decides everything about sending (test clients get only a [Test] copy to
//   the sender; clients whose emails are not switched on get a dry run), so
//   nothing is gated here. TK_api.askClient fires mgb:tk-requests-changed, which
//   the Client tab's Waiting section already listens to.
//   Drawn into <body> (a portal) so it never sits inside the rail or the Desk
//   column (their arrow-key and focus handlers would see its keystrokes); key
//   events are stopped at the wrapper for the same reason. The overlay is the
//   usual .modal-overlay, which the Desk's Esc ladder already treats as a layer
//   (WB_LAYERS "modal"), so Esc closes the modal before the Desk.
//
// S4 (the + menu; TB_QuickAdd in components/staff/TopBar.jsx shows these only
// while the gate is on):
//
// WB_QuickItems({ client, onRun })
//   The three menu items, drawn inside TB_QuickAdd's menu: Ask client...,
//   Message... and Time off (same element, classes and role as the other
//   items). onRun(kind) is called with "ask" | "message" | "timeoff"; the
//   caller closes the menu and then calls WB_quickStart.
// WB_quickStart(kind, client)
//   Tracks the click (wb-quick:ask|message|timeoff). Message asks the app for
//   the chat drawer right away (mgb:open-chat {clientId}, or no client = the
//   drawer's own list) and returns null; the other two return the kind for
//   WB_QuickHost to draw.
// WB_QuickHost({ kind, client, clients, onClose })
//   "ask": the client's own Ask client modal on a client page; off one a small
//   client picker first (WB_hubPickerPool: no MGB internal, test clients only
//   with "Show test clients"), then the same modal. "timeoff": a ModalShell
//   around CV_MyTimeOffBody({ staffUser }) as is, hand-off to backups included.
//   Both are portaled into <body> with key events stopped, like the Ask modal.
//
// Pure rules (WB_quickPickFilter, WB_quickMessageStep) are in
// WB_clientExtras.js with node tests.
//
// Browser file; loads after WB_HubClient.jsx. Uses TK_* and React globals at
// render time only.
// ----------------------------------------------------------------------------

function WB_AskClientModal(props) {
  if (typeof TK_AskClientModal !== "function" || typeof ReactDOM === "undefined" || typeof ReactDOM.createPortal !== "function") return null;
  var close = props.onClose;
  return ReactDOM.createPortal(
    <div
      className="wb-ask-host"
      onKeyDown={function (e) {
        e.stopPropagation();
      }}
    >
      <TK_AskClientModal
        clientId={props.clientId}
        clientName={props.clientName || ""}
        taskId={null}
        onClose={close}
        onAsked={close}
      />
    </div>,
    document.body,
  );
}

// ---- S4: the + menu ----

function WB_QuickItems(props) {
  var run = function (kind) {
    return function () {
      if (props.onRun) props.onRun(kind);
    };
  };
  return (
    <>
      {typeof TK_AskClientModal === "function" && typeof WB_AskClientModal === "function" ? (
        <button type="button" role="menuitem" className="tb-menu-item" data-tour="wb-quick-ask" onClick={run("ask")}>
          Ask client…
        </button>
      ) : null}
      <button type="button" role="menuitem" className="tb-menu-item" data-tour="wb-quick-message" onClick={run("message")}>
        Message…
      </button>
      {typeof CV_MyTimeOffBody === "function" ? (
        <button type="button" role="menuitem" className="tb-menu-item" data-tour="wb-quick-timeoff" onClick={run("timeoff")}>
          Time off
        </button>
      ) : null}
    </>
  );
}

function WB_quickStart(kind, client) {
  var hasClient = !!(client && client.id != null);
  if (kind === "ask" || kind === "timeoff") {
    WB_track("wb-quick", kind);
    return kind;
  }
  if (kind === "message") {
    WB_track("wb-quick", "message");
    var handled = typeof WB__openChat === "function" ? WB__openChat(hasClient ? String(client.id) : null, null) : false;
    var step = typeof WB_quickMessageStep === "function" ? WB_quickMessageStep(hasClient, handled) : "done";
    if (step === "page") {
      // The old Message item's own path (StaffQuickActions opens the client's Messages).
      try {
        window.dispatchEvent(new CustomEvent("tb:quick-add", { detail: { kind: "message" } }));
      } catch (e) {}
    } else if (step === "inbox") {
      WB_store.setHub({ tab: "inbox", chip: "message" });
      WB_store.setDrawerOpen(true, "quick");
    }
  }
  return null;
}

function WB_QuickShell(props) {
  if (typeof ReactDOM === "undefined" || typeof ReactDOM.createPortal !== "function" || typeof ModalShell !== "function") return null;
  return ReactDOM.createPortal(
    <div
      className="wb-ask-host"
      onKeyDown={function (e) {
        e.stopPropagation();
      }}
    >
      <ModalShell onClose={props.onClose} labelledBy={props.labelledBy} className={props.className || ""}>
        {props.children}
      </ModalShell>
    </div>,
    document.body,
  );
}

function WB_QuickClientPicker(props) {
  var qPair = React.useState("");
  var q = qPair[0];
  var pool = props.pool;
  var list = typeof WB_quickPickFilter === "function" ? WB_quickPickFilter(pool, q) : pool;
  var inputRef = React.useRef(null);
  // ModalShell focuses its first control (the close button) in an effect that
  // runs after this one, so move focus to the search box a frame later.
  React.useEffect(function () {
    var raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : function (f) { return setTimeout(f, 0); };
    var h = raf(function () {
      if (inputRef.current) inputRef.current.focus();
    });
    return function () {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(h);
      else clearTimeout(h);
    };
  }, []);
  var pick = function (c) {
    props.onPick(c);
  };
  return (
    <WB_QuickShell onClose={props.onClose} labelledBy="wb-qp-title" className="wb-qp-modal">
      <div className="modal-header">
        <h3 className="card-title" id="wb-qp-title" style={{ margin: 0 }}>
          Ask which client?
        </h3>
        <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <input
          ref={inputRef}
          className="wb-qp-input"
          type="search"
          autoComplete="off"
          aria-label="Find a client"
          placeholder="Find a client"
          value={q}
          onChange={function (e) {
            qPair[1](e.target.value);
          }}
          onKeyDown={function (e) {
            if (e.key === "Enter" && q.trim() && list.length) {
              e.preventDefault();
              pick(list[0]);
            }
          }}
        />
        {list.length ? (
          <ul className="wb-qp-list">
            {list.map(function (c) {
              return (
                <li key={String(c.id)}>
                  <button
                    type="button"
                    className="wb-qp-opt"
                    onClick={function () {
                      pick(c);
                    }}
                  >
                    {c.name}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="wb-qp-none" role="status">
            {q ? "No client matches that." : "No clients to show."}
          </p>
        )}
      </div>
    </WB_QuickShell>
  );
}

function WB_QuickHost(props) {
  var ctx = React.useContext(typeof StaffToolsContext !== "undefined" ? StaffToolsContext : WB__quickNoCtx());
  var staffUser = (ctx && ctx.staffUser) || null;
  var email = String((staffUser && staffUser.email) || "").toLowerCase();
  var showTest = typeof WB__useShowTest === "function" ? WB__useShowTest(email)[0] : false;
  var pickPair = React.useState(null);
  var client = props.client && props.client.id != null ? props.client : null;
  var pool = React.useMemo(
    function () {
      return typeof WB_hubPickerPool === "function" ? WB_hubPickerPool(props.clients, !!showTest, null) : [];
    },
    [props.clients, showTest],
  );
  if (props.kind === "ask") {
    var target = client || pickPair[0];
    if (!target) return <WB_QuickClientPicker pool={pool} onClose={props.onClose} onPick={pickPair[1]} />;
    return <WB_AskClientModal clientId={String(target.id)} clientName={String(target.name || "")} onClose={props.onClose} />;
  }
  if (props.kind === "timeoff" && typeof CV_MyTimeOffBody === "function") {
    return (
      <WB_QuickShell onClose={props.onClose} labelledBy="wb-qt-title" className="wb-qt-modal">
        <div className="modal-header">
          <h3 className="card-title" id="wb-qt-title" style={{ margin: 0 }}>
            My time off
          </h3>
          <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="card-subtitle">
            Add days you'll be away so the team can plan cover.
          </p>
          <CV_MyTimeOffBody staffUser={staffUser} />
        </div>
      </WB_QuickShell>
    );
  }
  return null;
}

// A context that never has a provider (StaffToolsContext is app.jsx's; this
// only runs if it is missing). Made once, on first use.
var WB__quickCtx = null;
function WB__quickNoCtx() {
  if (!WB__quickCtx) WB__quickCtx = React.createContext(null);
  return WB__quickCtx;
}
