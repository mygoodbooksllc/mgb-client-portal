// ----------------------------------------------------------------------------
// TK_FilterBar.jsx — the Slate page search box (docs/slateplus-filters-spec.md).
//
// Exports: TK_SlateListSearch, TK_SlateFilterBar
//
// TK_SlateListSearch({ value, onChange(text), count }) — the "Search title,
// client, notes" box in the Slate toolbar (live for all staff). Instant: the
// list filters as you type (TK_applySearch in TK_filterLogic.js), nothing goes
// to the server. Esc clears the text, a second Esc leaves the box. The ×
// button clears it too. While typing, list keys never fire (the box is a
// typing target for TK_shouldHandleKey). Only TK_vMyTasksBody renders it, and
// only on the full Slate list (not embedded, not the summary, not View as).
//
// TK_SlateFilterBar (Slate plus, hidden preview: rendered only when TKP_on()
// and not embedded, so never in View as): a row under the view bar with
// Assignee, Client, Project, Due and Status selects, Clear filters, and a
// "Saved filters" menu (apply, Save this view..., Rename, Delete, Set as my
// default / Remove default) backed by tk_slate_filter_views (owner-only RLS).
// props: { value (full filter set incl. q and client), onChange(next set),
//   clients [{id, name}], clientNames {id: name}, tasks (loaded rows, for the
//   project list), projectNames {id: name}, email }
// My default applies once per page load, and only while nothing is typed or
// picked. Pure rules: TK_filterLogic.js.
// ----------------------------------------------------------------------------

