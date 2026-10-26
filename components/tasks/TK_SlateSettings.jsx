// ----------------------------------------------------------------------------
// TK_SlateSettings.jsx — the Slate app's Settings page (#/tasks/settings).
//
// Reached from the gear in TK_StandaloneBar (app only; TK_App shows it only
// when TK_slateInApp()). Per person, this browser only: nothing here is
// firm-wide and nothing needs a switch. Pure rules and storage: TK_prefsLogic.js.
//
// Browser layer (also used by TK_App, TK_keys, TK_QuickAdd, TK_MyTasks and
// TK_SlateBridge, which guard every call with typeof):
//   TK_usePrefs(email)       prefs for this person (sets who "me" is); re-renders
//   TK_prefsGet() / TK_prefsSet(patch)   read / merge-and-save (sends "tk:prefs")
//   TK_prefsQuickKeysOff()   true when this person turned quick keys off
//   window.TK_replaySlateTour  hook for the Replay button (defined in Tour.jsx;
//                            the button is disabled when it is missing).
// Sections: default view (mgb_tk_slate_view_v1, via TK_slateViewKey), Show
// done (mgb_tk_view_v1) and Show older (prefs), window and layout, keyboard
// shortcuts, undo, task notifications (links to the portal's Settings ›
// Notifications; no switches here), help.
// ----------------------------------------------------------------------------

var TK__prefsEmail = "";
var TK__prefsMemo = { raw: "\u0000", val: null };

