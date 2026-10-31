// ----------------------------------------------------------------------------
// Slate plus Profile 2: one unified search box (docs/slateplus-profile2-spec.md §2).
//
//   TKS_SearchBox({ variant: "tb" | "sbar", compact, clients, items, isAdmin,
//                   navCtx, client, effectiveTheme, onToggleTheme, onSignOut,
//                   onOpenSettings })
//   TKS_useResults(q, ctx)  -> { groups, flat, loading }
//
// Mounted only while the gate is on (TKP_useOn(): preview checkbox or firm
// switch, never in View as). The mount points (TopBar.jsx TB_StaffTopBar,
// TK_StandaloneBar.jsx) pick this or the old box; TB_Search and
// TK_SlateSearchBox are untouched. Never mounted for clients.
//
// Data, all with the viewer's own JWT (§2.4): People from staff_directory()
// (name + role, never email); Clients from the `clients` prop only (the
// viewer's visible clients, never a query); Projects from tk_projects (RLS),
// cached 60 s, dropped unless their client is visible (non-admins); Tasks and
// Notes from tk_search_prefix (TK_api.searchPrefix); SOPs from client_sops
// (RLS, id/client_id/section/title only) filtered to visible clients; Help
// from search_staff_guide with the admin-article filter. Pages and Actions on
// the top-bar variant only. Pure helpers live in TK_searchLogic.js.
//
// Shared Babel scope: top-level names carry a TKS prefix.
// ----------------------------------------------------------------------------

// Set by TK_MyTasks while a full (not embedded) Slate list is mounted with
// the gate on; the box then offers "Filter this Slate list".
var TKS__listMounted = false;

var TKS_DEBOUNCE_MS = 200;
var TKS_SERVER_LIMIT = 12;

// ---- Ctrl/Cmd+K: one listener, owned by the box mounted last ------------------
var TKS__kOwners = [];
var TKS__kBound = false;
function TKS__bindK() {
  if (TKS__kBound || typeof document === "undefined") return;
  TKS__kBound = true;
  document.addEventListener("keydown", function (e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (String(e.key || "").toLowerCase() !== "k") return;
    var top = TKS__kOwners[TKS__kOwners.length - 1];
    if (!top) return;
    e.preventDefault();
    if (window.MGB_track) window.MGB_track("palette-open", "keyboard");
    top();
  });
}

// Opens the box mounted last, like Ctrl/Cmd+K (the Slate plus icon rail's
// Search button). False when no box is mounted or it is not on screen (the
// caller then falls back to the Search view).
function TKS_openBox() {
  var top = TKS__kOwners[TKS__kOwners.length - 1];
  if (!top) return false;
  return top() === true;
}

// ---- Projects (tk_projects RLS read, cached 60 s) ------------------------------
var TKS__proj = { at: 0, promise: null };
function TKS__loadProjects() {
  var sb = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!sb) return Promise.resolve([]);
  if (TKS__proj.promise && Date.now() - TKS__proj.at < 60000) return TKS__proj.promise;
  TKS__proj.at = Date.now();
  TKS__proj.promise = Promise.resolve(
    sb.from("tk_projects").select("id,name,client_id,kind,archived_at").is("trashed_at", null).limit(500),
  ).then(
    function (res) {
      return res && !res.error && Array.isArray(res.data) ? res.data : [];
    },
    function () {
      return [];
    },
  );
  return TKS__proj.promise;
}