function TK_SlateListSearch(props) {
  var value = props.value || "";
  var inputRef = React.useRef(null);
  var max = typeof TK_SEARCH_MAX === "number" ? TK_SEARCH_MAX : 200;
  var on = !!value.trim();
  var countText = on && typeof TK_searchCountText === "function" ? TK_searchCountText(props.count) : "";
  var clear = function (refocus) {
    props.onChange("");
    if (refocus && inputRef.current) {
      try {
        inputRef.current.focus();
      } catch (e) {}
    }
  };
  return (
    <span className={"tk-list-search" + (on ? " is-on" : "")} role="search" data-tour="tk-search">
      <TK_vIcon name="search" size={15} />
      <input
        ref={inputRef}
        type="text"
        className="tk-list-search-input"
        aria-label="Search this list by title, client or notes"
        placeholder="Search title, client, notes"
        maxLength={max}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={function (e) {
          props.onChange(e.target.value);
        }}
        onKeyDown={function (e) {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          if (e.nativeEvent && typeof e.nativeEvent.stopImmediatePropagation === "function") e.nativeEvent.stopImmediatePropagation();
          if (value) clear(false);
          else if (inputRef.current) inputRef.current.blur();
        }}
      />
      {value ? (
        <button
          type="button"
          className="tk-list-search-clear"
          aria-label="Clear search"
          title="Clear search (Esc)"
          onClick={function () {
            clear(true);
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
      <span className="tk-sr" aria-live="polite">
        {countText}
      </span>
    </span>
  );
}

// Once per page load, per person: was the default already considered?
var TK__fbDefaultSeen = {};

function TK__fbToast(text) {
  if (!text) return;
  if (typeof TK_vToast === "function") TK_vToast(text);
}

function TK__fbErrText(err) {
  var code = TK_filterViewErrorCode(err);
  if (code) return TK_filterViewErrorText(code);
  return typeof TK_vErrText === "function" ? TK_vErrText(err) : TK_filterViewErrorText("");
}

function TK__fbSelect(props) {
  return (
    <label className="tk-select-wrap tk-fb-field">
      <span className="tk-sr">{props.label}</span>
      <select
        className={"tk-select" + (props.on ? " is-on" : "")}
        value={props.value}
        onChange={function (e) {
          props.onChange(e.target.value);
        }}
      >
        {props.options.map(function (o) {
          return (
            <option key={o[0]} value={o[0]}>
              {o[1]}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function TK_SlateFilterBar(props) {
  var email = props.email || "";
  var value = TK_normalizeSlateFilters(props.value);
  var raw = props.value || {};
  var rawDue = raw.due === "custom" ? "custom" : value.due;
  var set = function (patch) {
    // start from what is shown, so a half-filled custom range survives other picks
    var next = Object.assign({}, value, rawDue === "custom" ? { due: "custom", from: TK__fbYmd(raw.from), to: TK__fbYmd(raw.to) } : {}, patch);
    if (patch.due && patch.due !== "custom") {
      next.from = "";
      next.to = "";
    }
    // keep a half-filled custom range as typed (normalize would drop it)
    if (next.due === "custom") {
      props.onChange(Object.assign(TK_normalizeSlateFilters(next), { due: "custom", from: TK__fbYmd(next.from), to: TK__fbYmd(next.to) }));
      return;
    }
    props.onChange(TK_normalizeSlateFilters(next));
  };

  // ---- options
  var clients = Array.isArray(props.clients) ? props.clients : [];
  var clientNames = props.clientNames || {};
  var clientOpts = [["", "All clients"]];
  var seenClient = {};
  clients.forEach(function (c) {
    seenClient[String(c.id)] = 1;
    clientOpts.push([String(c.id), typeof CF_label === "function" ? CF_label(c) : c.name]);
  });
  if (value.client && !seenClient[value.client]) clientOpts.push([value.client, clientNames[value.client] || "Client not in your list"]);
  var projectNames = props.projectNames || {};
  var seenProject = {};
  (Array.isArray(props.tasks) ? props.tasks : []).forEach(function (t) {
    if (t && t.project_id != null) seenProject[String(t.project_id)] = 1;
  });
  if (value.project && value.project !== "none") seenProject[value.project] = 1;
  var projectOpts = [["", "Any project"], ["none", "No project"]].concat(
    Object.keys(seenProject)
      .map(function (id) {
        return [id, projectNames[id] || "Project"];
      })
      .sort(function (a, b) {
        var x = String(a[1]).toLowerCase();
        var y = String(b[1]).toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      }),
  );
  var active = TK_slateFiltersActive(Object.assign({}, value, { due: rawDue }));

  // ---- saved filters
  var rPair = React.useState(null); // null while loading
  var rows = rPair[0];
  var setRows = rPair[1];
  var ePair = React.useState("");
  var loadErr = ePair[0];
  var setLoadErr = ePair[1];
  var pPair = React.useState(null); // { mode: "new" | "rename" | "delete", id, name }
  var panel = pPair[0];
  var setPanel = pPair[1];
  var tPair = React.useState("");
  var text = tPair[0];
  var setText = tPair[1];
  var fPair = React.useState("");
  var formErr = fPair[0];
  var setFormErr = fPair[1];
  var yPair = React.useState(false);
  var busy = yPair[0];
  var setBusy = yPair[1];
  var valueRef = React.useRef(value);
  valueRef.current = Object.assign({}, value, { due: rawDue });
  var onChangeRef = React.useRef(props.onChange);
  onChangeRef.current = props.onChange;

  var reqRef = React.useRef(0);
  var load = function () {
    setLoadErr("");
    var req = ++reqRef.current;
    TK_api.filterViewsList().then(
      function (list) {
        if (req !== reqRef.current) return;
        setRows(list);
        if (!email || TK__fbDefaultSeen[email]) return;
        TK__fbDefaultSeen[email] = true;
        var def = list.filter(function (r) {
          return r && r.is_default;
        })[0];
        if (def && !TK_slateFiltersActive(valueRef.current)) onChangeRef.current(TK_normalizeSlateFilters(def.filters));
      },
      function (err) {
        if (req !== reqRef.current) return;
        setRows(function (cur) {
          return cur || [];
        });
        setLoadErr(TK__fbErrText(err));
      },
    );
  };
  React.useEffect(
    function () {
      if (email) load();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [email],
  );

  var list = Array.isArray(rows) ? rows : [];
  var activeId = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && TK_slateFiltersEqual(list[i].filters, value)) {
      activeId = list[i].id;
      break;
    }
  }
  var nextPos = list.reduce(function (m, r) {
    return Math.max(m, Number(r && r.position) || 0);
  }, 0) + 1;

  var openPanel = function (p) {
    setFormErr("");
    setText(p.mode === "rename" ? p.name : "");
    setPanel(p);
  };
  var closePanel = function () {
    setPanel(null);
    setFormErr("");
  };
  var replaceRow = function (row) {
    setRows(function (cur) {
      var rest = (cur || []).filter(function (r) {
        return String(r.id) !== String(row.id);
      });
      return rest.concat([row]).sort(function (a, b) {
        return (Number(a.position) || 0) - (Number(b.position) || 0);
      });
    });
  };

  var setDefault = function (entry, on) {
    if (busy) return;
    setBusy(true);
    TK_api.filterViewSetDefault(on ? entry.id : null).then(
      function () {
        setBusy(false);
        setRows(function (cur) {
          return (cur || []).map(function (r) {
            return Object.assign({}, r, { is_default: on ? String(r.id) === String(entry.id) : false });
          });
        });
        TK__fbToast(on ? '"' + entry.name + '" now opens with your Slate.' : "Your Slate opens with no filters again.");
      },
      function (err) {
        setBusy(false);
        TK__fbToast(TK__fbErrText(err));
      },
    );
  };

  var submit = function (e) {
    e.preventDefault();
    if (!panel || busy) return;
    if (panel.mode === "delete") {
      setBusy(true);
      TK_api.filterViewDelete(panel.id).then(
        function () {
          setBusy(false);
          setRows(function (cur) {
            return (cur || []).filter(function (r) {
              return String(r.id) !== String(panel.id);
            });
          });
          closePanel();
          TK__fbToast('Deleted the saved filter "' + panel.name + '".');
        },
        function (err) {
          setBusy(false);
          setFormErr(TK__fbErrText(err));
        },
      );
      return;
    }
    var rename = panel.mode === "rename";
    var v = TK_filterViewNameCheck(text, list, rename ? panel.id : null);
    if (!v.ok) {
      setFormErr(v.text);
      return;
    }
    setBusy(true);
    var req = rename ? TK_api.filterViewUpdate(panel.id, { name: v.name }) : TK_api.filterViewCreate(v.name, value, nextPos);
    req.then(
      function (row) {
        setBusy(false);
        if (row) replaceRow(row);
        closePanel();
        TK__fbToast(rename ? 'Renamed to "' + v.name + '".' : 'Saved the filter "' + v.name + '".');
      },
      function (err) {
        setBusy(false);
        setFormErr(TK__fbErrText(err));
      },
    );
  };

  var panelEl = null;
  if (panel) {
    var del = panel.mode === "delete";
    panelEl = (
      <form className="tk-p3-panel tk-p3-edit tk-fb-panel" onSubmit={submit} aria-label={del ? "Delete saved filter" : panel.mode === "rename" ? "Rename saved filter" : "Save this view"}>
        {del ? (
          <p className="tk-p3-panel-q">{'Delete the saved filter "' + panel.name + '"?'}</p>
        ) : (
          <label className="tk-p3-panel-label">
            <span>{panel.mode === "rename" ? "New name" : "Name this filter"}</span>
            <input
              type="text"
              className="tk-input"
              value={text}
              maxLength={TK_FILTER_VIEW_NAME_MAX}
              autoFocus
              autoComplete="off"
              onChange={function (e) {
                setText(e.target.value);
                if (formErr) setFormErr("");
              }}
              onKeyDown={function (e) {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  closePanel();
                }
              }}
            />
          </label>
        )}
        {formErr ? (
          <p className="tk-p3-panel-err" role="alert">
            {formErr}
          </p>
        ) : null}
        <span className="tk-p3-panel-btns">
          <button type="submit" className={del ? "tk-tool-btn tk-bulk-danger" : "btn-primary"} disabled={busy}>
            {del ? "Delete" : "Save"}
          </button>
          <button type="button" className="btn-secondary" onClick={closePanel}>
            Cancel
          </button>
        </span>
      </form>
    );
  }

  var canAdd = list.length < TK_FILTER_VIEW_MAX;
  return (
    <div className={"tk-fb" + (active ? " is-on" : "")} role="group" aria-label="Filter the Slate list" data-tour="tk-filter-bar">
      {value.q && typeof TKS_SearchBox === "function" ? (
        // Profile 2: the in-list box is gone (the unified search sets this);
        // the text filter shows here as a removable chip.
        <span className="tks-text-chip">
          <span className="tks-text-chip-label">{'Text: "' + value.q + '"'}</span>
          <button
            type="button"
            className="tks-text-chip-x"
            aria-label={'Remove the text filter "' + value.q + '"'}
            onClick={function () {
              set({ q: "" });
            }}
          >
            ×
          </button>
        </span>
      ) : null}
      <TK__fbSelect
        label="Assignee"
        value={value.assignee}
        on={value.assignee !== "any"}
        options={[["any", "Anyone"], ["me", "Assigned to me"], ["unassigned", "Unassigned"]]}
        onChange={function (v) {
          set({ assignee: v });
        }}
      />
      <TK__fbSelect
        label="Client"
        value={value.client}
        on={!!value.client}
        options={clientOpts}
        onChange={function (v) {
          set({ client: v });
        }}
      />
      <TK__fbSelect
        label="Project"
        value={value.project}
        on={!!value.project}
        options={projectOpts}
        onChange={function (v) {
          set({ project: v });
        }}
      />
      <TK__fbSelect
        label="Due"
        value={rawDue}
        on={rawDue !== "any"}
        options={[["any", "Any due date"], ["late", "Late"], ["today", "Due today"], ["next7", "Next 7 days"], ["next30", "Next 30 days"], ["none", "No due date"], ["custom", "Custom range…"]]}
        onChange={function (v) {
          set({ due: v });
        }}
      />
      {rawDue === "custom" ? (
        <span className="tk-fb-range">
          <label className="tk-fb-date">
            <span>From</span>
            <input
              type="date"
              className="tk-input"
              value={TK__fbYmd(raw.from)}
              onChange={function (e) {
                set({ due: "custom", from: e.target.value });
              }}
            />
          </label>
          <label className="tk-fb-date">
            <span>To</span>
            <input
              type="date"
              className="tk-input"
              value={TK__fbYmd(raw.to)}
              onChange={function (e) {
                set({ due: "custom", to: e.target.value });
              }}
            />
          </label>
        </span>
      ) : null}
      <TK__fbSelect
        label="Status"
        value={value.status}
        on={value.status !== "any"}
        options={[["any", "Any status"], ["late", "Late"], ["waiting", "Waiting on client"], ["todo", "To do"], ["in_progress", "In progress"], ["ready_for_review", "Ready for review"]]}
        onChange={function (v) {
          set({ status: v });
        }}
      />
      {active ? (
        <button
          type="button"
          className="tk-link-btn tk-fb-clear"
          onClick={function () {
            props.onChange(TK_normalizeSlateFilters({}));
          }}
        >
          Clear filters
        </button>
      ) : null}
      <span className="tk-p3-views tk-fb-saved" data-tour="tk-filter-saved">
        <TK_vMenuButton label="Saved filters" className="tk-tool-btn" menuLabel="Saved filters" title="Your saved filters" align="right">
          {function (close) {
            return (
              <div className="tk-p3-vlist tk-fb-vlist">
                {rows === null && !loadErr ? <span className="tk-menu-note">Loading your saved filters...</span> : null}
                {loadErr ? (
                  <span className="tk-menu-note">
                    {loadErr + " "}
                    <button type="button" role="menuitem" className="tk-link-btn" onClick={load}>
                      Try again
                    </button>
                  </span>
                ) : null}
                {rows !== null && !loadErr && !list.length ? <span className="tk-menu-note">No saved filters yet. Pick some filters, then Save this view.</span> : null}
                {list.map(function (entry) {
                  var on = entry.id === activeId;
                  return (
                    <div key={entry.id} className="tk-p3-vrow tk-fb-vrow">
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={on ? "true" : "false"}
                        className={"tk-menu-item tk-p3-vapply" + (on ? " is-on" : "")}
                        onClick={function () {
                          props.onChange(TK_normalizeSlateFilters(entry.filters));
                          close();
                        }}
                      >
                        <span className="tk-p3-vmark" aria-hidden="true">
                          {on ? "✓" : ""}
                        </span>
                        <span className="tk-menu-label">{entry.name}</span>
                        {entry.is_default ? <span className="tk-fb-deftag">Default</span> : null}
                      </button>
                      <span className="tk-p3-edit tk-p3-vtools">
                        <span className="tk-p3-vtools-set">
                          <button
                            type="button"
                            role="menuitem"
                            className="tk-link-btn tk-p3-vtool"
                            disabled={busy}
                            aria-label={(entry.is_default ? "Remove default: " : "Set as my default: ") + entry.name}
                            title={entry.is_default ? "Open the Slate with no filters" : "Open the Slate with this filter each time"}
                            onClick={function () {
                              close();
                              setDefault(entry, !entry.is_default);
                            }}
                          >
                            {entry.is_default ? "Remove default" : "Set as my default"}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="tk-link-btn tk-p3-vtool"
                            aria-label={"Rename " + entry.name}
                            onClick={function () {
                              close();
                              openPanel({ mode: "rename", id: entry.id, name: entry.name });
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="tk-link-btn tk-p3-vtool tk-menu-danger"
                            aria-label={"Delete " + entry.name}
                            onClick={function () {
                              close();
                              openPanel({ mode: "delete", id: entry.id, name: entry.name });
                            }}
                          >
                            Delete
                          </button>
                        </span>
                      </span>
                    </div>
                  );
                })}
                <div className="tk-p3-edit tk-p3-vnew">
                  <button
                    type="button"
                    role="menuitem"
                    className="tk-menu-item"
                    disabled={!canAdd || !active}
                    title={!canAdd ? TK_filterViewErrorText("too_many") : !active ? "Pick a filter or type a search first" : undefined}
                    onClick={function () {
                      close();
                      openPanel({ mode: "new" });
                    }}
                  >
                    Save this view…
                  </button>
                </div>
              </div>
            );
          }}
        </TK_vMenuButton>
        {panelEl}
      </span>
    </div>
  );
}

function TK__fbYmd(v) {
  var s = v == null ? "" : String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}
