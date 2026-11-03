// Desk client summary (hidden preview; gate and data layer in WB_peek.js,
// spec docs/desk-client-peek-spec.md). Sits under the Client tab's header row:
// bookkeeper / AM, one contact (+N more), the Drive folder, a pinned
// Status/Handoff note, the last client-visible message, a task count that
// jumps to the list, and Message. Collapsible; the fold is saved per person.
//
// Mounted by WB_HubClientBody only while the gate is on and the chosen client
// is one I can open. It checks access again itself and reads nothing
// otherwise. Everything it draws comes from WB_peekShape (a whitelist), so
// no plan, fee, rate, QuickBooks, margin or hours data can reach it, and the
// money guard hides a note, message or role that talks about money.
//
// props: clientId, clients (my visibleClients; access), me (lowercase email),
// showing (the Client tab shows), keep (WB_usePeekKeep state; the fold),
// counts ({ open, late, text } from the tab's list, or null while loading),
// paneRef (the Client tab root; for the jumps), showMessage (false when
// Desk additions already draw a Message button in the header row).

function WB__peekSkel() {
  return <span className="wb-peek-skel" aria-hidden="true" />;
}

function WB_HubClientSummary(props) {
  var email = String(props.me || "").toLowerCase();
  var cid = String(props.clientId);
  var clients = Array.isArray(props.clients) ? props.clients : [];
  var showing = props.showing !== false;
  var ok = WB_peekAccess(cid, clients) === "ok";
  var client = ok
    ? clients.find(function (c) {
        return c && String(c.id) === cid;
      }) || null
    : null;

  var start = ok ? WB_peekMemGet(email, cid) : null;
  var readsPair = React.useState(start ? start.reads : {});
  var reads = readsPair[0];
  var setReads = readsPair[1];
  var readsRef = React.useRef(reads);
  var seqRef = React.useRef(null);
  if (!seqRef.current) seqRef.current = WB_cxSeq();
  // The client whose reads are loaded (or loading); null = read on next show.
  var loadedRef = React.useRef(start && start.fresh ? cid : null);
  var cidRef = React.useRef(cid);
  cidRef.current = cid;
  var clientsRef = React.useRef(clients);
  clientsRef.current = clients;
  var showRef = React.useRef(showing);
  showRef.current = showing;

  var apply = React.useCallback(function (sec, st) {
    if (!st || st.clientId !== cidRef.current) return;
    var next = Object.assign({}, readsRef.current);
    next[sec] = { status: st.status, data: st.data };
    readsRef.current = next;
    setReads(next);
  }, []);
  var run = React.useCallback(
    function (sections) {
      var sb = typeof window !== "undefined" ? window.mgbSupabase : null;
      var id = cidRef.current;
      var p = WB_peekFetch(sb, id, clientsRef.current, seqRef.current, apply, typeof DRV_status === "function" ? DRV_status : null, sections);
      if (!p) return;
      p.then(function () {
        if (cidRef.current === id) WB_peekMemPut(email, id, readsRef.current);
      });
    },
    [apply, email],
  );

  React.useEffect(
    function () {
      if (!ok) {
        // Access gone (a grant ended, an assignment removed): drop anything in flight.
        seqRef.current.reset();
        loadedRef.current = null;
        return;
      }
      if (!showing || loadedRef.current === cid) return;
      loadedRef.current = cid;
      var m = WB_peekMemGet(email, cid);
      readsRef.current = m ? m.reads : {};
      setReads(readsRef.current);
      if (m && m.fresh) return;
      run(null);
    },
    [cid, showing, ok, run],
  );

  // "Read again" (mgb:wb-peek with { reread }): now if showing, else on next show.
  React.useEffect(
    function () {
      var on = function (e) {
        var d = e && e.detail;
        if (!d || d.reread == null) return;
        if (d.reread !== true && String(d.reread) !== cidRef.current) return;
        if (showRef.current && WB_peekAccess(cidRef.current, clientsRef.current) === "ok") {
          loadedRef.current = cidRef.current;
          run(null);
        } else loadedRef.current = null;
      };
      window.addEventListener(WB_PEEK_STATE_EVENT, on);
      return function () {
        window.removeEventListener(WB_PEEK_STATE_EVENT, on);
      };
    },
    [run],
  );

  React.useEffect(function () {
    return function () {
      if (seqRef.current) seqRef.current.reset();
    };
  }, []);

  if (!ok || !client) return null;

  var view = WB_peekShape(client, reads, email);
  var stat = view.status;
  var tier = WB_deskTier(typeof window !== "undefined" ? window.innerHeight : 900);
  var folded = WB_peekFolded(tier, props.keep ? props.keep.collapsed : null);
  var bodyId = "wb-peek-body";

  var toggleFold = function () {
    WB_track("wb-hub", folded ? "peek:unfold" : "peek:fold");
    WB_peekSetCollapsed(email, !folded);
  };
  var retry = function (sec) {
    WB_track("wb-hub", "peek:retry");
    run(sec ? [sec] : null);
  };
  var pane = function () {
    return props.paneRef && props.paneRef.current ? props.paneRef.current : null;
  };
  var openContacts = function () {
    var root = pane();
    var sec = root ? root.querySelector(".tk-cc") : null;
    if (!sec) return;
    var btn = sec.querySelector(".tk-cc-toggle");
    if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
    if (sec.scrollIntoView) sec.scrollIntoView({ block: "start", behavior: "smooth" });
    WB_track("wb-hub", "peek:contacts");
  };
  var jumpTasks = function () {
    var root = pane();
    var g = root ? root.querySelector(".wb-hub-client-body .tk-cd-group:not(.tk-cc)") : null;
    if (g && g.scrollIntoView) g.scrollIntoView({ block: "start", behavior: "smooth" });
    var first = g ? g.querySelector("li.tk-row[data-tk-id]") : null;
    if (first && first.focus) {
      try {
        first.focus({ preventScroll: true });
      } catch (e) {}
    }
    WB_track("wb-hub", "peek:tasks");
  };
  var copyEmail = function () {
    var e = view.contact && view.contact.email;
    if (!e) return;
    var done = function () {
      WB_toast("Email copied.");
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(e).then(done, function () {
          WB_toast("Couldn't copy. Select the email and copy it.");
        });
        return;
      }
    } catch (err) {}
    WB_toast("Couldn't copy. Select the email and copy it.");
  };
  var message = function () {
    WB_track("wb-hub", "peek:message");
    if (typeof WB__openChat === "function" && WB__openChat(cid, null)) return;
    WB_store.setDrawerOpen(false);
    if (typeof LK_go === "function") LK_go({ clientId: cid, tab: "messages" });
  };
  var openDrive = function () {
    WB_track("wb-hub", "peek:drive");
  };

  var fail = function (sec, label) {
    return (
      <span className="wb-peek-fail">
        {label ? label + ": " : ""}Couldn't load ·{" "}
        <button
          type="button"
          className="wb-peek-link"
          onClick={function () {
            retry(sec);
          }}
        >
          Retry
        </button>
      </span>
    );
  };
  var driveLink = view.driveUrl ? (
    <a className="wb-peek-link" href={view.driveUrl} target="_blank" rel="noopener noreferrer" onClick={openDrive}>
      Drive folder <span aria-hidden="true">↗</span>
    </a>
  ) : null;

  var people = [];
  if (view.bookkeeper) people.push("Bookkeeper: " + view.bookkeeper.name);
  if (view.am) people.push("AM: " + view.am.name);
  var peopleText = people.length ? people.join(" · ") : "No bookkeeper assigned";

  var head = (
    <div className="wb-peek-head">
      <button
        type="button"
        className="wb-peek-fold"
        aria-expanded={folded ? "false" : "true"}
        aria-controls={bodyId}
        aria-label={folded ? "Show client summary" : "Hide client summary"}
        title={folded ? "Show summary" : "Hide summary"}
        onClick={toggleFold}
      >
        <span aria-hidden="true">{folded ? "▸" : "▾"}</span>
      </button>
      {folded ? (
        <span className="wb-peek-line wb-peek-oneline">
          <span className="wb-peek-ellip">{WB_peekFoldParts(view).text || peopleText}</span>
          {driveLink ? <span className="wb-peek-sep"> · </span> : null}
          {driveLink}
        </span>
      ) : (
        <span className="wb-peek-line wb-peek-people">{peopleText}</span>
      )}
    </div>
  );

  if (folded) {
    return (
      <section className="wb-peek is-folded" data-tour="wb-peek" aria-label="Client summary">
        {head}
      </section>
    );
  }

  var allLoading = stat.contacts === "loading" && stat.flag === "loading" && stat.message === "loading";
  var allFailed = stat.contacts === "error" && stat.flag === "error" && stat.message === "error";
  var now = new Date();

  var rows;
  if (allFailed) {
    rows = (
      <p className="wb-peek-line wb-peek-fail" role="status">
        Can't reach the server.{" "}
        <button
          type="button"
          className="wb-peek-link"
          onClick={function () {
            retry(null);
          }}
        >
          Retry
        </button>
      </p>
    );
  } else if (allLoading) {
    rows = (
      <div className="wb-peek-loading" aria-busy="true" aria-label="Loading the client summary">
        {WB__peekSkel()}
        {WB__peekSkel()}
      </div>
    );
  } else {
    var contactRow;
    if (stat.contacts === "loading") contactRow = WB__peekSkel();
    else if (stat.contacts === "error") contactRow = fail("contacts", "Contacts");
    else if (!view.contact) {
      contactRow = (
        <span className="wb-peek-muted">
          No contacts yet ·{" "}
          <button type="button" className="wb-peek-link" onClick={openContacts}>
            Add
          </button>
        </span>
      );
    } else {
      contactRow = (
        <span className="wb-peek-contact">
          <span className="wb-peek-ellip">
            {view.contact.role ? <span className="wb-peek-label">{view.contact.role}: </span> : null}
            {view.contact.name}
          </span>
          {view.contact.email ? (
            <span className="wb-peek-email">
              <span className="wb-peek-email-text">{view.contact.email}</span>
              <button type="button" className="wb-peek-link" onClick={copyEmail} aria-label={"Copy " + view.contact.name + "'s email"}>
                Copy
              </button>
            </span>
          ) : null}
          {view.moreCount > 0 ? (
            <button type="button" className="wb-peek-link" onClick={openContacts}>
              +{view.moreCount} more
            </button>
          ) : null}
        </span>
      );
    }

    var flagRow = null;
    if (stat.flag === "loading") flagRow = WB__peekSkel();
    else if (stat.flag === "error") flagRow = fail("flag", "Flag");
    else if (view.flag) {
      flagRow = (
        <span className={"wb-peek-ellip" + (view.flag.hidden ? " wb-peek-muted" : "")}>
          <span className="wb-peek-label">Flag: </span>
          {view.flag.hidden ? view.flag.text : "“" + view.flag.text + "”"}
        </span>
      );
    }

    var driveRow = null;
    if (stat.drive === "error") driveRow = fail("drive", "Drive");
    else if (driveLink) driveRow = driveLink;

    var msgRow = null;
    if (stat.message === "loading") msgRow = WB__peekSkel();
    else if (stat.message === "error") msgRow = fail("message", "Last message");
    else if (view.message) {
      var when = WB_cxWhen(view.message.at, now);
      msgRow = (
        <button type="button" className="wb-peek-msg" onClick={message} title="Open the conversation">
          <span className="wb-peek-label">Last message: </span>
          {view.message.who || view.message.kindLabel}
          {view.message.who ? " (" + view.message.kindLabel + ")" : ""}
          {when ? " · " + when : ""}
          {" · "}
          <span className={view.message.hidden ? "wb-peek-muted" : ""}>{view.message.hidden ? view.message.text : "“" + view.message.text + "”"}</span>
        </button>
      );
    }

    var counts = props.counts;
    rows = (
      <React.Fragment>
        <div className="wb-peek-row">{contactRow}</div>
        {driveRow || flagRow ? (
          <div className="wb-peek-row wb-peek-split">
            {driveRow}
            {driveRow && flagRow ? <span className="wb-peek-sep"> · </span> : null}
            {flagRow}
          </div>
        ) : null}
        {msgRow ? <div className="wb-peek-row">{msgRow}</div> : null}
      </React.Fragment>
    );
    var nextRow = (
      <div className="wb-peek-row wb-peek-actions">
        {counts ? (
          counts.open > 0 ? (
            <button type="button" className="wb-peek-link wb-peek-next" onClick={jumpTasks}>
              Next: {counts.text} <span aria-hidden="true">→</span>
            </button>
          ) : (
            <span className="wb-peek-muted">{counts.text}</span>
          )
        ) : (
          WB__peekSkel()
        )}
        <span className="wb-hub-client-gap" />
        {props.showMessage !== false ? (
          <button type="button" className="btn-secondary wb-hub-add" onClick={message}>
            Message
          </button>
        ) : null}
      </div>
    );
    rows = (
      <React.Fragment>
        {rows}
        {nextRow}
      </React.Fragment>
    );
  }

  return (
    <section className="wb-peek" data-tour="wb-peek" aria-label="Client summary">
      {head}
      <div className="wb-peek-body" id={bodyId}>
        {rows}
      </div>
    </section>
  );
}