// PostgREST or= filters split on commas and parentheses (TB_safeTerm's rule).
function TKS__safeTerm(q) {
  if (typeof TB_safeTerm === "function") return TB_safeTerm(q);
  return String(q || "").replace(/[^A-Za-z0-9 '&.-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

function TKS__longest(terms) {
  return (terms || []).reduce(function (m, t) {
    return t.length > m.length ? t : m;
  }, "");
}

function TKS__fmtDue(d) {
  if (!d) return "";
  try {
    if (typeof fmtDate === "function") return "Due " + fmtDate(d);
  } catch (e) {}
  return "Due " + String(d).slice(0, 10);
}

function TKS__roleLabel(role) {
  if (typeof TK_vRoleLabel === "function") return TK_vRoleLabel(role);
  return role ? String(role).replace(/_/g, " ") : "Staff";
}

function TKS__inSlateApp() {
  try {
    return typeof TK_slateInApp === "function" && TK_slateInApp();
  } catch (e) {
    return false;
  }
}

// A portal page from either variant. In the Slate app window it goes to the
// portal window (TK_slateForwardHash), as the bar's Help button does.
function TKS__goPortal(variant, hash) {
  if (variant === "sbar" && TKS__inSlateApp() && typeof TK_slateForwardHash === "function") {
    TK_slateForwardHash(hash);
    return;
  }
  if (typeof TB_go === "function") TB_go(hash);
  else {
    try {
      if (window.location.hash !== hash) window.location.hash = hash;
    } catch (e) {}
  }
}

function TKS__openTask(id) {
  var canTb = typeof TB_tkCanOpen === "function" ? TB_tkCanOpen() : typeof TK_openTask === "function";
  if (canTb && typeof TK_openTask === "function") {
    TK_openTask(id, { from: "search" });
    return;
  }
  if (typeof TK_navigate === "function") TK_navigate({ view: "my" });
  else TKS__goPortal("tb", "#/tasks/my");
}

// Act on one picked row (TKS_routeFor decides what it is).
function TKS_open(item, variant) {
  var r = typeof TKS_routeFor === "function" ? TKS_routeFor(item) : null;
  if (!r) return;
  if (r.kind === "person") {
    if (!(typeof TKP_openPerson === "function" && TKP_openPerson(item.email))) TKS__goPortal(variant, r.hash);
  } else if (r.kind === "client") {
    if (variant === "sbar" && typeof TK_navigate === "function") TK_navigate({ view: "client", clientId: r.id });
    else TKS__goPortal(variant, typeof TB_clientHash === "function" ? TB_clientHash(r.id) : "#/client/" + encodeURIComponent(r.id));
  } else if (r.kind === "project") {
    if (typeof TK_navigate === "function") TK_navigate({ view: "project", projectId: r.id });
    else TKS__goPortal(variant, "#/tasks/p/" + r.id);
  } else if (r.kind === "task") {
    TKS__openTask(r.id);
  } else if (r.kind === "sop") {
    TKS__goPortal(variant, typeof TB_clientHash === "function" ? TB_clientHash(r.clientId, "sop") : "#/client/" + encodeURIComponent(r.clientId) + "/sop");
  } else if (r.kind === "help") {
    TKS__goPortal(variant, r.hash);
  } else if (r.kind === "go") {
    r.go();
  } else if (r.kind === "filter") {
    try {
      window.dispatchEvent(new CustomEvent("tks:filter-list", { detail: { q: r.q } }));
    } catch (e) {}
  } else if (r.kind === "searchPage") {
    if (typeof TK_slateSearch === "function") TK_slateSearch(r.q);
    else TKS__goPortal(variant, r.hash);
  }
}

// ---- Results ---------------------------------------------------------------------

// ctx: { variant, clients, isAdmin, navCtx, client, effectiveTheme,
// onToggleTheme, onSignOut, onOpenSettings, open }
function TKS_useResults(q, ctx) {
  var c = ctx || {};
  var variant = c.variant === "sbar" ? "sbar" : "tb";
  var terms = typeof TKS_terms === "function" ? TKS_terms(q) : [];
  var termKey = terms.join(" ");
  var longest = TKS__longest(terms);
  var dirPair = React.useState(function () {
    return typeof CV_dir !== "undefined" && CV_dir && CV_dir.list ? CV_dir.list : null;
  });
  var dir = dirPair[0];
  var projPair = React.useState(null);
  var projects = projPair[0];
  var teamsPair = React.useState(null);
  var teamsBy = teamsPair[0];
  var srvPair = React.useState({ key: "", tasks: [], sops: [], help: [], loading: false });
  var srv = srvPair[0];
  var setSrv = srvPair[1];
  var seqRef = React.useRef(null);
  if (!seqRef.current) seqRef.current = typeof TKS_seq === "function" ? TKS_seq() : { next: function () { return 0; }, current: function () { return true; } };

  // Directory and projects load once the box first opens.
  React.useEffect(
    function () {
      if (!c.open) return undefined;
      var alive = true;
      if (dir === null && typeof CV_loadDirectory === "function") {
        CV_loadDirectory().then(function (l) {
          if (alive) dirPair[1](l || []);
        });
      }
      if (projects === null) {
        TKS__loadProjects().then(function (rows) {
          if (alive) projPair[1](rows);
        });
      }
      // Team names for People rows (12.2): the shared 60 s cached read.
      if (teamsBy === null && typeof TK_api !== "undefined" && TK_api && typeof TK_api.teamsList === "function") {
        Promise.resolve(TK_api.teamsList()).then(
          function (rows) {
            var by = {};
            (Array.isArray(rows) ? rows : []).forEach(function (t) {
              if (!t || !t.name) return;
              (t.members || []).forEach(function (em) {
                var k = String(em || "").toLowerCase();
                if (k) (by[k] = by[k] || []).push(String(t.name));
              });
            });
            if (alive) teamsPair[1](by);
          },
          function () {
            if (alive) teamsPair[1]({});
          },
        );
      }
      return function () {
        alive = false;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.open],
  );

  // Server groups: 200 ms after typing stops, 2+ characters, stale replies dropped.
  React.useEffect(
    function () {
      var seq = seqRef.current.next();
      if (!termKey || longest.length < 2) {
        setSrv(function (s) {
          return s.key || s.loading ? { key: "", tasks: [], sops: [], help: [], loading: false } : s;
        });
        return undefined;
      }
      setSrv(function (s) {
        return Object.assign({}, s, { loading: true });
      });
      var t = setTimeout(function () {
        var sb = window.mgbSupabase;
        var safe = function (p) {
          return Promise.resolve(p).then(
            function (r) {
              return r;
            },
            function () {
              return null;
            },
          );
        };
        var api = typeof TK_api !== "undefined" && TK_api && typeof TK_api.searchPrefix === "function" ? TK_api : null;
        var term = TKS__safeTerm(longest);
        var like = "%" + term + "%";
        Promise.all([
          api ? safe(api.searchPrefix(q, TKS_SERVER_LIMIT)) : Promise.resolve([]),
          sb && term.length >= 2
            ? safe(sb.from("client_sops").select("id,client_id,section,title").or("title.ilike." + like + ",section.ilike." + like + ",body.ilike." + like).limit(20))
            : Promise.resolve(null),
          sb && term.length >= 2 ? safe(sb.rpc("search_staff_guide", { q: term })) : Promise.resolve(null),
        ]).then(function (out) {
          if (!seqRef.current.current(seq)) return;
          setSrv({
            key: termKey,
            tasks: Array.isArray(out[0]) ? out[0] : [],
            sops: out[1] && !out[1].error && Array.isArray(out[1].data) ? out[1].data : [],
            help: out[2] && !out[2].error && Array.isArray(out[2].data) ? out[2].data : [],
            loading: false,
          });
        });
      }, TKS_DEBOUNCE_MS);
      return function () {
        clearTimeout(t);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [termKey],
  );

  var clients = Array.isArray(c.clients) ? c.clients : [];
  var visible = {};
  clients.forEach(function (cl) {
    if (cl && cl.id != null) visible[String(cl.id)] = cl;
  });
  var clientName = function (id) {
    var cl = id != null ? visible[String(id)] : null;
    return cl ? cl.name : "";
  };
  var match = function (list, fieldsOf) {
    return typeof TKS_matchItems === "function" ? TKS_matchItems(list, terms, fieldsOf) : [];
  };
  var groups = [];
  var empty = !terms.length;

  if (!empty) {
    if (TKS__listMounted) {
      groups.push({ key: "filter", items: [{ type: "filter", q: String(q || "").trim(), key: "f", title: 'Filter this Slate list for "' + String(q || "").trim() + '"', sub: "" }] });
    }
    // People: name words and the email's local part; shows name, role and
    // team names (muted second line).
    groups.push({
      key: "people",
      items: match(dir || [], function (s) {
        return { title: s.name || "", notes: String(s.email || "").split("@")[0] };
      }).map(function (m) {
        var tn = (teamsBy && teamsBy[String(m.item.email || "").toLowerCase()]) || [];
        var sub = [TKS__roleLabel(m.item.role)].concat(tn).filter(Boolean).join(" · ");
        return { type: "person", email: m.item.email, key: "u:" + m.item.email, title: m.item.name || "A teammate", sub: sub };
      }),
    });
    groups.push({
      key: "clients",
      items: match(clients, function (cl) {
        return { title: cl.name || "" };
      }).map(function (m) {
        var cl = m.item;
        var sub = [typeof planLabel === "function" ? planLabel(cl.plan) : "", typeof CF_badgeText === "function" ? CF_badgeText(cl) : ""].filter(Boolean).join(" · ");
        return { type: "client", id: cl.id, key: "c:" + cl.id, title: cl.name, sub: sub };
      }),
    });
    if (longest.length >= 2) {
      var projRows = (projects || []).filter(function (p) {
        if (!p || !p.id) return false;
        if (c.isAdmin || p.client_id == null) return true;
        return !!visible[String(p.client_id)];
      });
      groups.push({
        key: "projects",
        items: match(projRows, function (p) {
          return { title: p.name || "", client: clientName(p.client_id) };
        }).map(function (m) {
          var p = m.item;
          var sub = [clientName(p.client_id), p.archived_at ? "Archived" : ""].filter(Boolean).join(" · ");
          return { type: "project", id: p.id, key: "p:" + p.id, title: p.name || "Project", sub: sub };
        }),
      });
    }
    if (srv.key === termKey) {
      var ranked = srv.tasks
        .filter(function (h) {
          return h && h.task_id;
        })
        .map(function (h) {
          return { item: h, rank: TKS_rank({ match: h.match, task_text: h.task_text, q: q }), title: String(h.task_text || ""), due: h.due_date || "" };
        })
        .sort(TKS_compare);
      var toRow = function (m) {
        var h = m.item;
        var snip = String(h.snippet || "").replace(/\s+/g, " ").trim().slice(0, 90);
        var sub =
          h.match === "comment" && snip
            ? "In a comment: " + snip
            : [clientName(h.client_id), TKS__fmtDue(h.due_date), h.done ? "Done" : ""].filter(Boolean).join(" · ");
        return { type: h.kind === "note" ? "note" : "task", id: h.task_id, key: "t:" + h.task_id, title: h.task_text || "Task", sub: sub };
      };
      var taskRows = ranked.filter(function (m) {
        return m.item.kind !== "note";
      }).map(toRow);
      var noteRows = ranked.filter(function (m) {
        return m.item.kind === "note";
      }).map(toRow);
      var tasksGroup = { key: "tasks", items: taskRows };
      if (taskRows.length && (taskRows.length > TKS_CAPS.tasks || srv.tasks.length >= TKS_SERVER_LIMIT)) {
        tasksGroup.footer = { type: "seeAll", q: String(q || "").trim(), key: "all", title: "See all task matches", sub: "" };
      }
      groups.push(tasksGroup);
      groups.push({ key: "notes", items: noteRows });
      // SOPs and Help match substrings on the server; re-ranked prefix first.
      groups.push({
        key: "sops",
        items: match(
          srv.sops.filter(function (s) {
            return s && visible[String(s.client_id)];
          }),
          function (s) {
            return { title: s.title || s.section || "", client: clientName(s.client_id), notes: s.section || "", allowSubstring: true };
          },
        ).map(function (m) {
          var s = m.item;
          return { type: "sop", clientId: s.client_id, key: "s:" + (s.id || s.client_id + ":" + s.section), title: clientName(s.client_id) + " · " + (s.title || s.section || "SOP"), sub: s.section || "" };
        }),
      });
      groups.push({
        key: "help",
        items: match(
          srv.help.filter(function (h) {
            if (!h || !h.slug) return false;
            if (c.isAdmin) return true;
            if (h.audience === "admin") return false;
            return !(typeof TB_ADMIN_ARTICLES !== "undefined" && TB_ADMIN_ARTICLES && TB_ADMIN_ARTICLES.has && TB_ADMIN_ARTICLES.has(h.slug));
          }),
          function (h) {
            return { title: h.title || "", notes: h.section || "", allowSubstring: true };
          },
        ).map(function (m) {
          return { type: "help", slug: m.item.slug, key: "h:" + m.item.slug, title: m.item.title || "Help article", sub: m.item.section || "" };
        }),
      });
    }
  }

  // Pages and Actions (top bar only): the whole jump menu on an empty query.
  if (variant === "tb") {
    var pages = typeof TB_pageRows === "function" ? TB_pageRows(c.navCtx || { isAdmin: !!c.isAdmin }, c.onOpenSettings) : [];
    var actions =
      typeof TB_actionRows === "function"
        ? TB_actionRows({ client: c.client, showMine: true, effectiveTheme: c.effectiveTheme, onToggleTheme: c.onToggleTheme, onSignOut: c.onSignOut })
        : [];
    var pick = function (list, type) {
      var rows = empty
        ? list.map(function (r) {
            return { item: r };
          })
        : match(list, function (r) {
            return { title: r.title || "", notes: (r.keywords || []).join(" ") };
          });
      return rows.map(function (m) {
        return { type: type, go: m.item.go, key: m.item.key, title: m.item.title, sub: m.item.sub || "" };
      });
    };
    groups.push({ key: "pages", items: pick(pages, "page") });
    groups.push({ key: "actions", items: pick(actions, "action") });
  }

  var caps = empty ? { pages: 999, actions: 999 } : null;
  var capped = typeof TKS_cap === "function" ? TKS_cap(groups, caps) : [];
  var flat = typeof TKS_flatten === "function" ? TKS_flatten(capped) : [];
  var loading = !empty && longest.length >= 2 && (srv.loading || srv.key !== termKey);
  return { groups: capped, flat: flat, loading: loading, empty: empty };
}

// ---- The box ---------------------------------------------------------------------

function TKS__useNarrow() {
  var get = function () {
    try {
      return window.matchMedia("(max-width: 760px)").matches;
    } catch (e) {
      return false;
    }
  };
  var pair = React.useState(get);
  React.useEffect(function () {
    var mq = null;
    try {
      mq = window.matchMedia("(max-width: 760px)");
    } catch (e) {
      return undefined;
    }
    var on = function () {
      pair[1](mq.matches);
    };
    if (mq.addEventListener) mq.addEventListener("change", on);
    else if (mq.addListener) mq.addListener(on);
    return function () {
      if (mq.removeEventListener) mq.removeEventListener("change", on);
      else if (mq.removeListener) mq.removeListener(on);
    };
  }, []);
  return pair[0];
}

var TKS__uid = 0;

function TKS_SearchBox(props) {
  var p = props || {};
  var variant = p.variant === "sbar" ? "sbar" : "tb";
  var narrow = TKS__useNarrow();
  var compact = p.compact === true || narrow;
  var idRef = React.useRef(null);
  if (!idRef.current) idRef.current = "tks-list-" + ++TKS__uid;
  var listId = idRef.current;
  var qPair = React.useState("");
  var query = qPair[0];
  var setQuery = qPair[1];
  var oPair = React.useState(false);
  var open = oPair[0];
  var setOpen = oPair[1];
  var sPair = React.useState(false); // phone sheet
  var sheet = sPair[0];
  var setSheet = sPair[1];
  var aPair = React.useState(-1);
  var active = aPair[0];
  var setActive = aPair[1];
  var rootRef = React.useRef(null);
  var inputRef = React.useRef(null);
  var iconRef = React.useRef(null);
  var listRef = React.useRef(null);
  var isMac = /Mac|iPhone|iPad/.test((typeof navigator !== "undefined" && (navigator.platform || navigator.userAgent)) || "");

  var res = TKS_useResults(query, {
    variant: variant,
    clients: p.clients,
    isAdmin: p.isAdmin,
    navCtx: p.navCtx,
    client: p.client,
    effectiveTheme: p.effectiveTheme,
    onToggleTheme: p.onToggleTheme,
    onSignOut: p.onSignOut,
    onOpenSettings: p.onOpenSettings,
    open: open || sheet,
  });
  var flat = res.flat;
  var q = query.trim();

  // Ctrl/Cmd+K focuses this box (the last one mounted owns it).
  var focusRef = React.useRef(null);
  // True when something visible opened (TKS_openBox; Ctrl/Cmd+K ignores it).
  focusRef.current = function () {
    if (compact) {
      setSheet(true);
      setOpen(true);
      return true;
    }
    setOpen(true);
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      return !!inputRef.current.getClientRects().length;
    }
    return false;
  };
  React.useEffect(function () {
    TKS__bindK();
    var fn = function () {
      return focusRef.current ? focusRef.current() : false;
    };
    TKS__kOwners.push(fn);
    return function () {
      TKS__kOwners = TKS__kOwners.filter(function (f) {
        return f !== fn;
      });
    };
  }, []);

  // A click or tap outside closes the panel (not the phone sheet: its backdrop does).
  React.useEffect(
    function () {
      if (!open || sheet) return undefined;
      var onDown = function (e) {
        if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
      };
      document.addEventListener("mousedown", onDown);
      document.addEventListener("touchstart", onDown, { passive: true });
      return function () {
        document.removeEventListener("mousedown", onDown);
        document.removeEventListener("touchstart", onDown);
      };
    },
    [open, sheet],
  );

  // The sheet takes focus when it opens.
  React.useEffect(
    function () {
      if (sheet && inputRef.current) inputRef.current.focus();
    },
    [sheet],
  );

  React.useEffect(
    function () {
      setActive(-1);
    },
    [q],
  );

  React.useEffect(
    function () {
      if (active < 0 || !listRef.current) return;
      var el = listRef.current.querySelector('[data-idx="' + active + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    },
    [active],
  );

  // Phone back closes the sheet: opening it adds one same-URL history entry
  // (keeping mgbNav); Back pops it. Closing any other way removes that entry
  // first, so nothing is left behind. window.TKS_sheetEntryLive tells the
  // task drawer to ignore that popstate.
  var histRef = React.useRef(null);
  React.useEffect(
    function () {
      if (!sheet) return undefined;
      var token = "tks-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      try {
        var st = window.history.state;
        window.history.pushState(Object.assign({}, st && typeof st === "object" ? st : {}, { tksSheet: token }), "");
        histRef.current = token;
        window.TKS_sheetEntryLive = true;
      } catch (e) {
        histRef.current = null;
      }
      var onPop = function () {
        if (histRef.current !== token) return;
        var cur = null;
        try {
          cur = window.history.state;
        } catch (e) {}
        if (cur && cur.tksSheet === token) return;
        histRef.current = null;
        setTimeout(function () {
          window.TKS_sheetEntryLive = false;
        }, 0);
        setSheet(false);
        setOpen(false);
      };
      window.addEventListener("popstate", onPop);
      return function () {
        window.removeEventListener("popstate", onPop);
      };
    },
    [sheet],
  );
  var leaveSheetEntry = function (after) {
    var token = histRef.current;
    histRef.current = null;
    var st = null;
    try {
      st = window.history.state;
    } catch (e) {}
    if (!token || !st || st.tksSheet !== token) {
      window.TKS_sheetEntryLive = false;
      if (after) after();
      return;
    }
    var done = false;
    var t = null;
    var fin = function () {
      if (done) return;
      done = true;
      window.removeEventListener("popstate", fin);
      clearTimeout(t);
      setTimeout(function () {
        window.TKS_sheetEntryLive = false;
      }, 0);
      if (after) after();
    };
    t = setTimeout(fin, 400);
    window.addEventListener("popstate", fin);
    try {
      window.history.back();
    } catch (e) {
      fin();
    }
  };

  var closeSheet = function (refocus, after) {
    setSheet(false);
    setOpen(false);
    if (refocus && iconRef.current) {
      try {
        iconRef.current.focus();
      } catch (e) {}
    }
    leaveSheetEntry(after);
  };

  var pickRow = function (row) {
    if (!row) return;
    setQuery("");
    setActive(-1);
    if (sheet) {
      // Open after the sheet's history entry is gone, so the new page is
      // not pushed on top of it.
      closeSheet(false, function () {
        TKS_open(row.item, variant);
      });
      return;
    }
    setOpen(false);
    if (inputRef.current) inputRef.current.blur();
    TKS_open(row.item, variant);
  };

  var onKeyDown = function (e) {
    var n = flat.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (n) setActive(TKS_step(active, e.key === "ArrowDown" ? 1 : -1, n));
    } else if ((e.key === "Home" || e.key === "End") && open && n && active >= 0) {
      e.preventDefault();
      setActive(TKS_step(active, e.key === "Home" ? -Infinity : Infinity, n));
    } else if (e.key === "Enter") {
      if (!n) return;
      e.preventDefault();
      pickRow(flat[active >= 0 ? active : 0]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (query) setQuery("");
      else if (sheet) closeSheet(true);
      else if (open) setOpen(false);
      else if (inputRef.current) inputRef.current.blur();
    }
  };

  var panelOpen = open || sheet;
  var count = flat.length;
  var live = !q ? "" : res.loading && !count ? "Searching" : count === 1 ? "1 result" : count + " results";

  var panel = panelOpen ? (
    <div className={"tb-panel tb-search-panel tks-panel" + (sheet ? " tks-panel-sheet" : "")}>
      <div className="tb-search-list tks-list" id={listId} role="listbox" ref={listRef} aria-label={q ? "Search results" : "Pages and actions"}>
        {res.groups.map(function (g) {
          var rows = flat.filter(function (f) {
            return f.group === g.key;
          });
          return (
            <div key={g.key} role="group" aria-label={g.label || "Filter"} className={"tks-group tks-group-" + g.key}>
              {g.label ? (
                <div className="tb-panel-head" role="presentation">
                  {g.label}
                </div>
              ) : null}
              {rows.map(function (f) {
                var i = flat.indexOf(f);
                var it = f.item;
                return (
                  <div
                    key={(f.footer ? "foot:" : "") + it.key}
                    id={listId + "-" + i}
                    data-idx={i}
                    role="option"
                    aria-selected={i === active ? "true" : "false"}
                    className={"tb-result tks-result" + (i === active ? " active" : "") + (f.footer ? " tks-foot-row" : "") + (it.type === "filter" ? " tks-filter-row" : "")}
                    onMouseEnter={function () {
                      setActive(i);
                    }}
                    onMouseDown={function (e) {
                      e.preventDefault();
                    }}
                    onClick={function () {
                      pickRow(f);
                    }}
                  >
                    <span className="tb-result-title">{it.title}</span>
                    {it.sub ? <span className="tb-result-sub">{it.sub}</span> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
        {count === 0 ? (
          <div className="tb-empty">{!q ? (variant === "tb" ? "Nothing to jump to yet." : "Type to search people, clients, tasks and help.") : res.loading ? "Searching…" : 'No matches for "' + q + '".'}</div>
        ) : null}
      </div>
      {res.loading && count > 0 ? <div className="tb-search-foot">Searching tasks, SOPs and help…</div> : !q ? <div className="tb-search-foot">↑↓ to move · ↵ to open · Esc to close</div> : null}
    </div>
  ) : null;

  var box = (
    <div className="tb-search-box tks-box">
      <TK_vIcon name="search" size={16} />
      <input
        ref={inputRef}
        type="text"
        className="tb-search-input tks-input"
        placeholder="Search people, clients, tasks, help"
        maxLength={200}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={function (e) {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={function () {
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={panelOpen ? "true" : "false"}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={panelOpen && active >= 0 && active < count ? listId + "-" + active : undefined}
        aria-label="Search people, clients, projects, tasks, SOPs and help"
      />
      {query ? (
        <button
          type="button"
          className="tks-clear"
          aria-label="Clear search"
          onMouseDown={function (e) {
            e.preventDefault();
          }}
          onClick={function () {
            setQuery("");
            if (inputRef.current) inputRef.current.focus();
          }}
        >
          ×
        </button>
      ) : !compact ? (
        <kbd className="tb-kbd" aria-hidden="true">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      ) : null}
    </div>
  );

  var tour = variant === "tb" ? "tb-search" : "tks-search";
  var srLive = (
    <span className="tk-sr" aria-live="polite">
      {live}
    </span>
  );

  if (compact) {
    return (
      <div className={"tks-search tks-" + variant + " is-compact"} data-tour={tour}>
        <button
          type="button"
          ref={iconRef}
          className={variant === "sbar" ? "tk-sbar-btn tks-icon-btn" : "tks-icon-btn"}
          aria-label="Search"
          title="Search"
          aria-haspopup="dialog"
          aria-expanded={sheet ? "true" : "false"}
          onClick={function () {
            setSheet(true);
            setOpen(true);
          }}
        >
          <TK_vIcon name="search" size={18} />
        </button>
        {sheet ? (
          <div className="tks-sheet-wrap">
            <div
              className="tks-backdrop"
              aria-hidden="true"
              onClick={function () {
                closeSheet(true);
              }}
            />
            <div className="tks-sheet" role="dialog" aria-modal="true" aria-label="Search" ref={rootRef}>
              <div className="tks-sheet-top">
                {box}
                <button
                  type="button"
                  className="tks-sheet-close"
                  onClick={function () {
                    closeSheet(true);
                  }}
                >
                  Close
                </button>
              </div>
              {panel}
            </div>
          </div>
        ) : null}
        {srLive}
      </div>
    );
  }

  return (
    <div className={"tb-search tks-search tks-" + variant} ref={rootRef} data-tour={tour}>
      {box}
      {panel}
      {srLive}
    </div>
  );
}
