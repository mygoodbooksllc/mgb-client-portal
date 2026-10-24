// ----------------------------------------------------------------------------
// TK_SavedViews.jsx — named saved views for the Slate app (slice P3).
//
// Exports: TK_SavedViewsMenu
//
// A "Views" menu in the Slate view bar, shown only inside the Slate app
// (TK_MyTasks passes it to TK_SlateViewBar when TK_useSlateInApp() is true, so
// the portal Slate page and the Desk's Slate tab never see it). It lists my
// named views for this scope (table tk_saved_views, RLS own-only, 30 each),
// plus a built-in "Default": the older single view this browser kept, which is
// never migrated or deleted. Picking an entry applies it. Edits (Save as new
// view, Rename, Update with current, Delete) carry class "tk-p3-edit" and
// are hidden by CSS in the compact and sliver sizes, which are read-only.
//
// Default is a baseline copy of the older view, taken before the first named
// view is applied (the older view auto-saves, so without a copy applying a
// named view would overwrite it). "Update" on Default replaces that copy.
//
// props: { view (the live view), onApply(view), email, scope ("slate") }
// Pure rules (names, merge, active marker, error codes) are in TK_viewLogic.js.
// ----------------------------------------------------------------------------

function TK_svToast(text) {
  if (!text) return;
  if (typeof TK_vToast === "function") TK_vToast(text);
  else {
    try {
      window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text: text } }));
    } catch (e) {}
  }
}

function TK_svErrText(err) {
  var code = TK_savedViewErrorCode(err);
  if (code) return TK_viewNameErrorText(code);
  if (err && err.code === "tk_offline") return "You're offline. Try again when you're back online.";
  return typeof TK_vErrText === "function" ? TK_vErrText(err) : "Couldn't save that view. Try again.";
}

