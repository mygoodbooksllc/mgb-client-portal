// ----------------------------------------------------------------------------
// TK_SlateRail.jsx — the Slate plus icon sidebar (hidden preview,
// docs/slateplus-sidebar-spec.md). Rules in TK_railLogic.js (node tests).
//
// TKR_Rail(props) is rendered ONLY by TK_Sidebar when TK_App asks for the
// icon variant (rail layout: the portal at 900px and up, the Slate app in
// Regular and Full) and the shared Slate plus gate (TKP_useOn) is on. Gate
// off, View as, the Lists sheet, the phone bottom bar and the sliver keep
// the old TK_Sidebar markup. Never rendered for clients.
//
//   A 64px column of icon + tiny label items (Slate, Review, Waiting,
//   Recurring, Search, People, Projects, Clients, Pin). Links are real
//   (TK_formatRoute) so a modifier click opens a new tab. People, Projects and
//   Clients open a 248px panel beside the column: floating (closes on Esc,
//   outside click, picking an item) or pinned (stays open, pushes the list).
//   Pinned and its section are remembered per person in localStorage
//   mgb_tkrail_v1:<TKP_personKey> (TKR_usePrefs, read by TK_App for the
//   width class too).
//
//   Hover menus (the portal's HoverNav pattern, components/staff/HoverNav.jsx;
//   only while HN_on(), the hovernav_enabled switch, is on): pointing at
//   People, Projects or Clients (or focusing one with the keyboard) opens a
//   flyout of real links beside the rail with the same rows the panel shows.
//   Opens at once, closes 200ms after the pointer leaves the icon or the
//   flyout, Escape closes, ArrowRight enters it, arrows move, a tap on touch
//   still just opens the panel. None while the panel is pinned for that
//   section or any floating panel is open. Rules in TK_railLogic.js.
//
//   data-tour: tk-sidebar (the nav), tk-review-nav, tk-waiting-nav,
//   tk-recurring-nav (rail items), tk-manage-nav (Manage projects in the
//   panel, or the Projects button while that panel is not showing, admins),
//   tk-no-team (No team yet in the panel, or the Clients button while that
//   panel is not showing and it has clients, admins).
//
// Shared Babel scope: top-level names carry a TKR prefix.
// ----------------------------------------------------------------------------

var TKR__OFF = { pinned: false, section: null };
// One parsed value per key (stable snapshots), the subscribers, and one
// storage listener (another window pinned or unpinned) while any is mounted.
var TKR__store = { cache: {}, subs: [], onStorage: null };

function TKR__readPrefs(key) {
  if (!key) return TKR__OFF;
  try {
    return TKR_parsePrefs(window.localStorage.getItem(key));
  } catch (e) {
    return TKR__OFF;
  }
}
function TKR__get(key) {
  if (!key) return TKR__OFF;
  if (!Object.prototype.hasOwnProperty.call(TKR__store.cache, key)) TKR__store.cache[key] = TKR__readPrefs(key);
  return TKR__store.cache[key];
}
function TKR__notify() {
  TKR__store.subs.slice().forEach(function (fn) {
    try {
      fn();
    } catch (e) {}
  });
}
function TKR__sub(fn) {
  var st = TKR__store;
  if (!st.subs.length && typeof window !== "undefined" && window.addEventListener) {
    st.onStorage = function (e) {
      if (e && e.key && e.key.indexOf(TKR_PREFS_PREFIX) !== 0) return;
      if (e && e.key) delete st.cache[e.key];
      else st.cache = {};
      TKR__notify();
    };
    window.addEventListener("storage", st.onStorage);
  }
  st.subs.push(fn);
  return function () {
    st.subs = st.subs.filter(function (f) {
      return f !== fn;
    });
    if (!st.subs.length && st.onStorage && typeof window !== "undefined" && window.removeEventListener) {
      window.removeEventListener("storage", st.onStorage);
      st.onStorage = null;
    }
  };
}
function TKR_setPrefs(key, next) {
  if (!key) return;
  var v = TKR_parsePrefs(next || {});
  TKR__store.cache[key] = v;
  try {
    window.localStorage.setItem(key, TKR_serializePrefs(v));
  } catch (e) {}
  TKR__notify();
}
function TKR__keyFor(email) {
  return typeof TKR_prefsKey === "function" && typeof TKP_personKey === "function" ? TKR_prefsKey(email, TKP_personKey) : "";
}

// { pinned, section } for this person. enabled false: the constant default,
// no storage read (TK_App calls it on every render, gate on or off).
function TKR_usePrefs(email, enabled) {
  var key = enabled ? TKR__keyFor(email) : "";
  var snap = function () {
    return enabled ? TKR__get(key) : TKR__OFF;
  };
  return React.useSyncExternalStore(TKR__sub, snap, snap);
}

