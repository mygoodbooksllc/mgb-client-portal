// ----------------------------------------------------------------------------
// TK_ProfileEdit.jsx: Slate plus Profile 2 pieces for the person profile
// (TK_Profile.jsx) and the admin Teams card on Team › People.
// Spec: docs/slateplus-profile2-spec.md §4, §12.1-12.3.
//
// Hidden: every component here renders only inside the profile route (which
// TK_App mounts only while TKP_on() is true) or behind TKP_useOn() on Team ›
// People. TKP_on() is false in View as, so View as never reaches any of this.
//
// Data:
//   - tk_profile_card(p_email) for everyone (own row in full; anyone else only
//     what they share, filtered by the server to what the viewer can access).
//   - own edits: one upsert to tk_staff_profile_prefs (TK_api.profilePrefs).
//     Edit controls render only on your own profile and never in View as.
//   - teams: TK_api.teamsList (one cached read); writes admins only.
//   - time off and backups reuse CV_MyTimeOffBody, CV_StaffSelect and
//     staffToolsApi.saveProfile (no new storage).
// No photo upload. No pronouns. Time zone is never guessed from the browser.
// ----------------------------------------------------------------------------

var TKP2_TEAM_COLORS = [
  { id: "gold", label: "Gold" },
  { id: "sage", label: "Sage" },
  { id: "sky", label: "Sky" },
  { id: "plum", label: "Plum" },
  { id: "rose", label: "Rose" },
  { id: "slate", label: "Slate" },
];

function TKP2__ro() {
  try {
    return typeof MGB_viewAsReadOnly === "function" && MGB_viewAsReadOnly() === true;
  } catch (e) {
    return true;
  }
}

function TKP2__lower(s) {
  return String(s || "").trim().toLowerCase();
}

function TKP2__nameOf(dir, email) {
  var e = TKP2__lower(email);
  for (var i = 0; i < (dir || []).length; i++) if (dir[i] && dir[i].email === e) return dir[i].name || e.split("@")[0];
  return e ? e.split("@")[0] : "";
}

function TKP2_errText(err) {
  var code = err && err.code ? String(err.code) : "";
  var msg = err && err.message ? String(err.message) : "";
  if ((code === "22023" || (err && err.pgCode === "22023")) && msg) return msg;
  if (code === "tk_name_taken") return "A team with that name already exists.";
  if (code === "tk_already_member") return "That person is already on this team.";
  if (code === "tk_forbidden") return "Only admins can change teams.";
  return typeof TK_vErrText === "function" ? TK_vErrText(err) : "Couldn't save that change. Try again.";
}

function TKP2__toast(text) {
  if (typeof TK_vToast === "function") TK_vToast(text);
}

function TKP2__fmtDate(iso) {
  if (!iso) return "";
  try {
    return typeof fmtDate === "function" ? fmtDate(String(iso).slice(0, 10)) : String(iso).slice(0, 10);
  } catch (e) {
    return String(iso).slice(0, 10);
  }
}

// ---- Clock: one interval while the page is visible -------------------------