// ---- Keep on Desk from a client page (hidden preview) ----
// The client page header button ("Keep on Desk" / "Kept on Desk ✓") and the
// p key, which toggles the same keep. Renders nothing and listens to no key
// while the gate is off. app.jsx mounts it only for staff on a client's own
// pages with the Desk live (never under View as, previewing or impersonation,
// where the Desk doesn't mount).
// props: client ({ id, name }), me (real signed-in email), deskOn.
function WB_PeekPageKeep(props) {
  var on = typeof WB_usePeek === "function" ? WB_usePeek(props.deskOn === true) : false;
  var email = String(props.me || "").toLowerCase();
  var keep = WB_usePeekKeep(email, on);
  var client = props.client || null;
  var id = client && client.id != null ? String(client.id) : null;
  // Tell the Cmd-K "Keep X on Desk" row that this mount (the app's own gate:
  // staffClientTabs && wbDeskOn, not previewing, not View as) is live.
  React.useEffect(function () {
    if (!on) return undefined;
    window.MGB_peekKeepMounted = (window.MGB_peekKeepMounted || 0) + 1;
    return function () {
      window.MGB_peekKeepMounted = Math.max(0, (window.MGB_peekKeepMounted || 1) - 1);
    };
  }, [on]);
  var clientRef = React.useRef(client);
  clientRef.current = client;
  var kept = on && id != null && keep.keptId === id;

  var toggle = React.useCallback(
    function (how) {
      var c = clientRef.current;
      if (!c) return;
      var r = WB_peekToggleFromPage(email, c);
      WB_track("wb-hub", (r ? "peek:keep:" : "peek:unkeep:") + how);
    },
    [email],
  );

  React.useEffect(
    function () {
      if (!on || id == null) return undefined;
      var onKey = function (e) {
        if (e.key !== "p" || e.repeat) return;
        if (document.querySelector(".tk-dw-layer")) return;
        if (typeof TK_shouldHandleKey !== "function") return;
        var kc = typeof TK_vKeyCtx === "function" ? TK_vKeyCtx() : {};
        var ctx = {
          modalOpen: !!document.querySelector(".modal-overlay"),
          menuOpen: !!kc.menuOpen,
          tourOpen: !!kc.tourOpen,
          scope: "global",
          keysOff: typeof TK_prefsQuickKeysOff === "function" ? TK_prefsQuickKeysOff() : false,
        };
        if (!TK_shouldHandleKey(e, ctx)) return;
        e.preventDefault();
        toggle("key");
      };
      window.addEventListener("keydown", onKey);
      return function () {
        window.removeEventListener("keydown", onKey);
      };
    },
    [on, id, toggle],
  );

  if (!on || id == null) return null;
  var name = String((client && client.name) || "this client");
  return (
    <button
      type="button"
      className={"btn-secondary wb-peek-pagekeep" + (kept ? " is-on" : "")}
      aria-pressed={kept ? "true" : "false"}
      title={kept ? "The Desk's Client tab stays on " + name + ". Click to stop (p)." : "Keep " + name + " on the Desk's Client tab while you open other pages (p)."}
      data-tour="wb-peek-page-keep"
      onClick={function () {
        toggle("button");
      }}
    >
      {kept ? "Kept on Desk ✓" : "Keep on Desk"}
    </button>
  );
}