function TK__prefsStore() {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

function TK_prefsGet() {
  var raw = null;
  try {
    var s = TK__prefsStore();
    raw = s ? s.getItem(TK_prefsKey(TK__prefsEmail)) : null;
  } catch (e) {
    raw = null;
  }
  var memoKey = TK__prefsEmail + "|" + raw;
  if (TK__prefsMemo.raw !== memoKey) TK__prefsMemo = { raw: memoKey, val: TK_prefsRead(TK__prefsStore(), TK__prefsEmail) };
  return TK__prefsMemo.val;
}

function TK_prefsSet(patch) {
  var next = TK_prefsWrite(TK__prefsStore(), TK__prefsEmail, patch);
  TK__prefsMemo = { raw: "\u0000", val: null };
  try {
    window.dispatchEvent(new Event("tk:prefs"));
  } catch (e) {}
  return next;
}

function TK_prefsQuickKeysOff() {
  try {
    return !!TK__prefsEmail && TK_prefsKeysOff(TK_prefsGet());
  } catch (e) {
    return false;
  }
}

function TK__prefsSubscribe(fn) {
  window.addEventListener("tk:prefs", fn);
  window.addEventListener("storage", fn);
  return function () {
    window.removeEventListener("tk:prefs", fn);
    window.removeEventListener("storage", fn);
  };
}

// Non-hook: adopt this email when none is set yet (handlers outside TK_App).
function TK_prefsAdopt(email) {
  if (!TK__prefsEmail) TK__prefsEmail = String(email == null ? "" : email).trim().toLowerCase();
  return TK__prefsEmail;
}

function TK_usePrefs(email) {
  TK__prefsEmail = String(email == null ? "" : email).trim().toLowerCase();
  return React.useSyncExternalStore(TK__prefsSubscribe, TK_prefsGet, TK_prefsGet);
}

// Choice buttons (the Slate chip look), one is on.
function TK__setSeg(props) {
  return (
    <span className="tk-set-seg" role="group" aria-label={props.label}>
      {props.options.map(function (o) {
        var on = props.value === o.value;
        return (
          <button
            key={o.value || "none"}
            type="button"
            className={"tk-filter-chip tk-sv-chip" + (on ? " is-on" : "")}
            aria-pressed={on ? "true" : "false"}
            onClick={function () {
              props.onChange(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

function TK_SlateSettings(props) {
  var staffUser = props.staffUser || {};
  var email = String(staffUser.email || "").trim().toLowerCase();
  var prefs = TK_usePrefs(email);
  var vPair = React.useState(function () {
    var key = TK_slateViewKey(email);
    var legacy = TK_vLsGet(typeof TK_groupByKey === "function" ? TK_groupByKey(email) : "mgb_tk_groupby_v1:" + email, null);
    return TK_slateViewRead(TK_vLsGet(key, null), legacy);
  });
  var view = vPair[0];
  var doneState = React.useState(function () {
    return TK_prefsShowDoneRead(TK__prefsStore());
  });
  var showDone = doneState[0];

  var saveView = function (patch) {
    var n = TK_normalizeSlateView(Object.assign({}, view, patch));
    TK_vLsSet(TK_slateViewKey(email), n);
    if (n.groupBy === "due" || n.groupBy === "client") {
      TK_vLsSet(typeof TK_groupByKey === "function" ? TK_groupByKey(email) : "mgb_tk_groupby_v1:" + email, n.groupBy);
    }
    vPair[1](n);
    try {
      window.dispatchEvent(new Event("tk:prefs"));
    } catch (e) {}
  };
  var isDefault = TK_isDefaultSlateView(view);
  var chips = TK_SLATE_CHIPS.filter(function (c) {
    return !c.rhythm;
  });
  var mac = typeof TK__ixMac === "function" ? TK__ixMac() : false;
  var keyMap = typeof TK_KEYMAP !== "undefined" && Array.isArray(TK_KEYMAP) ? TK_KEYMAP : [];
  var slateKeys = typeof TK_SLATE_KEYS_HELP !== "undefined" && Array.isArray(TK_SLATE_KEYS_HELP) ? TK_SLATE_KEYS_HELP : [];
  var api = typeof TK_api !== "undefined" && TK_api ? TK_api : {};
  var undoDepth = api.UNDO_DEPTH_SLATE || 5;
  var undoMin = Math.round((api.SLATE_UNDO_MS || 9 * 60 * 1000) / 60000);
  var tourFn = typeof window !== "undefined" && typeof window.TK_replaySlateTour === "function" ? window.TK_replaySlateTour : null;
  var cap = function (s) {
    return mac ? s.replace(/^Cmd\+(?=.$)/, "⌘").replace("Cmd", "⌘") : s.replace("Cmd", "Ctrl");
  };
  var sortCol = view.sort ? view.sort.col : "";

  return (
    <div className="tk-view tk-set-page">
      <div className="tk-view-head">
        <h2 className="tk-view-title">Settings</h2>
        <p className="tk-set-sub">Just for you, in this browser.</p>
      </div>
      <div className="tk-set">
        <section className="tk-set-card" aria-labelledby="tk-set-view" data-tour="tk-set-view">
          <h3 id="tk-set-view">Default view</h3>
          <p className="tk-set-sub">How Slate opens. The view bar on your list saves the same choice.</p>
          <div className="tk-set-row">
            <label className="tk-set-label" htmlFor="tk-set-group">
              Group by
            </label>
            <select
              id="tk-set-group"
              className="tk-select"
              value={view.groupBy}
              onChange={function (e) {
                saveView({ groupBy: e.target.value });
              }}
            >
              {TK_SLATE_GROUPS.map(function (g) {
                return (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="tk-set-row">
            <label className="tk-set-label" htmlFor="tk-set-sort">
              Sort
            </label>
            <select
              id="tk-set-sort"
              className="tk-select"
              value={sortCol}
              onChange={function (e) {
                saveView({ sort: e.target.value ? { col: e.target.value, dir: view.sort ? view.sort.dir : "asc" } : null });
              }}
            >
              <option value="">Default order</option>
              {TK_SLATE_SORTS.map(function (s) {
                return (
                  <option key={s.col} value={s.col}>
                    {s.label}
                  </option>
                );
              })}
            </select>
            {view.sort ? (
              <TK__setSeg
                label="Sort direction"
                value={view.sort.dir}
                options={[
                  { value: "asc", label: "Ascending" },
                  { value: "desc", label: "Descending" },
                ]}
                onChange={function (d) {
                  saveView({ sort: { col: view.sort.col, dir: d } });
                }}
              />
            ) : null}
          </div>
          <div className="tk-set-row">
            <span className="tk-set-label">Quick view</span>
            <TK__setSeg
              label="Quick view"
              value={view.chip}
              options={[{ value: "", label: "None" }].concat(
                chips.map(function (c) {
                  return { value: c.key, label: c.label };
                }),
              )}
              onChange={function (c) {
                saveView({ chip: c });
              }}
            />
          </div>
          <div className="tk-set-row">
            <TK_vSwitch
              label="Show done"
              checked={showDone}
              onChange={function (v) {
                TK_prefsShowDoneWrite(TK__prefsStore(), v);
                doneState[1](v);
              }}
            />
            <TK_vSwitch
              label="Show older done"
              checked={prefs.showOlder}
              onChange={function (v) {
                TK_prefsSet({ showOlder: v });
              }}
            />
          </div>
          <div className="tk-set-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={isDefault}
              onClick={function () {
                saveView({ groupBy: "due", sort: null, chip: "" });
              }}
            >
              Reset to default
            </button>
          </div>
        </section>

        <section className="tk-set-card" aria-labelledby="tk-set-layout" data-tour="tk-set-layout">
          <h3 id="tk-set-layout">Window and layout</h3>
          <div className="tk-set-row">
            <span className="tk-set-label">Open Slate in</span>
            <TK__setSeg
              label="Open Slate in"
              value={prefs.openIn}
              options={[
                { value: "window", label: "Its own window" },
                { value: "desk", label: "The Desk panel" },
              ]}
              onChange={function (v) {
                TK_prefsSet({ openIn: v });
              }}
            />
          </div>
          <p className="tk-set-sub">Used by Open Slate app in the portal. If the Desk is off for you, the window opens.</p>
          <div className="tk-set-row">
            <span className="tk-set-label">Row density</span>
            <TK__setSeg
              label="Row density"
              value={prefs.density}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
              onChange={function (v) {
                TK_prefsSet({ density: v });
              }}
            />
          </div>
        </section>

        <section className="tk-set-card" aria-labelledby="tk-set-keys" data-tour="tk-set-keys">
          <h3 id="tk-set-keys">Keyboard shortcuts</h3>
          <div className="tk-set-row">
            <TK_vSwitch
              label="Quick keys on"
              checked={!TK_prefsKeysOff(prefs)}
              onChange={function (v) {
                TK_prefsSet({ quickKeys: v });
              }}
            />
          </div>
          <p className="tk-set-sub">Off turns off the single-letter keys. Ctrl/Cmd+Z undo stays on.</p>
          <ul className="tk-set-keys">
            <li>
              <kbd className="tk-kbd">{mac ? "⌘" : "Ctrl"}+Z</kbd> Undo your last action
            </li>
            {keyMap.map(function (k) {
              return (
                <li key={k.key}>
                  <kbd className="tk-kbd">{k.display || k.key}</kbd> {k.label}
                </li>
              );
            })}
            {slateKeys.map(function (k) {
              return (
                <li key={k[0]}>
                  <kbd className="tk-kbd">{cap(k[0])}</kbd> {k[1]}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="tk-set-card" aria-labelledby="tk-set-undo" data-tour="tk-set-undo">
          <h3 id="tk-set-undo">Undo</h3>
          <p className="tk-set-sub" style={{ margin: 0 }}>
            {"Slate keeps your last " + undoDepth + " actions for up to " + undoMin + " minutes each. This is the same for everyone."}
          </p>
        </section>

        <section className="tk-set-card" aria-labelledby="tk-set-notify" data-tour="tk-set-notify">
          <h3 id="tk-set-notify">Task notifications</h3>
          <p className="tk-set-sub">The switches live in the portal, under Settings &rsaquo; Notifications.</p>
          <table className="tk-set-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Email</th>
                <th scope="col">Bell</th>
              </tr>
            </thead>
            <tbody>
              {TK_PREFS_NOTIFY.map(function (n) {
                return (
                  <tr key={n.email}>
                    <th scope="row">{n.label}</th>
                    <td>Switch</td>
                    <td>{n.bell ? "Switch" : "No switch"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="tk-set-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={function () {
                TK_slateForwardHash("#/settings?tab=notifications");
              }}
            >
              Open Notifications in the portal
            </button>
          </div>
        </section>

        <section className="tk-set-card" aria-labelledby="tk-set-help" data-tour="tk-set-help">
          <h3 id="tk-set-help">Help</h3>
          <div className="tk-set-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={!tourFn}
              onClick={function () {
                if (tourFn) tourFn();
              }}
            >
              Replay the Slate tour
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={function () {
                TK_slateForwardHash("#/help/my-tasks");
              }}
            >
              Open the staff guide
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