function TKP2_useMinute() {
  var pair = React.useState(Date.now());
  var setNow = pair[1];
  React.useEffect(function () {
    var id = null;
    var start = function () {
      if (id) return;
      setNow(Date.now());
      id = setInterval(function () {
        setNow(Date.now());
      }, 60000);
    };
    var stop = function () {
      if (id) clearInterval(id);
      id = null;
    };
    var onVis = function () {
      if (document.hidden) stop();
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return function () {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return pair[0];
}

// ---- The viewer's own zone (for "1 hour behind you") -----------------------

var TKP2__mine = { email: "", zone: null, loaded: false, promise: null };

function TKP2_setMyZone(email, zone) {
  TKP2__mine = { email: TKP2__lower(email), zone: zone || null, loaded: true, promise: null };
  try {
    window.dispatchEvent(new CustomEvent("tkp2:myzone"));
  } catch (e) {}
}

function TKP2_useMyZone(me) {
  var e = TKP2__lower(me);
  var pair = React.useState(TKP2__mine.email === e && TKP2__mine.loaded ? TKP2__mine.zone : null);
  var set = pair[1];
  React.useEffect(
    function () {
      var live = true;
      var sync = function () {
        if (live && TKP2__mine.email === e) set(TKP2__mine.zone);
      };
      window.addEventListener("tkp2:myzone", sync);
      if (e && !(TKP2__mine.email === e && TKP2__mine.loaded) && typeof TK_api !== "undefined" && TK_api.profilePrefs) {
        if (!(TKP2__mine.email === e && TKP2__mine.promise)) {
          TKP2__mine = { email: e, zone: null, loaded: false, promise: null };
          TKP2__mine.promise = TK_api.profilePrefs.get().then(
            function (row) {
              TKP2_setMyZone(e, row && row.time_zone);
            },
            function () {
              TKP2_setMyZone(e, null);
            },
          );
        }
      } else sync();
      return function () {
        live = false;
        window.removeEventListener("tkp2:myzone", sync);
      };
    },
    [e],
  );
  return pair[0];
}

// ---- Teams (shared cached read) --------------------------------------------

function TKP2_useTeams(enabled, bump) {
  var pair = React.useState(null);
  var set = pair[1];
  React.useEffect(
    function () {
      var live = true;
      if (!enabled || typeof TK_api === "undefined" || typeof TK_api.teamsList !== "function") return undefined;
      TK_api.teamsList(!!bump).then(
        function (rows) {
          if (live) set(Array.isArray(rows) ? rows : []);
        },
        function () {
          if (live) set([]);
        },
      );
      return function () {
        live = false;
      };
    },
    [enabled, bump],
  );
  return pair[0];
}

// ---- The card + saving ------------------------------------------------------

// Resolves { loading, failed, card, raw, canEdit, save(patch, okText) }.
// save validates first (TKP2_validate), updates the page at once, then
// upserts; on error it puts the old values back and shows a toast.
function TKP2_useCard(email, self) {
  var pair = React.useState({ loading: true, failed: false, raw: null });
  var st = pair[0];
  var set = pair[1];
  var rawRef = React.useRef(null);
  React.useEffect(
    function () {
      var live = true;
      rawRef.current = null;
      set({ loading: true, failed: false, raw: null });
      if (typeof TK_api === "undefined" || typeof TK_api.profileCard !== "function") {
        set({ loading: false, failed: true, raw: null });
        return undefined;
      }
      TK_api.profileCard(email).then(
        function (j) {
          if (!live) return;
          rawRef.current = j;
          set({ loading: false, failed: !j, raw: j });
          if (self && j) TKP2_setMyZone(email, j.time_zone);
        },
        function () {
          if (live) set({ loading: false, failed: true, raw: null });
        },
      );
      return function () {
        live = false;
      };
    },
    [email, self],
  );
  var canEdit = !!self && !st.loading && !st.failed && !TKP2__ro();
  var save = function (patch, okText) {
    if (!canEdit) return Promise.resolve(false);
    var problem = TKP2_validate(patch);
    if (problem) {
      TKP2__toast(problem);
      return Promise.resolve(false);
    }
    var before = rawRef.current;
    var merged = Object.assign({}, before || {}, patch);
    if (patch.share) merged.share = Object.assign({}, TKP2_shareOf(before && before.share), patch.share);
    rawRef.current = merged;
    set({ loading: false, failed: false, raw: merged });
    return TK_api.profilePrefs.save(patch).then(
      function (row) {
        var cur = rawRef.current || {};
        var next = Object.assign({}, cur, row || {}, { email: email, is_self: true, has_row: true, org: cur.org, teams: cur.teams });
        rawRef.current = next;
        set({ loading: false, failed: false, raw: next });
        if (Object.prototype.hasOwnProperty.call(patch, "time_zone")) TKP2_setMyZone(email, next.time_zone);
        // The Slate plus icon rail reloads my pins (TK_SlateRail.jsx).
        if (Object.prototype.hasOwnProperty.call(patch, "pinned_client_ids") || Object.prototype.hasOwnProperty.call(patch, "pinned_project_ids")) {
          try {
            window.dispatchEvent(new Event("tkp2:pins"));
          } catch (e) {}
        }
        if (okText) TKP2__toast(okText);
        return true;
      },
      function (err) {
        rawRef.current = before;
        set({ loading: false, failed: false, raw: before });
        TKP2__toast(TKP2_errText(err));
        return false;
      },
    );
  };
  return { loading: st.loading, failed: st.failed, raw: st.raw, card: TKP2_normalize(st.raw), canEdit: canEdit, save: save };
}

// ---- Small shared bits ------------------------------------------------------

function TKP2_ShareSelect(props) {
  var share = props.card.share || {};
  var id = "tkp2-share-" + props.k;
  return (
    <span className="tkp2-share">
      <label htmlFor={id}>Visible to</label>
      <select
        id={id}
        value={share[props.k] ? "all" : "me"}
        onChange={function (e) {
          var patch = { share: {} };
          patch.share[props.k] = e.target.value === "all";
          props.save(patch, "Saved.");
        }}
      >
        <option value="me">Only me</option>
        <option value="all">All staff</option>
      </select>
    </span>
  );
}

// Card head: title plus (own profile only) the share select and an action.
function TKP2_Head(props) {
  return (
    <div className="tkp2-head">
      <h3 className="card-title" id={props.id}>
        {props.title}
      </h3>
      {props.canEdit && props.shareKey ? <TKP2_ShareSelect card={props.card} k={props.shareKey} save={props.save} /> : null}
      {props.action || null}
    </div>
  );
}

function TKP2_Counter(props) {
  var n = String(props.value || "").length;
  return (
    <span className={"tkp2-counter" + (n > props.max ? " is-over" : "")} aria-live="polite">
      {n}/{props.max}
    </span>
  );
}

function TKP2_MoveButtons(props) {
  return (
    <span className="tkp2-move">
      <button type="button" className="tkp2-icon-btn" aria-label={"Move " + props.label + " up"} disabled={props.first} onClick={props.onUp}>
        <span aria-hidden="true">↑</span>
      </button>
      <button type="button" className="tkp2-icon-btn" aria-label={"Move " + props.label + " down"} disabled={props.last} onClick={props.onDown}>
        <span aria-hidden="true">↓</span>
      </button>
      {props.onRemove ? (
        <button type="button" className="tkp2-icon-btn" aria-label={"Remove " + props.label} onClick={props.onRemove}>
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </span>
  );
}

function TKP2__swap(list, i, delta) {
  var out = list.slice();
  var j = i + delta;
  if (i < 0 || j < 0 || j >= out.length) return out;
  var t = out[i];
  out[i] = out[j];
  out[j] = t;
  return out;
}

// ---- Header: status, local time, team chips --------------------------------

var TKP2__zones = null;
function TKP2__zoneOptions() {
  if (!TKP2__zones) TKP2__zones = TKP2_zoneList();
  return TKP2__zones;
}

function TKP2_StatusLine(props) {
  var card = props.card;
  var canEdit = props.canEdit;
  var ep = React.useState(false);
  var editing = ep[0];
  var setEditing = ep[1];
  var vp = React.useState("");
  var draft = vp[0];
  var setDraft = vp[1];
  var inputRef = React.useRef(null);
  React.useEffect(
    function () {
      if (editing && inputRef.current) inputRef.current.focus();
    },
    [editing],
  );
  var open = function () {
    setDraft(card.status_line || "");
    setEditing(true);
  };
  var commit = function (value) {
    var v = String(value || "").trim();
    props.save({ status_line: v || null }, v ? "Status saved." : "Status cleared.").then(function (ok) {
      if (ok) setEditing(false);
    });
  };
  if (editing && canEdit) {
    return (
      <form
        className="tkp2-form tkp2-status-form"
        onSubmit={function (e) {
          e.preventDefault();
          commit(draft);
        }}
      >
        <label className="tk-sr" htmlFor="tkp2-status-input">
          Status
        </label>
        <input
          id="tkp2-status-input"
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={TKP2_LIMITS.status}
          placeholder="What are you working on?"
          onChange={function (e) {
            setDraft(e.target.value);
          }}
          onKeyDown={function (e) {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
            }
          }}
        />
        <TKP2_Counter value={draft} max={TKP2_LIMITS.status} />
        <div className="tkp2-actions">
          <button type="submit" className="btn-primary">
            Save
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={function () {
              setEditing(false);
            }}
          >
            Cancel
          </button>
          {card.status_line ? (
            <button
              type="button"
              className="link-btn"
              onClick={function () {
                commit("");
              }}
            >
              Clear
            </button>
          ) : null}
          <TKP2_ShareSelect card={card} k="status" save={props.save} />
        </div>
      </form>
    );
  }
  if (!card.status_line) {
    return canEdit ? (
      <p className="tkp-line tkp2-status">
        <button type="button" className="link-btn" onClick={open}>
          Set a status
        </button>
      </p>
    ) : null;
  }
  return (
    <p className="tkp-line tkp2-status">
      <span className="tkp2-status-text">{card.status_line}</span>
      {card.status_set_at ? <span className="tkp-muted"> · Updated {TKP2__fmtDate(card.status_set_at)}</span> : null}
      {canEdit ? (
        <>
          {" "}
          <button type="button" className="link-btn" onClick={open} aria-label="Edit your status">
            Edit
          </button>
        </>
      ) : null}
    </p>
  );
}

function TKP2_TimeLine(props) {
  var card = props.card;
  var self = props.self;
  var canEdit = props.canEdit;
  var now = props.now;
  var ep = React.useState(false);
  var editing = ep[0];
  var setEditing = ep[1];
  var zp = React.useState("");
  var pick = zp[0];
  var setPick = zp[1];
  var selRef = React.useRef(null);
  React.useEffect(
    function () {
      if (editing && selRef.current) selRef.current.focus();
    },
    [editing],
  );
  var zone = card.time_zone && TKP2_zoneOk(card.time_zone) ? card.time_zone : null;
  if (editing && canEdit) {
    var opts = TKP2__zoneOptions();
    return (
      <form
        className="tkp2-form tkp2-zone-form"
        onSubmit={function (e) {
          e.preventDefault();
          if (!pick) {
            TKP2__toast("Pick a time zone from the list.");
            return;
          }
          props.save({ time_zone: pick }, "Time zone saved.").then(function (ok) {
            if (ok) setEditing(false);
          });
        }}
      >
        <label htmlFor="tkp2-zone">Your time zone</label>
        <select
          id="tkp2-zone"
          ref={selRef}
          value={pick}
          onChange={function (e) {
            setPick(e.target.value);
          }}
          onKeyDown={function (e) {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
            }
          }}
        >
          <option value="">Pick a time zone</option>
          <optgroup label="Common (US)">
            {opts.common.map(function (z) {
              return (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              );
            })}
          </optgroup>
          {opts.other.length ? (
            <optgroup label="Other…">
              {opts.other.map(function (z) {
                return (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                );
              })}
            </optgroup>
          ) : null}
        </select>
        <div className="tkp2-actions">
          <button type="submit" className="btn-primary">
            Save
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={function () {
              setEditing(false);
            }}
          >
            Cancel
          </button>
          {zone ? (
            <button
              type="button"
              className="link-btn"
              onClick={function () {
                props.save({ time_zone: null }, "Time zone cleared.").then(function (ok) {
                  if (ok) setEditing(false);
                });
              }}
            >
              Clear
            </button>
          ) : null}
          <TKP2_ShareSelect card={card} k="time" save={props.save} />
        </div>
      </form>
    );
  }
  var open = function () {
    setPick(zone || "");
    setEditing(true);
  };
  if (self) {
    if (zone) {
      return (
        <p className="tkp-line tkp2-time">
          <span>{TKP2_localTimeLine(now, zone)}</span>
          {canEdit ? (
            <>
              {" "}
              <button type="button" className="link-btn" onClick={open} aria-label="Change your time zone">
                Change
              </button>
            </>
          ) : null}
        </p>
      );
    }
    return (
      <p className="tkp-line tkp2-time tkp-muted">
        <span>
          {TKP2_localTime(now, TKP2_FIRM_ZONE)}. Time zone not set. Showing firm time ({TKP2_zoneLabel(TKP2_FIRM_ZONE)}).
        </span>
        {canEdit ? (
          <>
            {" "}
            <button type="button" className="link-btn" onClick={open}>
              Set time zone
            </button>
          </>
        ) : null}
      </p>
    );
  }
  if (!zone) return null;
  var diff = TKP2_offsetText(zone, props.myZone, now);
  return (
    <p className="tkp-line tkp2-time">
      <span>{TKP2_localTimeLine(now, zone)}</span>
      {diff ? <span className="tkp-muted"> ({diff})</span> : null}
    </p>
  );
}

function TKP2__teamMembersTitle(team, teamsList, dir) {
  var full = (teamsList || []).filter(function (t) {
    return t && t.id === team.id;
  })[0];
  if (!full || !full.members || !full.members.length) return team.name;
  return (
    team.name +
    ": " +
    full.members
      .map(function (e) {
        return TKP2__nameOf(dir, e);
      })
      .join(", ")
  );
}

function TKP2_TeamChip(props) {
  var t = props.team;
  var color = TKP2_TEAM_COLORS.some(function (c) {
    return c.id === t.color;
  })
    ? t.color
    : "slate";
  return (
    <span className={"tkp2-team tkp2-team-" + color} title={TKP2__teamMembersTitle(t, props.teamsList, props.dir)}>
      <span className="tkp2-team-dot" aria-hidden="true" />
      {t.name}
    </span>
  );
}

function TKP2_TeamChips(props) {
  var teams = props.card.teams || [];
  if (!teams.length) return null;
  var shown = teams.slice(0, 3);
  var more = teams.length - shown.length;
  return (
    <div className="tkp2-teams" aria-label="Teams">
      {shown.map(function (t) {
        return <TKP2_TeamChip key={t.id} team={t} teamsList={props.teamsList} dir={props.dir} />;
      })}
      {more > 0 ? (
        <span
          className="tkp2-team tkp2-team-more"
          title={teams
            .slice(3)
            .map(function (t) {
              return t.name;
            })
            .join(", ")}
        >
          +{more}
        </span>
      ) : null}
    </div>
  );
}

// Everything new in the header, under the role line.
function TKP2_HeaderExtras(props) {
  return (
    <div className="tkp2-header-extras">
      <TKP2_StatusLine card={props.card} canEdit={props.canEdit} save={props.save} />
      <TKP2_TimeLine card={props.card} self={props.self} canEdit={props.canEdit} save={props.save} now={props.now} myZone={props.myZone} />
      <TKP2_TeamChips card={props.card} teamsList={props.teamsList} dir={props.dir} />
    </div>
  );
}

// ---- Pinned -----------------------------------------------------------------

function TKP2__go(e, route) {
  if (typeof TK_vPlainClick === "function" && !TK_vPlainClick(e)) return;
  e.preventDefault();
  TK_navigate(route);
}

function TKP2_PinsSection(props) {
  var card = props.card;
  var canEdit = props.canEdit;
  var clients = props.clients || [];
  var projects = props.projects || [];
  var ep = React.useState(false);
  var editing = ep[0];
  var setEditing = ep[1];
  var cName = {};
  clients.forEach(function (c) {
    if (c && c.id != null) cName[String(c.id)] = c.name || "Client";
  });
  var pName = {};
  projects.forEach(function (p) {
    if (p && p.id && !p.deleted_at) pName[p.id] = p.name || "Project";
  });
  var cIds = (card.pinned_client_ids || []).map(String);
  var pIds = (card.pinned_project_ids || []).map(String);
  // Pins the viewer can no longer see are hidden, never deleted.
  var cVis = cIds.filter(function (id) {
    return cName[id] != null;
  });
  var pVis = pIds.filter(function (id) {
    return pName[id] != null;
  });
  if (!canEdit && !cVis.length && !pVis.length) return null;
  var saveClients = function (ids) {
    props.save({ pinned_client_ids: ids }, "Pins saved.");
  };
  var saveProjects = function (ids) {
    props.save({ pinned_project_ids: ids }, "Pins saved.");
  };
  var chips = (
    <ul className="tkp2-chips">
      {cVis.map(function (id) {
        return (
          <li key={"c" + id}>
            <a
              className="tkp2-chip"
              href={TK_formatRoute({ view: "client", clientId: id })}
              onClick={function (e) {
                TKP2__go(e, { view: "client", clientId: id });
              }}
            >
              {cName[id]}
              <span className="tkp-muted"> · client</span>
            </a>
          </li>
        );
      })}
      {pVis.map(function (id) {
        return (
          <li key={"p" + id}>
            <a
              className="tkp2-chip"
              href={TK_formatRoute({ view: "project", projectId: id })}
              onClick={function (e) {
                TKP2__go(e, { view: "project", projectId: id });
              }}
            >
              {pName[id]}
              <span className="tkp-muted"> · project</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
  var editor = null;
  if (canEdit && editing) {
    var freeClients = clients
      .filter(function (c) {
        return c && c.id != null && cIds.indexOf(String(c.id)) === -1;
      })
      .slice()
      .sort(function (a, b) {
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
    var freeProjects = projects
      .filter(function (p) {
        return p && p.id && !p.deleted_at && pIds.indexOf(String(p.id)) === -1;
      })
      .slice()
      .sort(function (a, b) {
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
    var row = function (id, label, list, i, saver) {
      return (
        <li key={id} className="tkp2-edit-row">
          <span className="tkp2-edit-label">{label}</span>
          <TKP2_MoveButtons
            label={label}
            first={i === 0}
            last={i === list.length - 1}
            onUp={function () {
              saver(TKP2__swap(list, i, -1));
            }}
            onDown={function () {
              saver(TKP2__swap(list, i, 1));
            }}
            onRemove={function () {
              saver(
                list.filter(function (x) {
                  return x !== id;
                }),
              );
            }}
          />
        </li>
      );
    };
    editor = (
      <div className="tkp2-editor">
        {cVis.length ? (
          <ul className="tkp2-edit-list" aria-label="Pinned clients">
            {cIds.map(function (id, i) {
              return cName[id] != null ? row(id, cName[id], cIds, i, saveClients) : null;
            })}
          </ul>
        ) : null}
        {pVis.length ? (
          <ul className="tkp2-edit-list" aria-label="Pinned projects">
            {pIds.map(function (id, i) {
              return pName[id] != null ? row(id, pName[id], pIds, i, saveProjects) : null;
            })}
          </ul>
        ) : null}
        <div className="tkp2-add-row">
          <label htmlFor="tkp2-pin-client">Pin a client</label>
          <select
            id="tkp2-pin-client"
            value=""
            disabled={cIds.length >= TKP2_LIMITS.pins}
            onChange={function (e) {
              if (e.target.value) saveClients(cIds.concat([e.target.value]));
            }}
          >
            <option value="">{cIds.length >= TKP2_LIMITS.pins ? "12 pinned (most allowed)" : "Pick a client"}</option>
            {freeClients.map(function (c) {
              return (
                <option key={c.id} value={String(c.id)}>
                  {c.name || c.id}
                </option>
              );
            })}
          </select>
        </div>
        <div className="tkp2-add-row">
          <label htmlFor="tkp2-pin-project">Pin a project</label>
          <select
            id="tkp2-pin-project"
            value=""
            disabled={pIds.length >= TKP2_LIMITS.pins}
            onChange={function (e) {
              if (e.target.value) saveProjects(pIds.concat([e.target.value]));
            }}
          >
            <option value="">{pIds.length >= TKP2_LIMITS.pins ? "12 pinned (most allowed)" : "Pick a project"}</option>
            {freeProjects.map(function (p) {
              return (
                <option key={p.id} value={p.id}>
                  {p.name || "Project"}
                </option>
              );
            })}
          </select>
        </div>
      </div>
    );
  }
  return (
    <section className="card tkp-card tkp2-pins" aria-labelledby="tkp2-pins-title" data-section="pins">
      <TKP2_Head
        id="tkp2-pins-title"
        title="Pinned"
        card={card}
        canEdit={canEdit}
        shareKey="pins"
        save={props.save}
        action={
          canEdit ? (
            <button
              type="button"
              className="link-btn"
              aria-expanded={editing}
              onClick={function () {
                setEditing(!editing);
              }}
            >
              {editing ? "Done" : "Edit pins"}
            </button>
          ) : null
        }
      />
      {cVis.length || pVis.length ? chips : canEdit ? <p className="card-subtitle">Pin the clients and projects you open most.</p> : null}
      {editor}
    </section>
  );
}

// ---- Focus this quarter -----------------------------------------------------

function TKP2_FocusSection(props) {
  var card = props.card;
  var canEdit = props.canEdit;
  var nowQ = TKP2_quarterOf(props.now);
  var stored = card.focus_quarter;
  var old = TKP2_quarterIsOld(stored, props.now);
  var goals = card.focus_goals || [];
  var ep = React.useState(false);
  var editing = ep[0];
  var setEditing = ep[1];
  var dp = React.useState(["", "", ""]);
  var drafts = dp[0];
  var setDrafts = dp[1];
  if (!canEdit && !goals.length) return null;
  var quarter = stored && !old ? stored : nowQ;
  var open = function () {
    var d = goals.map(function (g) {
      return g.text;
    });
    while (d.length < TKP2_LIMITS.goals) d.push("");
    setDrafts(d.slice(0, TKP2_LIMITS.goals));
    setEditing(true);
  };
  var saveGoals = function (list, text) {
    return props.save({ focus_goals: list, focus_quarter: quarter }, text);
  };
  return (
    <section className="card tkp-card tkp2-focus" aria-labelledby="tkp2-focus-title" data-section="focus">
      <TKP2_Head
        id="tkp2-focus-title"
        title={"Focus this quarter" + (TKP2_quarterLabel(old ? nowQ : quarter) ? " · " + TKP2_quarterLabel(old ? nowQ : quarter) : "")}
        card={card}
        canEdit={canEdit}
        shareKey="focus"
        save={props.save}
        action={
          canEdit && !editing && !old ? (
            <button type="button" className="link-btn" onClick={open}>
              {goals.length ? "Edit goals" : "Add goals"}
            </button>
          ) : null
        }
      />
      {old && goals.length ? <p className="tkp-line tkp-muted">From {TKP2_quarterLabel(stored)}</p> : null}
      {old && canEdit ? (
        <p className="tkp-line">
          <button
            type="button"
            className="btn-secondary"
            onClick={function () {
              props.save({ focus_goals: [], focus_quarter: nowQ }, "New quarter started.");
            }}
          >
            Start this quarter's goals
          </button>
        </p>
      ) : null}
      {editing && canEdit ? (
        <form
          className="tkp2-form"
          onSubmit={function (e) {
            e.preventDefault();
            var keep = drafts
              .map(function (t, i) {
                var prev = goals[i];
                return { text: String(t || "").trim(), done: !!(prev && prev.text === String(t || "").trim() && prev.done) };
              })
              .filter(function (g) {
                return g.text;
              });
            saveGoals(keep, "Goals saved.").then(function (ok) {
              if (ok) setEditing(false);
            });
          }}
        >
          {drafts.map(function (t, i) {
            var id = "tkp2-goal-" + i;
            return (
              <div className="tkp2-field" key={i}>
                <label htmlFor={id}>Goal {i + 1}</label>
                <input
                  id={id}
                  type="text"
                  value={t}
                  maxLength={TKP2_LIMITS.goal}
                  onChange={function (e) {
                    var next = drafts.slice();
                    next[i] = e.target.value;
                    setDrafts(next);
                  }}
                />
              </div>
            );
          })}
          <div className="tkp2-actions">
            <button type="submit" className="btn-primary">
              Save
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={function () {
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : goals.length && !(old && canEdit) ? (
        <ul className="tkp2-goals">
          {goals.map(function (g, i) {
            var id = "tkp2-goal-done-" + i;
            return (
              <li key={i} className={g.done ? "is-done" : ""}>
                {canEdit ? (
                  <>
                    <input
                      id={id}
                      type="checkbox"
                      checked={!!g.done}
                      onChange={function () {
                        var next = goals.map(function (x, j) {
                          return j === i ? { text: x.text, done: !x.done } : x;
                        });
                        saveGoals(next);
                      }}
                    />
                    <label htmlFor={id}>{g.text}</label>
                  </>
                ) : (
                  <span>
                    {g.text}
                    {g.done ? <span className="tkp-muted"> · done</span> : null}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : canEdit && !old ? (
        <p className="card-subtitle">Up to three things you want to focus on this quarter.</p>
      ) : null}
    </section>
  );
}

// ---- About me ---------------------------------------------------------------

function TKP2_AboutSection(props) {
  var card = props.card;
  var canEdit = props.canEdit;
  var skills = card.skills || [];
  var ep = React.useState(false);
  var editing = ep[0];
  var setEditing = ep[1];
  var dp = React.useState({ bio: "", skills: [], hours: "", skill: "" });
  var d = dp[0];
  var setD = dp[1];
  var has = !!(card.bio || skills.length || card.working_hours);
  if (!canEdit && !has) return null;
  var open = function () {
    setD({ bio: card.bio || "", skills: skills.slice(), hours: card.working_hours || "", skill: "" });
    setEditing(true);
  };
  var addSkill = function () {
    var v = String(d.skill || "").trim();
    if (!v) return;
    if (v.length > TKP2_LIMITS.skill) {
      TKP2__toast("A skill is at most 40 characters.");
      return;
    }
    var next = TKP2_cleanSkills(d.skills.concat([v]));
    if (next.length > TKP2_LIMITS.skills) {
      TKP2__toast("At most 12 skills.");
      return;
    }
    setD(Object.assign({}, d, { skills: next, skill: "" }));
  };
  return (
    <section className="card tkp-card tkp2-about" aria-labelledby="tkp2-about-title" data-section="about">
      <TKP2_Head
        id="tkp2-about-title"
        title="About me"
        card={card}
        canEdit={canEdit}
        shareKey="about"
        save={props.save}
        action={
          canEdit && !editing ? (
            <button type="button" className="link-btn" onClick={open}>
              Edit
            </button>
          ) : null
        }
      />
      {editing && canEdit ? (
        <form
          className="tkp2-form"
          onSubmit={function (e) {
            e.preventDefault();
            props
              .save({ bio: String(d.bio || "").trim() || null, skills: TKP2_cleanSkills(d.skills), working_hours: String(d.hours || "").trim() || null }, "About me saved.")
              .then(function (ok) {
                if (ok) setEditing(false);
              });
          }}
        >
          <div className="tkp2-field">
            <label htmlFor="tkp2-bio">About me</label>
            <textarea
              id="tkp2-bio"
              rows={4}
              value={d.bio}
              maxLength={TKP2_LIMITS.bio}
              onChange={function (e) {
                setD(Object.assign({}, d, { bio: e.target.value }));
              }}
            />
            <TKP2_Counter value={d.bio} max={TKP2_LIMITS.bio} />
          </div>
          <div className="tkp2-field">
            <label htmlFor="tkp2-skill">Skills and areas</label>
            {d.skills.length ? (
              <ul className="tkp2-chips tkp2-skill-edit">
                {d.skills.map(function (s) {
                  return (
                    <li key={s}>
                      <span className="tkp2-chip">
                        {s}
                        <button
                          type="button"
                          className="tkp2-chip-x"
                          aria-label={"Remove " + s}
                          onClick={function () {
                            setD(
                              Object.assign({}, d, {
                                skills: d.skills.filter(function (x) {
                                  return x !== s;
                                }),
                              }),
                            );
                          }}
                        >
                          ×
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="tkp2-inline">
              <input
                id="tkp2-skill"
                type="text"
                value={d.skill}
                maxLength={TKP2_LIMITS.skill}
                placeholder="Type a skill and press Enter"
                disabled={d.skills.length >= TKP2_LIMITS.skills}
                onChange={function (e) {
                  setD(Object.assign({}, d, { skill: e.target.value }));
                }}
                onKeyDown={function (e) {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSkill();
                  }
                }}
              />
              <button type="button" className="btn-secondary" onClick={addSkill} disabled={d.skills.length >= TKP2_LIMITS.skills}>
                Add
              </button>
            </div>
          </div>
          <div className="tkp2-field">
            <label htmlFor="tkp2-hours">Working hours</label>
            <input
              id="tkp2-hours"
              type="text"
              value={d.hours}
              maxLength={TKP2_LIMITS.hours}
              placeholder="For example: Mon to Thu, 8 to 4"
              onChange={function (e) {
                setD(Object.assign({}, d, { hours: e.target.value }));
              }}
            />
          </div>
          <div className="tkp2-actions">
            <button type="submit" className="btn-primary">
              Save
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={function () {
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : has ? (
        <div className="tkp2-about-body">
          {card.bio ? <p className="tkp2-bio">{card.bio}</p> : null}
          {skills.length ? (
            <ul className="tkp2-chips" aria-label="Skills and areas">
              {skills.map(function (s) {
                return (
                  <li key={s}>
                    <span className="tkp2-chip">{s}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {card.working_hours ? (
            <p className="tkp-line">
              <span className="tkp-muted">Working hours: </span>
              {card.working_hours}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="card-subtitle">A few lines about you, your skills and your working hours.</p>
      )}
    </section>
  );
}

// ---- Favorites (SOPs and https links) --------------------------------------

function TKP2__sopHref(clientId) {
  return typeof TB_clientHash === "function" ? TB_clientHash(clientId, "sop") : "#/client/" + encodeURIComponent(clientId) + "/sop";
}

function TKP2_AddSop(props) {
  var clients = (props.clients || []).slice().sort(function (a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  var cp = React.useState("");
  var clientId = cp[0];
  var setClientId = cp[1];
  var sp = React.useState(null);
  var sops = sp[0];
  var setSops = sp[1];
  var pp = React.useState("");
  var sopId = pp[0];
  var setSopId = pp[1];
  var lp = React.useState("");
  var label = lp[0];
  var setLabel = lp[1];
  React.useEffect(
    function () {
      var live = true;
      setSops(null);
      setSopId("");
      var sb = window.mgbSupabase;
      if (!clientId || !sb) return undefined;
      // client_sops RLS: can_access_client.
      sb.from("client_sops")
        .select("id,client_id,section,title")
        .eq("client_id", clientId)
        .limit(200)
        .then(
          function (res) {
            if (live) setSops(res && !res.error && Array.isArray(res.data) ? res.data : []);
          },
          function () {
            if (live) setSops([]);
          },
        );
      return function () {
        live = false;
      };
    },
    [clientId],
  );
  return (
    <form
      className="tkp2-form"
      onSubmit={function (e) {
        e.preventDefault();
        var s = (sops || []).filter(function (x) {
          return x.id === sopId;
        })[0];
        if (!s) {
          TKP2__toast("Pick an SOP.");
          return;
        }
        var l = String(label || s.title || s.section || "SOP").trim().slice(0, TKP2_LIMITS.label);
        props.onAdd({ kind: "sop", sop_id: s.id, client_id: String(s.client_id), label: l });
      }}
    >
      <div className="tkp2-field">
        <label htmlFor="tkp2-fav-client">Client</label>
        <select
          id="tkp2-fav-client"
          value={clientId}
          onChange={function (e) {
            setClientId(e.target.value);
          }}
        >
          <option value="">Pick a client</option>
          {clients.map(function (c) {
            return (
              <option key={c.id} value={String(c.id)}>
                {c.name || c.id}
              </option>
            );
          })}
        </select>
      </div>
      {clientId ? (
        <div className="tkp2-field">
          <label htmlFor="tkp2-fav-sop">SOP</label>
          <select
            id="tkp2-fav-sop"
            value={sopId}
            disabled={sops == null}
            onChange={function (e) {
              var id = e.target.value;
              setSopId(id);
              var s = (sops || []).filter(function (x) {
                return x.id === id;
              })[0];
              if (s) setLabel(String(s.title || s.section || "SOP").slice(0, TKP2_LIMITS.label));
            }}
          >
            <option value="">{sops == null ? "Loading…" : sops.length ? "Pick an SOP" : "No SOPs for this client"}</option>
            {(sops || []).map(function (s) {
              return (
                <option key={s.id} value={s.id}>
                  {s.title || s.section || "SOP"}
                </option>
              );
            })}
          </select>
        </div>
      ) : null}
      {sopId ? (
        <div className="tkp2-field">
          <label htmlFor="tkp2-fav-sop-label">Label</label>
          <input
            id="tkp2-fav-sop-label"
            type="text"
            value={label}
            maxLength={TKP2_LIMITS.label}
            onChange={function (e) {
              setLabel(e.target.value);
            }}
          />
        </div>
      ) : null}
      <div className="tkp2-actions">
        <button type="submit" className="btn-primary" disabled={!sopId}>
          Add SOP
        </button>
        <button type="button" className="btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TKP2_AddLink(props) {
  var lp = React.useState("");
  var label = lp[0];
  var setLabel = lp[1];
  var up = React.useState("");
  var url = up[0];
  var setUrl = up[1];
  return (
    <form
      className="tkp2-form"
      onSubmit={function (e) {
        e.preventDefault();
        var l = String(label || "").trim();
        var u = String(url || "").trim();
        if (!l) {
          TKP2__toast("Give the link a label.");
          return;
        }
        if (!TKP2_urlOk(u)) {
          TKP2__toast("Links must start with https://");
          return;
        }
        props.onAdd({ kind: "link", url: u, label: l });
      }}
    >
      <div className="tkp2-field">
        <label htmlFor="tkp2-fav-label">Label</label>
        <input
          id="tkp2-fav-label"
          type="text"
          value={label}
          maxLength={TKP2_LIMITS.label}
          onChange={function (e) {
            setLabel(e.target.value);
          }}
        />
      </div>
      <div className="tkp2-field">
        <label htmlFor="tkp2-fav-url">Link (https only)</label>
        <input
          id="tkp2-fav-url"
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://"
          maxLength={510}
          onChange={function (e) {
            setUrl(e.target.value);
          }}
        />
      </div>
      <div className="tkp2-actions">
        <button type="submit" className="btn-primary">
          Add link
        </button>
        <button type="button" className="btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TKP2_FavoritesSection(props) {
  var card = props.card;
  var canEdit = props.canEdit;
  var favs = (card.favorites || []).filter(TKP2_favoriteOk);
  var ap = React.useState("");
  var adding = ap[0];
  var setAdding = ap[1];
  var ep = React.useState(false);
  var editing = ep[0];
  var setEditing = ep[1];
  if (!canEdit && !favs.length) return null;
  var cName = {};
  (props.clients || []).forEach(function (c) {
    if (c && c.id != null) cName[String(c.id)] = c.name || "";
  });
  var saveList = function (list, text) {
    return props.save({ favorites: list }, text || "Favorites saved.");
  };
  var full = favs.length >= TKP2_LIMITS.favorites;
  return (
    <section className="card tkp-card tkp2-favs" aria-labelledby="tkp2-favs-title" data-section="favorites">
      <TKP2_Head
        id="tkp2-favs-title"
        title="Favorites"
        card={card}
        canEdit={canEdit}
        shareKey="favorites"
        save={props.save}
        action={
          canEdit && favs.length ? (
            <button
              type="button"
              className="link-btn"
              aria-expanded={editing}
              onClick={function () {
                setEditing(!editing);
              }}
            >
              {editing ? "Done" : "Edit"}
            </button>
          ) : null
        }
      />
      {favs.length ? (
        <ul className="tkp-list tkp2-fav-list">
          {favs.map(function (f, i) {
            var key = f.kind === "sop" ? "s" + f.sop_id : "l" + f.url + i;
            var body =
              f.kind === "sop" ? (
                <a href={TKP2__sopHref(f.client_id)}>
                  {f.label}
                  {cName[String(f.client_id)] ? <span className="tkp-muted"> · SOP, {cName[String(f.client_id)]}</span> : <span className="tkp-muted"> · SOP</span>}
                </a>
              ) : (
                <a href={f.url} target="_blank" rel="noopener noreferrer">
                  {f.label}
                  <span className="tk-sr"> (opens in a new tab)</span>{" "}
                  {typeof TK_vIcon === "function" ? <TK_vIcon name="external" size={12} /> : null}
                </a>
              );
            return (
              <li key={key} className="tkp2-edit-row">
                <span className="tkp2-edit-label">{body}</span>
                {canEdit && editing ? (
                  <TKP2_MoveButtons
                    label={f.label}
                    first={i === 0}
                    last={i === favs.length - 1}
                    onUp={function () {
                      saveList(TKP2__swap(favs, i, -1));
                    }}
                    onDown={function () {
                      saveList(TKP2__swap(favs, i, 1));
                    }}
                    onRemove={function () {
                      saveList(
                        favs.filter(function (x, j) {
                          return j !== i;
                        }),
                        "Removed.",
                      );
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : canEdit ? (
        <p className="card-subtitle">SOPs and links you use a lot.</p>
      ) : null}
      {canEdit && adding === "sop" ? (
        <TKP2_AddSop
          clients={props.clients}
          onCancel={function () {
            setAdding("");
          }}
          onAdd={function (f) {
            saveList(favs.concat([f]), "Favorite added.").then(function (ok) {
              if (ok) setAdding("");
            });
          }}
        />
      ) : null}
      {canEdit && adding === "link" ? (
        <TKP2_AddLink
          onCancel={function () {
            setAdding("");
          }}
          onAdd={function (f) {
            saveList(favs.concat([f]), "Favorite added.").then(function (ok) {
              if (ok) setAdding("");
            });
          }}
        />
      ) : null}
      {canEdit && !adding ? (
        <div className="tkp2-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={full}
            onClick={function () {
              setAdding("sop");
            }}
          >
            Add SOP
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={full}
            onClick={function () {
              setAdding("link");
            }}
          >
            Add link
          </button>
          {full ? <span className="tkp-muted">20 favorites is the most.</span> : null}
        </div>
      ) : null}
    </section>
  );
}

// ---- Default view (own profile only) ---------------------------------------

function TKP2_DefaultViewSection(props) {
  var me = TKP2__lower(props.me);
  var rp = React.useState(null);
  var rows = rp[0];
  var setRows = rp[1];
  var ro = !props.canEdit;
  React.useEffect(function () {
    var live = true;
    if (typeof TK_api === "undefined" || typeof TK_api.filterViewsList !== "function") {
      setRows([]);
      return undefined;
    }
    TK_api.filterViewsList().then(
      function (list) {
        if (live) setRows(list || []);
      },
      function () {
        if (live) setRows([]);
      },
    );
    return function () {
      live = false;
    };
  }, []);
  var current = (rows || []).filter(function (r) {
    return r && r.is_default;
  })[0];
  return (
    <section className="card tkp-card tkp2-defview" aria-labelledby="tkp2-defview-title" data-section="defaultview">
      <div className="tkp2-head">
        <h3 className="card-title" id="tkp2-defview-title">
          Default view
        </h3>
        <span className="tkp-muted tkp2-only-you">Only you see this</span>
      </div>
      {rows == null ? (
        <p className="card-subtitle">Loading…</p>
      ) : !rows.length ? (
        <p className="card-subtitle">No saved filters yet. Save one from Saved filters on the Slate page.</p>
      ) : (
        <>
          <div className="tkp2-field">
            <label htmlFor="tkp2-defview">Saved filter</label>
            <select
              id="tkp2-defview"
              value={current ? current.id : ""}
              disabled={ro}
              title={ro ? "Read-only in View as" : undefined}
              onChange={function (e) {
                var id = e.target.value || null;
                TK_api.filterViewSetDefault(id).then(
                  function () {
                    setRows(
                      rows.map(function (r) {
                        return Object.assign({}, r, { is_default: !!id && r.id === id });
                      }),
                    );
                    TKP2__toast(id ? "Default view saved." : "Default view cleared.");
                  },
                  function (err) {
                    TKP2__toast(TKP2_errText(err));
                  },
                );
              }}
            >
              <option value="">None</option>
              {rows.map(function (r) {
                return (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                );
              })}
            </select>
          </div>
          <p className="tkp-line tkp-muted">Applies when you open Slate.</p>
          {current ? (
            <p className="tkp-line">
              <button
                type="button"
                className="btn-secondary"
                onClick={function () {
                  // Let the filter bar apply the default again on this visit.
                  try {
                    if (typeof TK__fbDefaultSeen !== "undefined" && TK__fbDefaultSeen) delete TK__fbDefaultSeen[me];
                  } catch (e) {}
                  TK_navigate({ view: "my" });
                }}
              >
                Open Slate with this view
              </button>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

// ---- Manager and team -------------------------------------------------------

function TKP2_PersonChip(props) {
  return (
    <TKP_PersonLink email={props.email} className="tkp-person">
      <TK_vAvatar name={props.name} email={props.email} size="sm" decorative />
      <span className="tkp-person-name">{props.name}</span>
    </TKP_PersonLink>
  );
}

function TKP2_OrgSection(props) {
  var card = props.card;
  var org = card.org || { manager: null, reports: [] };
  var teams = card.teams || [];
  var self = props.self;
  var has = !!(org.manager || org.reports.length || teams.length);
  if (!self && !has) return null;
  var nm = function (p) {
    return p.name || TKP2__nameOf(props.dir, p.email);
  };
  return (
    <section className="card tkp-card tkp2-org" aria-labelledby="tkp2-org-title" data-section="org">
      <h3 className="card-title" id="tkp2-org-title">
        Manager and team
      </h3>
      <div className="tkp2-org-block">
        <h4 className="tkp2-sub">Reports to</h4>
        {org.manager ? (
          <TKP2_PersonChip email={org.manager.email} name={nm(org.manager)} />
        ) : self ? (
          <p className="card-subtitle">No manager set yet.</p>
        ) : (
          <p className="card-subtitle">Not set.</p>
        )}
      </div>
      {org.reports.length ? (
        <div className="tkp2-org-block">
          <h4 className="tkp2-sub">Direct reports</h4>
          <ul className="tkp-list tkp-people tkp2-reports">
            {org.reports.map(function (p) {
              return (
                <li key={p.email}>
                  <TKP2_PersonChip email={p.email} name={nm(p)} />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {teams.length ? (
        <div className="tkp2-org-block">
          <h4 className="tkp2-sub">Teams</h4>
          <ul className="tkp2-chips">
            {teams.map(function (t) {
              return (
                <li key={t.id}>
                  <TKP2_TeamChip team={t} teamsList={props.teamsList} dir={props.dir} />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {props.realAdmin ? (
        <p className="tkp-line">
          <a className="link-btn" href="#/hr/employees">
            Change in HR › Employee records
          </a>
        </p>
      ) : null}
    </section>
  );
}

// ---- Out of office (own profile): time off + my clients' backups -----------

function TKP2_BackupsEditor(props) {
  var me = TKP2__lower(props.me);
  var dir = props.dir || [];
  var ro = !props.canEdit;
  var mine = (props.clients || []).filter(function (c) {
    return c && c.assignedBookkeeper && TKP2__lower(c.assignedBookkeeper.email) === me;
  });
  var ids = mine
    .map(function (c) {
      return String(c.id);
    })
    .join(",");
  var sp = React.useState({ loading: true, map: {}, error: "" });
  var st = sp[0];
  var set = sp[1];
  var ap = React.useState("");
  var all = ap[0];
  var setAll = ap[1];
  var bp = React.useState(false);
  var busy = bp[0];
  var setBusy = bp[1];
  React.useEffect(
    function () {
      var live = true;
      var sb = window.mgbSupabase;
      if (!sb || !ids) {
        set({ loading: false, map: {}, error: "" });
        return undefined;
      }
      sb.from("client_profile")
        .select("client_id, backup_bookkeeper_email")
        .in("client_id", ids.split(","))
        .then(
          function (res) {
            if (!live) return;
            if (res && res.error) return set({ loading: false, map: {}, error: "Couldn't load backups." });
            var m = {};
            ((res && res.data) || []).forEach(function (r) {
              m[String(r.client_id)] = TKP2__lower(r.backup_bookkeeper_email);
            });
            set({ loading: false, map: m, error: "" });
          },
          function () {
            if (live) set({ loading: false, map: {}, error: "Couldn't load backups." });
          },
        );
      return function () {
        live = false;
      };
    },
    [ids],
  );
  var saveOne = function (clientId, email) {
    var sb = window.mgbSupabase;
    if (!sb || typeof staffToolsApi === "undefined" || ro) return Promise.resolve(false);
    return Promise.resolve(staffToolsApi.saveProfile(sb, clientId, { backup_bookkeeper_email: email || null }, me)).then(
      function (res) {
        if (res && res.error) return false;
        return true;
      },
      function () {
        return false;
      },
    );
  };
  var notify = function () {
    try {
      if (typeof notifyStaffTools === "function") notifyStaffTools();
    } catch (e) {}
  };
  var change = function (clientId, email) {
    var prev = st.map[clientId] || "";
    var next = Object.assign({}, st.map);
    next[clientId] = TKP2__lower(email);
    set({ loading: false, map: next, error: "" });
    saveOne(clientId, email).then(function (ok) {
      if (ok) {
        TKP2__toast("Backup saved.");
        notify();
      } else {
        var back = Object.assign({}, next);
        back[clientId] = prev;
        set({ loading: false, map: back, error: "" });
        TKP2__toast("Couldn't save that backup. Try again.");
      }
    });
  };
  var applyAll = function () {
    if (!all || busy) return;
    setBusy(true);
    var list = mine.map(function (c) {
      return String(c.id);
    });
    var done = 0;
    var failedIds = [];
    var who = all;
    var step = function (i) {
      if (i >= list.length) {
        setBusy(false);
        set(function (prev) {
          var m = Object.assign({}, prev.map);
          list.forEach(function (id) {
            if (failedIds.indexOf(id) === -1) m[id] = who;
          });
          return { loading: false, map: m, error: "" };
        });
        notify();
        TKP2__toast(
          failedIds.length
            ? "Backup set for " + done + " of " + list.length + " clients. Try again for the rest."
            : "Backup set for " + done + " client" + (done === 1 ? "" : "s") + ".",
        );
        return;
      }
      saveOne(list[i], who).then(function (ok) {
        if (ok) done++;
        else failedIds.push(list[i]);
        step(i + 1);
      });
    };
    step(0);
  };
  if (!mine.length) return <p className="card-subtitle">No clients are assigned to you, so there are no backups to set.</p>;
  return (
    <div className="tkp2-backups">
      <h4 className="tkp2-sub">My clients' backups</h4>
      {st.error ? <p className="card-subtitle">{st.error}</p> : null}
      {st.loading ? <p className="card-subtitle">Loading…</p> : null}
      {!st.loading && !st.error ? (
        <>
          <ul className="tkp2-backup-list">
            {mine.map(function (c) {
              var id = "tkp2-backup-" + String(c.id).replace(/[^A-Za-z0-9_-]/g, "_");
              return (
                <li key={c.id}>
                  <label htmlFor={id}>{c.name || c.id}</label>
                  {typeof CV_StaffSelect === "function" ? (
                    <CV_StaffSelect
                      id={id}
                      value={st.map[String(c.id)] || ""}
                      exclude={me}
                      emptyLabel="No backup"
                      onChange={function (v) {
                        if (!ro) change(String(c.id), v);
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
          {mine.length > 1 && typeof CV_StaffSelect === "function" ? (
            <div className="tkp2-add-row">
              <label htmlFor="tkp2-backup-all">Same backup for every client</label>
              <CV_StaffSelect id="tkp2-backup-all" value={all} exclude={me} emptyLabel="Pick a person" onChange={setAll} />
              <button type="button" className="btn-secondary" disabled={!all || busy || ro} onClick={applyAll}>
                {all ? "Use " + TKP2__nameOf(dir, all) + " for all" : "Use for all"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function TKP2_OooSelf(props) {
  return (
    <section className="card tkp-card tkp2-ooo" aria-labelledby="tkp2-ooo-title" data-section="ooo" data-tour="cv-my-timeoff">
      <h3 className="card-title" id="tkp2-ooo-title">
        Out of office
      </h3>
      <p className="card-subtitle">Add days you'll be away so the team can plan cover. Your open tasks due while you're out go to each client's backup and come back after.</p>
      {typeof CV_MyTimeOffBody === "function" ? <CV_MyTimeOffBody staffUser={props.staffUser} /> : null}
      <TKP2_BackupsEditor me={props.me} clients={props.clients} dir={props.dir} canEdit={props.canEdit} />
    </section>
  );
}

// ---- Arrange sections dialog -----------------------------------------------

function TKP2__sectionTitle(key) {
  if (key === "tasks") return "Tasks";
  if (key === "defaultview") return "Default view (only you)";
  for (var i = 0; i < TKP2_SECTIONS.length; i++) if (TKP2_SECTIONS[i].key === key) return TKP2_SECTIONS[i].title;
  return key;
}

function TKP2_ArrangeDialog(props) {
  var op = React.useState(TKP2_mergeOrder(props.card.section_order));
  var order = op[0];
  var setOrder = op[1];
  var hp = React.useState(TKP2_hiddenFilter(props.card.hidden_sections));
  var hidden = hp[0];
  var setHidden = hp[1];
  var fp = React.useState(null);
  var focus = fp[0];
  var setFocus = fp[1];
  var bp = React.useState(false);
  var busy = bp[0];
  var setBusy = bp[1];
  var refs = React.useRef({});
  React.useEffect(
    function () {
      if (!focus) return;
      var el = refs.current[focus.key + ":" + focus.dir];
      if (el && !el.disabled) el.focus();
      else {
        var other = refs.current[focus.key + ":" + (focus.dir === "up" ? "down" : "up")];
        if (other) other.focus();
      }
    },
    [focus, order],
  );
  var list = order.filter(function (k) {
    return k !== "header";
  });
  var move = function (key, delta) {
    setOrder(TKP2_move(order, key, delta));
    setFocus({ key: key, dir: delta < 0 ? "up" : "down", at: Date.now() });
  };
  return (
    <TK_vModal onClose={props.onClose} labelledBy="tkp2-arrange-title" className="tk-modal tkp2-arrange">
      <div className="modal-header">
        <h3 className="card-title" id="tkp2-arrange-title" style={{ margin: 0 }}>
          Arrange sections
        </h3>
      </div>
      <div className="modal-body">
        <p className="card-subtitle">This order, and what you hide, is how everyone sees your profile. Hiding a section only hides it here.</p>
        <ol className="tkp2-arrange-list">
          {list.map(function (k, i) {
            var title = TKP2__sectionTitle(k);
            var hideable = TKP2_canHide(k);
            var isHidden = hidden.indexOf(k) !== -1;
            var cid = "tkp2-show-" + k;
            return (
              <li key={k} className={isHidden ? "is-hidden" : ""}>
                <span className="tkp2-arrange-name">{title}</span>
                {hideable ? (
                  <span className="tkp2-arrange-show">
                    <input
                      id={cid}
                      type="checkbox"
                      checked={!isHidden}
                      onChange={function () {
                        setHidden(
                          isHidden
                            ? hidden.filter(function (x) {
                                return x !== k;
                              })
                            : hidden.concat([k]),
                        );
                      }}
                    />
                    <label htmlFor={cid}>Show</label>
                  </span>
                ) : (
                  <span className="tkp-muted tkp2-arrange-show">Always shown</span>
                )}
                <span className="tkp2-move">
                  <button
                    type="button"
                    className="tkp2-icon-btn"
                    ref={function (el) {
                      refs.current[k + ":up"] = el;
                    }}
                    aria-label={"Move " + title + " up"}
                    disabled={i === 0}
                    onClick={function () {
                      move(k, -1);
                    }}
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button
                    type="button"
                    className="tkp2-icon-btn"
                    ref={function (el) {
                      refs.current[k + ":down"] = el;
                    }}
                    aria-label={"Move " + title + " down"}
                    disabled={i === list.length - 1}
                    onClick={function () {
                      move(k, 1);
                    }}
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="tkp-muted tkp2-arrange-hint">On a wide screen the top four stay across the top; Tasks and Focus sit in the main column and the rest in the side column, in this order.</p>
      </div>
      <div className="modal-footer tk-modal-footer tkp2-actions">
        <button
          type="button"
          className="link-btn"
          onClick={function () {
            setOrder(TKP2_mergeOrder([]));
            setHidden([]);
          }}
        >
          Reset to default
        </button>
        <button type="button" className="btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={function () {
            setBusy(true);
            props.save({ section_order: order, hidden_sections: hidden }, "Layout saved.").then(function (ok) {
              setBusy(false);
              if (ok) props.onClose();
            });
          }}
        >
          Save
        </button>
      </div>
    </TK_vModal>
  );
}

// ---- Teams card (Team › People, real admins only) --------------------------

function TKP2_TeamRow(props) {
  var t = props.team;
  var dir = props.dir;
  var rp = React.useState(false);
  var renaming = rp[0];
  var setRenaming = rp[1];
  var np = React.useState(t.name);
  var name = np[0];
  var setName = np[1];
  var ap = React.useState("");
  var addPick = ap[0];
  var setAddPick = ap[1];
  var cp = React.useState(false);
  var confirming = cp[0];
  var setConfirming = cp[1];
  var run = props.run;
  var members = t.members || [];
  var color = TKP2_TEAM_COLORS.some(function (c) {
    return c.id === t.color;
  })
    ? t.color
    : "slate";
  var addId = "tkp2-team-add-" + t.id;
  return (
    <li className="tkp2-teamrow">
      <div className="tkp2-teamrow-head">
        {renaming ? (
          <form
            className="tkp2-inline"
            onSubmit={function (e) {
              e.preventDefault();
              var v = String(name || "").trim();
              if (!v) return;
              run(TK_api.teamUpdate(t.id, { name: v }), "Team renamed.").then(function (ok) {
                if (ok) setRenaming(false);
              });
            }}
          >
            <label className="tk-sr" htmlFor={"tkp2-team-name-" + t.id}>
              Team name
            </label>
            <input
              id={"tkp2-team-name-" + t.id}
              type="text"
              value={name}
              maxLength={60}
              autoFocus
              onChange={function (e) {
                setName(e.target.value);
              }}
              onKeyDown={function (e) {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setRenaming(false);
                }
              }}
            />
            <button type="submit" className="btn-primary">
              Save
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={function () {
                setRenaming(false);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <span className={"tkp2-team tkp2-team-" + color}>
              <span className="tkp2-team-dot" aria-hidden="true" />
              {t.name}
            </span>
            <span className="tkp-muted">
              {members.length} {members.length === 1 ? "person" : "people"}
            </span>
            <span className="tkp2-teamrow-actions">
              <button
                type="button"
                className="link-btn"
                onClick={function () {
                  setName(t.name);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={function () {
                  setConfirming(true);
                }}
              >
                Archive
              </button>
            </span>
          </>
        )}
      </div>
      {t.description ? <p className="tkp-line tkp-muted">{t.description}</p> : null}
      {confirming ? (
        <div className="tkp2-confirm" role="alertdialog" aria-labelledby={"tkp2-arch-" + t.id}>
          <p id={"tkp2-arch-" + t.id}>Archive {t.name}? It drops off profiles. Members are kept.</p>
          <div className="tkp2-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={function () {
                run(TK_api.teamArchive(t.id), "Team archived.").then(function () {
                  setConfirming(false);
                });
              }}
            >
              Archive
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={function () {
                setConfirming(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {members.length ? (
        <ul className="tkp2-members">
          {members.map(function (e) {
            var n = TKP2__nameOf(dir, e);
            return (
              <li key={e}>
                {typeof TKP_who === "function" ? (
                  TKP_who(
                    e,
                    <span className="tkp2-member">
                      <TK_vAvatar name={n} email={e} size="sm" decorative />
                      <span>{n}</span>
                    </span>,
                  )
                ) : (
                  <span className="tkp2-member">{n}</span>
                )}
                <button
                  type="button"
                  className="tkp2-icon-btn"
                  aria-label={"Remove " + n + " from " + t.name}
                  onClick={function () {
                    run(TK_api.teamMemberRemove(t.id, e), "Removed from " + t.name + ".");
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="card-subtitle">Nobody on this team yet.</p>
      )}
      <div className="tkp2-add-row">
        <label htmlFor={addId}>Add people</label>
        {typeof CV_StaffSelect === "function" ? <CV_StaffSelect id={addId} value={addPick} emptyLabel="Pick a person" onChange={setAddPick} /> : null}
        <button
          type="button"
          className="btn-secondary"
          disabled={!addPick || members.indexOf(addPick) !== -1}
          onClick={function () {
            run(TK_api.teamMemberAdd(t.id, addPick), "Added to " + t.name + ".").then(function (ok) {
              if (ok) setAddPick("");
            });
          }}
        >
          Add
        </button>
      </div>
    </li>
  );
}

function TKP2_TeamsCard(props) {
  var bp = React.useState(0);
  var bump = bp[0];
  var setBump = bp[1];
  var teams = TKP2_useTeams(true, bump);
  var dir = typeof CV_useDirectory === "function" ? CV_useDirectory() : [];
  var np = React.useState(false);
  var adding = np[0];
  var setAdding = np[1];
  var fp = React.useState({ name: "", description: "", color: "" });
  var f = fp[0];
  var setF = fp[1];
  var ro = TKP2__ro();
  var run = function (p, okText) {
    return Promise.resolve(p).then(
      function () {
        if (okText) TKP2__toast(okText);
        setBump(Date.now());
        return true;
      },
      function (err) {
        TKP2__toast(TKP2_errText(err));
        setBump(Date.now());
        return false;
      },
    );
  };
  if (ro) return null;
  return (
    <section className="card tp-people-card tkp2-teams-card" aria-labelledby="tkp2-teams-title" data-tour="tp-teams">
      <div className="tkp2-head">
        <h3 className="card-title" id="tkp2-teams-title">
          Teams
        </h3>
        {!adding ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={function () {
              setF({ name: "", description: "", color: "" });
              setAdding(true);
            }}
          >
            New team
          </button>
        ) : null}
      </div>
      <p className="card-subtitle">Groups of staff, shown on each person's profile. Only admins can change them.</p>
      {adding ? (
        <form
          className="tkp2-form"
          onSubmit={function (e) {
            e.preventDefault();
            var n = String(f.name || "").trim();
            if (!n) {
              TKP2__toast("Give the team a name.");
              return;
            }
            run(TK_api.teamCreate({ name: n, description: String(f.description || "").trim() || null, color: f.color || null }), "Team created.").then(function (ok) {
              if (ok) setAdding(false);
            });
          }}
        >
          <div className="tkp2-field">
            <label htmlFor="tkp2-newteam-name">Name</label>
            <input
              id="tkp2-newteam-name"
              type="text"
              value={f.name}
              maxLength={60}
              autoFocus
              onChange={function (e) {
                setF(Object.assign({}, f, { name: e.target.value }));
              }}
            />
          </div>
          <div className="tkp2-field">
            <label htmlFor="tkp2-newteam-desc">Description (optional)</label>
            <input
              id="tkp2-newteam-desc"
              type="text"
              value={f.description}
              maxLength={200}
              onChange={function (e) {
                setF(Object.assign({}, f, { description: e.target.value }));
              }}
            />
          </div>
          <div className="tkp2-field">
            <label htmlFor="tkp2-newteam-color">Color</label>
            <select
              id="tkp2-newteam-color"
              value={f.color}
              onChange={function (e) {
                setF(Object.assign({}, f, { color: e.target.value }));
              }}
            >
              <option value="">No color</option>
              {TKP2_TEAM_COLORS.map(function (c) {
                return (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="tkp2-actions">
            <button type="submit" className="btn-primary">
              Create team
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={function () {
                setAdding(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {teams == null ? (
        <p className="card-subtitle">Loading…</p>
      ) : !teams.length ? (
        <p className="card-subtitle tp-people-empty">No teams yet.</p>
      ) : (
        <ul className="tkp2-team-list">
          {teams.map(function (t) {
            return <TKP2_TeamRow key={t.id} team={t} dir={dir} run={run} />;
          })}
        </ul>
      )}
    </section>
  );
}