// ---- Rail items --------------------------------------------------------------

function TKR__icon(name) {
  if (name === "clients") {
    if (typeof ClientRosterIcon === "function") return <ClientRosterIcon width="20" height="20" aria-hidden="true" focusable="false" className="tk-icon" />;
    return <TK_vIcon name="list" size={20} />;
  }
  return <TK_vIcon name={name} size={20} />;
}

// Rows for the hover menu model (a project's color and a client's badge text).
function TKR__projectRow(p) {
  return { id: p.id, name: p.name, kind: p.kind, color: typeof TK_projectColorOf === "function" ? TK_projectColorOf(p) : null };
}
function TKR__clientRow(c) {
  return { id: c.id, name: c.name, tag: typeof CF_badgeText === "function" ? CF_badgeText(c) || null : null };
}

function TKR_Link(props) {
  var href = typeof TK_formatRoute === "function" ? TK_formatRoute(props.route) : "#/tasks/my";
  var badge = TKR_badgeText(props.count);
  return (
    <li>
      <a
        className={"tkr-item tkr-item-" + props.id + (props.active ? " is-active" : "")}
        href={href}
        data-tour={props.tour || undefined}
        aria-label={TKR_itemLabel(props.label, props.count, props.noun)}
        aria-current={props.active ? "page" : undefined}
        title={props.label}
        onClick={function (e) {
          if (!TK_vPlainClick(e)) return;
          e.preventDefault();
          props.onGo(props.route, e);
        }}
      >
        <span className="tkr-ico">
          {TKR__icon(props.icon)}
          {badge ? (
            <span className="tkr-badge" aria-hidden="true">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="tkr-cap" aria-hidden="true">
          {props.short || props.label}
        </span>
      </a>
    </li>
  );
}

// Hover menus are on when the portal's switch is (HN_on, HoverNav.jsx); re-renders when it changes.
function TKR__hoverOn() {
  try {
    return typeof HN_on === "function" && HN_on() === true;
  } catch (e) {
    return false;
  }
}
function TKR_useHoverOn() {
  var b = React.useState(0);
  React.useEffect(function () {
    var f = function () {
      b[1](function (n) { return n + 1; });
    };
    window.addEventListener("mgb:hovernav", f);
    return function () {
      window.removeEventListener("mgb:hovernav", f);
    };
  }, []);
  return TKR__hoverOn();
}
// Focus that came from the keyboard (not a mouse click or a tap).
function TKR__focusVisible(el) {
  try {
    return !!(el && el.matches && el.matches(":focus-visible"));
  } catch (e) {
    return false;
  }
}

function TKR_SectionBtn(props) {
  return (
    <li>
      <button
        type="button"
        className={"tkr-item tkr-item-" + props.id + (props.active ? " is-active" : "") + (props.open || props.flyOpen ? " is-open" : "")}
        data-tour={props.tour || undefined}
        data-tkr-section={props.id}
        aria-label={props.label}
        aria-expanded={props.open || props.flyOpen ? "true" : "false"}
        aria-controls={props.open ? "tkr-panel" : props.flyOpen ? "tkr-fly" : undefined}
        title={props.noTitle ? undefined : props.label}
        onClick={function (e) {
          props.onOpen(props.id, e);
        }}
        onPointerEnter={props.onHover ? function (e) { props.onHover(props.id, e.currentTarget, TKR_pointerSource(e.pointerType)); } : undefined}
        onPointerLeave={props.onLeave ? function (e) { if (TKR_pointerSource(e.pointerType) !== "touch") props.onLeave(); } : undefined}
        onFocus={props.onHover ? function (e) { if (TKR__focusVisible(e.currentTarget)) props.onHover(props.id, e.currentTarget, "key"); } : undefined}
        onBlur={props.onBlur ? function (e) { props.onBlur(props.id, e); } : undefined}
        onKeyDown={props.onTriggerKey ? function (e) { props.onTriggerKey(props.id, e); } : undefined}
      >
        <span className="tkr-ico">{TKR__icon(props.icon)}</span>
        <span className="tkr-cap" aria-hidden="true">
          {props.label}
        </span>
      </button>
    </li>
  );
}

// ---- The rail ----------------------------------------------------------------

function TKR_Rail(props) {
  var route = props.route || { view: "my" };
  var nav = props.onNavigate;
  var isAdmin = !!props.isAdmin;
  var staffUser = props.staffUser || {};
  var me = String(staffUser.email || "")
    .trim()
    .toLowerCase();
  var prefsKey = TKR__keyFor(me);
  var prefs = TKR_usePrefs(me, true);
  var fPair = React.useState(null);
  var floatSec = fPair[0];
  var setFloat = fPair[1];
  var qPair = React.useState("");
  var filter = qPair[0];
  var setFilter = qPair[1];
  var mPair = React.useState(false);
  var newOpen = mPair[0];
  var setNewOpen = mPair[1];
  var pPair = React.useState({ clients: [], projects: [] });
  var pins = pPair[0];
  var setPins = pPair[1];
  var focusPair = React.useState(0);
  var focusWant = focusPair[0];
  var setFocusWant = focusPair[1];
  var hoverOn = TKR_useHoverOn();
  var hvPair = React.useState(null);
  var hv = hvPair[0];
  var setHv = hvPair[1];
  var hvTimer = React.useRef(null);
  var flyRef = React.useRef(null);
  var skipFly = React.useRef(false);
  var wantFilter = React.useRef(false);
  var rootRef = React.useRef(null);
  var panelRef = React.useRef(null);
  var railRef = React.useRef(null);

  var shown = prefs.pinned ? prefs.section : floatSec;
  var floating = !prefs.pinned && !!floatSec;

  // My pinned clients and projects (profile customization; my own row only).
  React.useEffect(
    function () {
      var live = true;
      var load = function () {
        if (typeof TK_api === "undefined" || !TK_api || !TK_api.profilePrefs || typeof TK_api.profilePrefs.get !== "function") return;
        TK_api.profilePrefs.get().then(
          function (row) {
            if (!live) return;
            setPins({
              clients: row && Array.isArray(row.pinned_client_ids) ? row.pinned_client_ids : [],
              projects: row && Array.isArray(row.pinned_project_ids) ? row.pinned_project_ids : [],
            });
          },
          function () {},
        );
      };
      load();
      window.addEventListener("tkp2:pins", load);
      return function () {
        live = false;
        window.removeEventListener("tkp2:pins", load);
      };
    },
    [me],
  );

  // A floating panel closes when the route changes (back, forward, a link).
  var routeKey = typeof TK_formatRoute === "function" ? TK_formatRoute(route) : route.view;
  React.useEffect(
    function () {
      setFloat(null);
    },
    [routeKey],
  );

  // A hover menu closes on a route change too, and its timer goes with the rail.
  React.useEffect(
    function () {
      setHv(null);
    },
    [routeKey],
  );
  React.useEffect(function () {
    return function () {
      if (hvTimer.current) clearTimeout(hvTimer.current);
    };
  }, []);
  // Once the hover menu renders, measure it and pull it up so its bottom stays
  // inside the window (TKR_flyPos only estimates; rows can also load while open).
  React.useLayoutEffect(function () {
    var el = flyRef.current;
    if (!el || !hv || typeof TKR_flyClampTop !== "function") return;
    var t = TKR_flyClampTop(hv.top, el.offsetHeight, window.innerHeight) + "px";
    if (el.style.top !== t) el.style.top = t;
  });

  // While a hover menu is open: Escape closes it (focus back on its icon if it
  // was inside), a press outside closes it, and so does scrolling or resizing
  // the page (it is positioned in the window, not in the rail).
  var flyOpenSec = hv ? hv.sec : null;
  React.useEffect(
    function () {
      if (!flyOpenSec) return undefined;
      var sec = flyOpenSec;
      var shut = function () {
        if (hvTimer.current) clearTimeout(hvTimer.current);
        hvTimer.current = null;
        setHv(null);
      };
      var onKey = function (e) {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        var inside = !!(flyRef.current && flyRef.current.contains(document.activeElement));
        shut();
        if (inside) focusOpener(sec);
      };
      var onDown = function (e) {
        var t = e.target;
        if ((flyRef.current && flyRef.current.contains(t)) || (rootRef.current && rootRef.current.contains(t))) return;
        shut();
      };
      var onScroll = function (e) {
        if (flyRef.current && e && e.target && flyRef.current.contains(e.target)) return;
        shut();
      };
      document.addEventListener("keydown", onKey);
      document.addEventListener("pointerdown", onDown, true);
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", shut);
      return function () {
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("pointerdown", onDown, true);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", shut);
      };
    },
    [flyOpenSec],
  );

  // A floating panel closes on a click or tap outside the sidebar.
  React.useEffect(
    function () {
      if (!floating) return undefined;
      var onDown = function (e) {
        if (rootRef.current && !rootRef.current.contains(e.target)) setFloat(null);
      };
      document.addEventListener("pointerdown", onDown, true);
      return function () {
        document.removeEventListener("pointerdown", onDown, true);
      };
    },
    [floating],
  );

  // Escape closes a floating panel wherever focus is (a mouse click leaves it
  // on the rail button, or on nothing in Safari). The New project window
  // handles its own Escape first.
  React.useEffect(
    function () {
      if (!floating || newOpen) return undefined;
      var sec = floatSec;
      var onKey = function (e) {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        setFloat(null);
        focusOpener(sec);
      };
      document.addEventListener("keydown", onKey);
      return function () {
        document.removeEventListener("keydown", onKey);
      };
    },
    [floating, floatSec, newOpen],
  );

  // Opened by keyboard: focus the panel's first item.
  React.useEffect(
    function () {
      if (!focusWant || !panelRef.current) return;
      var el = (wantFilter.current && panelRef.current.querySelector(".tk-nav-filter")) || panelRef.current.querySelector("a[href], button:not([disabled]), input");
      wantFilter.current = false;
      if (el && typeof el.focus === "function") el.focus();
    },
    [focusWant],
  );

  var focusOpener = function (sec) {
    var root = rootRef.current;
    var el = root && sec ? root.querySelector('[data-tkr-section="' + sec + '"]') : null;
    // Putting focus back on the icon must not pop its hover menu open again.
    skipFly.current = true;
    if (el && typeof el.focus === "function") el.focus();
    skipFly.current = false;
  };

  var go = function (r) {
    var sec = floatSec;
    var hadFocus = !!(sec && panelRef.current && panelRef.current.contains(document.activeElement));
    if (!prefs.pinned) setFloat(null);
    nav(r);
    // Picked from a floating panel by keyboard: focus its rail button, not <body>.
    if (hadFocus && !prefs.pinned) {
      setTimeout(function () {
        focusOpener(sec);
      }, 0);
    }
  };

  // ---- Hover menus ----
  var cancelFly = function () {
    if (hvTimer.current) clearTimeout(hvTimer.current);
    hvTimer.current = null;
  };
  var closeFly = function () {
    cancelFly();
    setHv(null);
  };
  // Close TKR_HOVER_CLOSE_MS after the pointer leaves the icon or the flyout
  // (the grace that lets it cross the gap); never while focus is inside it.
  var scheduleFly = function () {
    cancelFly();
    hvTimer.current = setTimeout(function () {
      hvTimer.current = null;
      if (flyRef.current && flyRef.current.contains(document.activeElement)) return;
      setHv(null);
    }, TKR_HOVER_CLOSE_MS);
  };
  var flyTrigger = function (sec) {
    var root = rootRef.current;
    return root ? root.querySelector('[data-tkr-section="' + sec + '"]') : null;
  };

  var openSection = function (sec, e) {
    closeFly();
    var byKey = !!(e && e.detail === 0);
    if (prefs.pinned) {
      if (prefs.section !== sec) TKR_setPrefs(prefsKey, { pinned: true, section: sec });
    } else {
      if (floatSec === sec) {
        setFloat(null);
        return;
      }
      setFloat(sec);
    }
    if (byKey) setFocusWant(function (n) { return n + 1; });
  };

  var togglePin = function () {
    if (prefs.pinned) {
      TKR_setPrefs(prefsKey, { pinned: false, section: prefs.section });
      setFloat(null);
      return;
    }
    var sec = floatSec || prefs.section || TKR_sectionOf(route) || "clients";
    TKR_setPrefs(prefsKey, { pinned: true, section: sec });
    setFloat(null);
  };

  var onRailKey = function (e) {
    var root = railRef.current;
    if (!root) return;
    var items = Array.prototype.slice.call(root.querySelectorAll(".tkr-item"));
    var i = TKR_nextIndex(items.indexOf(document.activeElement), items.length, e.key);
    if (i < 0) return;
    e.preventDefault();
    if (items[i] && typeof items[i].focus === "function") items[i].focus();
  };

  // Pinned: Escape in the panel moves focus back to its rail button (a
  // floating panel's Escape is the document listener above).
  var onPanelKey = function (e) {
    if (e.key !== "Escape" || floating) return;
    e.stopPropagation();
    focusOpener(shown);
  };

  var active = TKR_activeItem(route);
  var isRoleAdmin = isAdmin && staffUser.role === "admin";
  var noTeam = Array.isArray(props.noTeam) ? props.noTeam : [];
  var visibleProjects = Array.isArray(props.visibleProjects) ? props.visibleProjects : [];
  var clients = Array.isArray(props.clients) ? props.clients : [];

  var onSearch = function (r, e) {
    if (typeof TKS_openBox === "function" && TKS_openBox()) {
      setFloat(null);
      return;
    }
    go(r);
  };

  // ---- Hover menus: the same rows as the panel, as real links ----
  var flyModels = null;
  if (hoverOn) {
    var fdPeople = Array.isArray(props.people) ? props.people : [];
    var fd = {
      isAdmin: isAdmin,
      isRoleAdmin: isRoleAdmin,
      myRoute: typeof TKP_peopleRowRoute === "function" ? TKP_peopleRowRoute(me, true) : null,
      people: fdPeople,
      personRoute: function (s) {
        return (typeof TKP_peopleRowRoute === "function" ? TKP_peopleRowRoute(s.email, true) : null) || { view: "person", staffId: s.id };
      },
      pinnedProjects: TKR_pinnedRows(pins.projects, visibleProjects).map(TKR__projectRow),
      projects: visibleProjects.map(TKR__projectRow),
      projectRoute: function (p) {
        return { view: "project", projectId: p.id };
      },
      pinnedClients: TKR_pinnedRows(pins.clients, clients).map(TKR__clientRow),
      clients: TKR_filterClients(clients, "", typeof CF_sort === "function" ? CF_sort : null).map(TKR__clientRow),
      clientRoute: function (c) {
        return { view: "client", clientId: String(c.id) };
      },
      noTeam: noTeam,
      clientTotal: typeof props.clientCount === "number" ? props.clientCount : clients.length,
      current: function (r) {
        if (r && r.view === "profile") return typeof TKP_isProfileRoute === "function" && TKP_isProfileRoute(route, r.key);
        return TK_vSameRoute(route, r);
      },
    };
    flyModels = { people: TKR_flyModel("people", fd), projects: TKR_flyModel("projects", fd), clients: TKR_flyModel("clients", fd) };
  }
  var hoverAllowed = function (sec, source) {
    return TKR_hoverOK({ enabled: hoverOn, source: source, section: sec, pinned: prefs.pinned, pinnedSection: prefs.section, floatSec: floatSec });
  };
  var flyShown = !!(hv && flyModels && flyModels[hv.sec] && hoverAllowed(hv.sec, hv.source));
  var flyModel = flyShown ? flyModels[hv.sec] : null;

  var showFly = function (sec, el, source) {
    if (skipFly.current || !flyModels || !el || !hoverAllowed(sec, source) || !TKR_flyOpens(flyModels[sec])) return;
    cancelFly();
    if (hv && hv.sec === sec) return;
    var rr = railRef.current ? railRef.current.getBoundingClientRect() : el.getBoundingClientRect();
    var pos = TKR_flyPos(rr.right, el.getBoundingClientRect().top, flyModels[sec], window.innerHeight);
    setHv({ sec: sec, left: pos.left, top: pos.top, source: source });
  };
  // Keyboard focus moving off the icon (and not into its flyout) closes a
  // flyout that focus opened; a mouse-opened one waits for the pointer.
  var onTriggerBlur = function (sec, e) {
    if (!hv || hv.source !== "key") return;
    if (flyRef.current && e.relatedTarget && flyRef.current.contains(e.relatedTarget)) return;
    closeFly();
  };
  var onTriggerKey = function (sec, e) {
    var act = TKR_triggerKey(e.key, flyShown && hv.sec === sec);
    if (act === "enter") {
      var first = flyRef.current && flyRef.current.querySelector('[role="menuitem"]');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (act === "close") {
      closeFly();
    }
  };
  var onFlyKey = function (e) {
    var root = flyRef.current;
    if (!root || !hv) return;
    var sec = hv.sec;
    if (e.key === "Tab") {
      closeFly();
      focusOpener(sec);
      return;
    }
    var items = Array.prototype.slice.call(root.querySelectorAll('[role="menuitem"]'));
    var k = TKR_flyKey(e.key, items.indexOf(document.activeElement), items.length);
    if (k.activate) {
      var at = items.indexOf(document.activeElement);
      if (at >= 0) {
        e.preventDefault();
        items[at].click();
      }
    } else if (k.close) {
      e.preventDefault();
      e.stopPropagation();
      closeFly();
      focusOpener(sec);
    } else if (k.move >= 0 && items[k.move]) {
      e.preventDefault();
      items[k.move].focus();
    }
  };
  // Focus moving out of the menu to anything outside it and the rail (Ctrl or
  // Cmd+K search, a shortcut) closes it, so it never sits open over that and
  // keeps Slate's list keys paused. Pointer presses outside are the listener above.
  var onFlyBlur = function (e) {
    var to = e.relatedTarget;
    if (!to) return;
    if ((flyRef.current && flyRef.current.contains(to)) || (rootRef.current && rootRef.current.contains(to))) return;
    closeFly();
  };
  var pickFlyAction = function (it, sec, e) {
    closeFly();
    if (it.action === "newProject") {
      setNewOpen(true);
      return;
    }
    if (it.action === "panel") {
      if (prefs.pinned) TKR_setPrefs(prefsKey, { pinned: true, section: sec });
      else setFloat(sec);
      if (sec === "clients") wantFilter.current = true;
      if (sec === "clients" || (e && e.detail === 0)) setFocusWant(function (n) { return n + 1; });
    }
  };
  var flyItem = function (it, sec) {
    var inner = [
      it.dot ? <TK_vProjectDot key="d" color={it.dot} /> : null,
      <span className="tkr-fly-label" key="l">
        {it.label}
      </span>,
      it.tag ? (
        <span className="tkr-fly-tag" key="t">
          {it.tag}
        </span>
      ) : null,
    ];
    if (it.route) {
      return (
        <a
          key={it.key}
          role="menuitem"
          tabIndex={-1}
          className={"hn-fly-item tkr-fly-item" + (it.current ? " current" : "")}
          href={typeof TK_formatRoute === "function" ? TK_formatRoute(it.route) : "#/tasks/my"}
          aria-current={it.current ? "page" : undefined}
          onClick={function (e) {
            if (!TK_vPlainClick(e)) return;
            e.preventDefault();
            var kb = !!(flyRef.current && flyRef.current.contains(document.activeElement));
            closeFly();
            go(it.route);
            if (kb && !prefs.pinned) {
              setTimeout(function () {
                focusOpener(sec);
              }, 0);
            }
          }}
        >
          {inner}
        </a>
      );
    }
    return (
      <button
        key={it.key}
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="hn-fly-item tkr-fly-item"
        onClick={function (e) {
          pickFlyAction(it, sec, e);
        }}
      >
        {inner}
      </button>
    );
  };

  // ---- Panel bodies ----
  var panel = null;
  if (shown === "people") {
    var myRoute = typeof TKP_peopleRowRoute === "function" ? TKP_peopleRowRoute(me, true) : null;
    var people = Array.isArray(props.people) ? props.people : [];
    panel = (
      <React.Fragment>
        <ul className="tk-nav">
          {myRoute ? (
            <TK_vNavItem route={myRoute} label="My profile" avatarName={staffUser.name || "Me"} avatarEmail={me} active={TKP_isProfileRoute(route, myRoute.key)} onNavigate={go} />
          ) : null}
        </ul>
        {isAdmin ? (
          <div className="tk-nav-section">
            <div className="tk-nav-head">
              <h3 className="tk-nav-title">Everyone</h3>
            </div>
            <ul className="tk-nav">
              {props.staffLoading ? <li className="tk-nav-empty">Loading…</li> : null}
              {people.map(function (s) {
                var pr = typeof TKP_peopleRowRoute === "function" ? TKP_peopleRowRoute(s.email, true) : null;
                var r = pr || { view: "person", staffId: s.id };
                var on = pr ? TKP_isProfileRoute(route, pr.key) : TK_vSameRoute(route, r);
                return <TK_vNavItem key={s.id} route={r} label={s.name || "Staff member"} avatarName={s.name || "Staff member"} avatarEmail={s.email} active={on} onNavigate={go} />;
              })}
            </ul>
          </div>
        ) : (
          <p className="tk-muted tkr-note">Find anyone with Search (Ctrl or Cmd+K).</p>
        )}
      </React.Fragment>
    );
  } else if (shown === "projects") {
    var pinnedProjects = TKR_pinnedRows(pins.projects, visibleProjects);
    var projRow = function (p, keyPrefix) {
      var r = { view: "project", projectId: p.id };
      return (
        <TK_vNavItem
          key={keyPrefix + p.id}
          route={r}
          label={p.name || "Project"}
          dot={TK_projectColorOf(p)}
          tag={typeof TKP_projectTag === "function" ? TKP_projectTag(p, true) : p.kind === "onboarding" ? "Onboarding" : null}
          active={TK_vSameRoute(route, r)}
          onNavigate={go}
        />
      );
    };
    panel = (
      <React.Fragment>
        {pinnedProjects.length ? (
          <div className="tk-nav-section">
            <div className="tk-nav-head">
              <h3 className="tk-nav-title">Pinned</h3>
            </div>
            <ul className="tk-nav">
              {pinnedProjects.map(function (p) {
                return projRow(p, "pin-");
              })}
            </ul>
          </div>
        ) : null}
        <div className="tk-nav-section">
          <div className="tk-nav-head">
            <h3 className="tk-nav-title">All projects</h3>
            <button
              type="button"
              className="tk-icon-btn"
              aria-label="New project"
              title="New project"
              onClick={function () {
                setNewOpen(true);
              }}
            >
              <TK_vIcon name="plus" size={16} />
            </button>
          </div>
          <ul className="tk-nav">
            {props.projects == null ? <li className="tk-nav-empty">Loading…</li> : null}
            {props.projects != null && !visibleProjects.length ? <li className="tk-nav-empty">No projects yet.</li> : null}
            {visibleProjects.map(function (p) {
              return projRow(p, "");
            })}
          </ul>
          <button
            type="button"
            className="tk-nav-add"
            onClick={function () {
              setNewOpen(true);
            }}
          >
            <TK_vIcon name="plus" size={14} />
            <span>New project</span>
          </button>
          <ul className="tk-nav">
            {isRoleAdmin ? <TK_vNavItem route={{ view: "manage" }} label="Manage projects" icon="folder" tour="tk-manage-nav" active={route.view === "manage"} onNavigate={go} /> : null}
            {typeof TKPU_Portfolio === "function" ? <TK_vNavItem route={{ view: "portfolio" }} label="Portfolio" icon="list" tour="tk-portfolio-nav" active={route.view === "portfolio"} onNavigate={go} /> : null}
          </ul>
        </div>
      </React.Fragment>
    );
  } else if (shown === "clients") {
    var pinnedClients = TKR_pinnedRows(pins.clients, clients);
    var shownClients = TKR_filterClients(clients, filter, typeof CF_sort === "function" ? CF_sort : null);
    var clientRow = function (c, keyPrefix) {
      var r = { view: "client", clientId: String(c.id) };
      return <TK_vNavItem key={keyPrefix + c.id} route={r} label={c.name || String(c.id)} tag={typeof CF_badgeText === "function" ? CF_badgeText(c) || null : null} active={TK_vSameRoute(route, r)} onNavigate={go} />;
    };
    panel = (
      <React.Fragment>
        {isAdmin && noTeam.length ? (
          <div className="tk-nav-section" data-tour="tk-no-team">
            <div className="tk-nav-head">
              <h3 className="tk-nav-title">No team yet</h3>
            </div>
            <ul className="tk-nav">
              {noTeam.map(function (c) {
                var r = { view: "client", clientId: String(c.client_id) };
                var n = Number(c.open_tasks) || 0;
                return <TK_vNavItem key={c.client_id} route={r} label={c.client_name || String(c.client_id)} tag={n + (n === 1 ? " task" : " tasks")} active={TK_vSameRoute(route, r)} onNavigate={go} />;
              })}
            </ul>
          </div>
        ) : null}
        {pinnedClients.length ? (
          <div className="tk-nav-section">
            <div className="tk-nav-head">
              <h3 className="tk-nav-title">Pinned</h3>
            </div>
            <ul className="tk-nav">
              {pinnedClients.map(function (c) {
                return clientRow(c, "pin-");
              })}
            </ul>
          </div>
        ) : null}
        <div className="tk-nav-section">
          <div className="tk-nav-head">
            <h3 className="tk-nav-title">All clients</h3>
          </div>
          {(typeof props.clientCount === "number" ? props.clientCount : clients.length) > 8 ? (
            <input
              className="tk-input tk-nav-filter"
              type="search"
              placeholder="Find a client"
              aria-label="Find a client"
              value={filter}
              onChange={function (e) {
                setFilter(e.target.value);
              }}
            />
          ) : null}
          <ul className="tk-nav tk-nav-clients">
            {!clients.length ? <li className="tk-nav-empty">No clients to show.</li> : null}
            {clients.length && !shownClients.length ? <li className="tk-nav-empty">No client matches that.</li> : null}
            {shownClients.map(function (c) {
              return clientRow(c, "");
            })}
          </ul>
        </div>
      </React.Fragment>
    );
  }

  var titles = { people: "People", projects: "Projects", clients: "Clients" };

  // The hover-menu props of one rail section button (none while the switch is off).
  var hoverProps = function (sec) {
    if (!flyModels) return {};
    return {
      onHover: showFly,
      onLeave: scheduleFly,
      onBlur: onTriggerBlur,
      onTriggerKey: onTriggerKey,
      flyOpen: flyShown && hv.sec === sec,
      // The flyout's heading names the icon, so the themed title tip would double it.
      noTitle: hoverAllowed(sec, "mouse") && TKR_flyOpens(flyModels[sec]),
    };
  };

  return (
    <nav className={"tk-sidebar tkr" + (shown ? " has-panel" : "") + (prefs.pinned ? " is-pinned" : "")} aria-label="Task lists" data-tour="tk-sidebar" ref={rootRef}>
      <div className="tkr-rail" ref={railRef} onKeyDown={onRailKey}>
        <ul className="tkr-list">
          <TKR_Link id="my" route={{ view: "my" }} label="Slate" icon="home" active={active === "my"} onGo={go} />
          <TKR_Link id="review" route={{ view: "review" }} label="Review" icon="check" count={props.reviewCount} tour="tk-review-nav" active={active === "review"} onGo={go} />
          <TKR_Link id="waiting" route={{ view: "waiting" }} label="Waiting on client" short="Waiting" icon="hourglass" count={props.waitCount} noun="open" tour="tk-waiting-nav" active={active === "waiting"} onGo={go} />
          <TKR_Link id="recurring" route={{ view: "templates" }} label="Recurring" icon="repeat" tour="tk-recurring-nav" active={active === "templates"} onGo={go} />
          <TKR_Link id="search" route={{ view: "search" }} label="Search" icon="search" active={active === "search"} onGo={onSearch} />
        </ul>
        <span className="tkr-sep" aria-hidden="true" />
        <ul className="tkr-list">
          <TKR_SectionBtn id="people" label="People" icon="people" active={active === "people"} open={shown === "people"} onOpen={openSection} {...hoverProps("people")} />
          <TKR_SectionBtn id="projects" label="Projects" icon="folder" tour={isRoleAdmin && shown !== "projects" ? "tk-manage-nav" : undefined} active={active === "projects"} open={shown === "projects"} onOpen={openSection} {...hoverProps("projects")} />
          <TKR_SectionBtn id="clients" label="Clients" icon="clients" tour={isAdmin && noTeam.length && shown !== "clients" ? "tk-no-team" : undefined} active={active === "clients"} open={shown === "clients"} onOpen={openSection} {...hoverProps("clients")} />
        </ul>
        <span className="tkr-gap" />
        <ul className="tkr-list">
          <li>
            <button
              type="button"
              className={"tkr-item tkr-pin" + (prefs.pinned ? " is-active" : "")}
              aria-label="Keep the lists panel open"
              aria-pressed={prefs.pinned ? "true" : "false"}
              title={prefs.pinned ? "Unpin the lists panel" : "Keep the lists panel open"}
              onClick={togglePin}
            >
              <span className="tkr-ico">
                <TK_vIcon name="dock" size={20} />
              </span>
              <span className="tkr-cap" aria-hidden="true">
                {prefs.pinned ? "Unpin" : "Pin"}
              </span>
            </button>
          </li>
        </ul>
      </div>

      {shown && panel ? (
        <div className={"tkr-panel" + (floating ? " is-floating" : "")} id="tkr-panel" role="region" aria-labelledby="tkr-panel-title" ref={panelRef} onKeyDown={onPanelKey}>
          <div className="tkr-panel-head">
            <h2 className="tkr-panel-title" id="tkr-panel-title">
              {titles[shown]}
            </h2>
            {floating ? (
              <button
                type="button"
                className="tk-icon-btn"
                aria-label={"Close " + titles[shown]}
                title="Close"
                onClick={function () {
                  var sec = shown;
                  setFloat(null);
                  focusOpener(sec);
                }}
              >
                ×
              </button>
            ) : null}
          </div>
          <div className="tkr-panel-body">{panel}</div>
        </div>
      ) : null}

      {flyShown && flyModel
        ? ReactDOM.createPortal(
            <div className="hn-fly tkr-fly" id="tkr-fly" role="menu" aria-label={flyModel.title} ref={flyRef} style={{ left: hv.left, top: hv.top }} onMouseEnter={cancelFly} onMouseLeave={scheduleFly} onKeyDown={onFlyKey} onBlur={onFlyBlur}>
              <div className="hn-fly-head" aria-hidden="true">
                {flyModel.title}
              </div>
              <div className="tkr-fly-scroll">
                {flyModel.groups.map(function (g) {
                  return (
                    <div className="tkr-fly-group" role="group" aria-label={g.title || flyModel.title} key={g.key}>
                      {g.title ? (
                        <div className="hn-fly-head tkr-fly-sub" aria-hidden="true">
                          {g.title}
                        </div>
                      ) : null}
                      {g.items.map(function (it) {
                        return flyItem(it, hv.sec);
                      })}
                    </div>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}

      {newOpen ? (
        <TK_NewProjectModal
          isAdmin={isAdmin}
          kind="internal"
          clients={props.clients}
          staffUser={props.staffUser}
          onClose={function () {
            setNewOpen(false);
          }}
          onCreated={function (p) {
            setNewOpen(false);
            if (p && p.id) go({ view: "project", projectId: p.id });
          }}
        />
      ) : null}
    </nav>
  );
}