function TK_SavedViewsMenu(props) {
  var scope = props.scope || "slate";
  var email = props.email || "";
  var view = props.view;
  var baseKey = TK_slateBaselineKey(email, scope);

  var rPair = React.useState(null); // null while loading
  var rows = rPair[0];
  var setRows = rPair[1];
  var ePair = React.useState("");
  var loadErr = ePair[0];
  var setLoadErr = ePair[1];
  var bPair = React.useState(function () {
    return TK_vLsGet(baseKey, null);
  });
  var base = bPair[0];
  var setBase = bPair[1];
  // Re-read the baseline when the person (or scope) changes, e.g. the email
  // arriving after the first render, so Default never shows a stale copy.
  var keyRef = React.useRef(baseKey);
  React.useEffect(
    function () {
      if (keyRef.current === baseKey) return;
      keyRef.current = baseKey;
      setBase(TK_vLsGet(baseKey, null));
    },
    [baseKey],
  );
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

  // Only the newest list request may land: a slow older answer (another
  // scope, or before Retry) never overwrites a newer one.
  var reqRef = React.useRef(0);
  var load = function () {
    setLoadErr("");
    var req = ++reqRef.current;
    TK_api.savedViewsList(scope).then(
      function (list) {
        if (req !== reqRef.current) return;
        setRows(list);
      },
      function (err) {
        if (req !== reqRef.current) return;
        setRows(function (cur) {
          return cur || [];
        });
        setLoadErr(TK_svErrText(err));
      },
    );
  };
  React.useEffect(function () {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, email]);

  var list = Array.isArray(rows) ? rows : [];
  var defView = TK_resolveDefaultView(base, view, list);
  var merged = TK_mergeSavedViews(list, defView);
  var activeId = TK_activeSavedViewId(merged, view);
  var current = TK_normalizeSlateView(view);

  var apply = function (entry) {
    // Keep the older view safe before the first named view replaces it.
    if (!entry.isDefault && !base) {
      var keep = TK_resolveDefaultView(null, view, list);
      TK_vLsSet(baseKey, keep);
      setBase(keep);
    }
    if (typeof props.onApply === "function") props.onApply(entry.view);
  };

  var updateDefault = function () {
    TK_vLsSet(baseKey, current);
    setBase(current);
    TK_svToast("Default now matches the view you have open.");
  };

  var updateSaved = function (entry) {
    if (busy) return;
    setBusy(true);
    TK_api.savedViewUpdate(entry.id, { view: current }).then(
      function (row) {
        setBusy(false);
        setRows(function (cur) {
          return (cur || []).map(function (r) {
            return String(r.id) === String(entry.id) ? row : r;
          });
        });
        TK_svToast('Updated "' + entry.name + '" with the view you have open.');
      },
      function (err) {
        setBusy(false);
        TK_svToast(TK_svErrText(err));
      },
    );
  };

  var openPanel = function (p) {
    setFormErr("");
    setText(p.mode === "rename" ? p.name : "");
    setPanel(p);
  };
  var closePanel = function () {
    setPanel(null);
    setFormErr("");
  };

  var submit = function (e) {
    e.preventDefault();
    if (!panel || busy) return;
    if (panel.mode === "delete") {
      setBusy(true);
      TK_api.savedViewDelete(panel.id).then(
        function () {
          setBusy(false);
          setRows(function (cur) {
            return (cur || []).filter(function (r) {
              return String(r.id) !== String(panel.id);
            });
          });
          closePanel();
          TK_svToast('Deleted the view "' + panel.name + '".');
        },
        function (err) {
          setBusy(false);
          setFormErr(TK_svErrText(err));
        },
      );
      return;
    }
    var rename = panel.mode === "rename";
    var v = TK_validateViewName(text, merged, rename ? panel.id : null);
    if (!v.ok) {
      setFormErr(v.text);
      return;
    }
    if (!rename && !TK_canAddSavedView(merged)) {
      setFormErr(TK_viewNameErrorText("too_many"));
      return;
    }
    setBusy(true);
    var req = rename ? TK_api.savedViewUpdate(panel.id, { name: v.name }) : TK_api.savedViewCreate(scope, v.name, current, TK_nextViewPosition(merged));
    req.then(
      function (row) {
        setBusy(false);
        setRows(function (cur) {
          var rest = (cur || []).filter(function (r) {
            return String(r.id) !== String(row.id);
          });
          return rest.concat([row]);
        });
        closePanel();
        TK_svToast(rename ? 'Renamed to "' + v.name + '".' : 'Saved the view "' + v.name + '".');
      },
      function (err) {
        setBusy(false);
        setFormErr(TK_svErrText(err));
      },
    );
  };

  var panelEl = null;
  if (panel) {
    var del = panel.mode === "delete";
    panelEl = (
      <form className="tk-p3-panel tk-p3-edit" onSubmit={submit} aria-label={del ? "Delete saved view" : panel.mode === "rename" ? "Rename saved view" : "Save as new view"}>
        {del ? (
          <p className="tk-p3-panel-q">{'Delete the view "' + panel.name + '"?'}</p>
        ) : (
          <label className="tk-p3-panel-label">
            <span>{panel.mode === "rename" ? "New name" : "View name"}</span>
            <input
              type="text"
              className="tk-input"
              value={text}
              maxLength={TK_SAVED_VIEW_NAME_MAX}
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

  return (
    <span className="tk-p3-views" data-tour="tk-slate-views">
      <TK_vMenuButton label="Views" className="tk-tool-btn tk-p3-views-btn" menuLabel="Saved views" title="Your saved views">
        {function (close) {
          return (
            <div className="tk-p3-vlist">
              {rows === null && !loadErr ? <span className="tk-menu-note">Loading your views...</span> : null}
              {loadErr ? (
                <span className="tk-menu-note">
                  {loadErr + " "}
                  <button type="button" role="menuitem" className="tk-link-btn" onClick={load}>
                    Try again
                  </button>
                </span>
              ) : null}
              {merged.map(function (entry) {
                var on = entry.id === activeId;
                return (
                  <div key={entry.id} className="tk-p3-vrow">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={on ? "true" : "false"}
                      className={"tk-menu-item tk-p3-vapply" + (on ? " is-on" : "")}
                      onClick={function () {
                        apply(entry);
                        close();
                      }}
                    >
                      <span className="tk-p3-vmark" aria-hidden="true">
                        {on ? "✓" : ""}
                      </span>
                      <span className="tk-menu-label">{entry.name}</span>
                    </button>
                    <span className="tk-p3-edit tk-p3-vtools">
                      {entry.isDefault ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="tk-link-btn tk-p3-vtool"
                          title="Make Default match the view you have open"
                          aria-label="Update Default with current view"
                          onClick={function () {
                            updateDefault();
                            close();
                          }}
                        >
                          Update
                        </button>
                      ) : (
                        <span className="tk-p3-vtools-set">
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
                            className="tk-link-btn tk-p3-vtool"
                            title="Replace this view with the one you have open"
                            aria-label={"Update " + entry.name + " with current view"}
                            disabled={busy}
                            onClick={function () {
                              close();
                              updateSaved(entry);
                            }}
                          >
                            Update
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
                      )}
                    </span>
                  </div>
                );
              })}
              <div className="tk-p3-edit tk-p3-vnew">
                <button
                  type="button"
                  role="menuitem"
                  className="tk-menu-item"
                  disabled={!TK_canAddSavedView(merged)}
                  title={TK_canAddSavedView(merged) ? undefined : TK_viewNameErrorText("too_many")}
                  onClick={function () {
                    close();
                    openPanel({ mode: "new" });
                  }}
                >
                  Save as new view…
                </button>
              </div>
            </div>
          );
        }}
      </TK_vMenuButton>
      {panelEl}
    </span>
  );
}
