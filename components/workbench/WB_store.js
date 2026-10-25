// ----------------------------------------------------------------------------
// WB_store: the one Workbench data path (spec F). The Today page, the bottom
// drawer and the rail badge all read this store, so one fetch feeds them all.
//
// Reads rpc("wb_inbox") under the signed-in staff member's JWT; the server
// decides what each person may see. Refetches (debounced 1.5 s) on Realtime
// changes to client_messages and staff_reminders, on the app's change events,
// on focus, on a 2-minute poll while the tab is visible, and when another
// window says so over BroadcastChannel("mgb-wb").
//
// Writes (snooze, No reply needed, Mark checked, Start) change the store at
// once and roll back on error; each one offers a 5-second Undo.
//
// The switch: tk_settings.wb_enabled (never set by code); "Classic Today"
// (mgb_wb_classic = "1") turns it off for that person. The per-person preview
// checkbox (mgb_wb_preview) was retired 2026-10-25, once the switch was on for
// everyone: if the switch is ever turned off, the Desk is off for everyone.
// Until the switch is read, the last answer is remembered per browser
// (mgb_wb_on_cache).
//
// Browser file; loads after WB_logic.js. Uses window.mgbSupabase, TK_api,
// MGB_track at call time only.
// ----------------------------------------------------------------------------

var WB_EVENTS = [
  "mgb:client-messages-changed",
  "mgb:staff-items-changed",
  "mgb:gl-review-changed",
  "mgb:ledger-review-changed",
  "mgb:files-changed",
  "mgb:docs-changed",
  "mgb:client-requests-changed",
  "mgb:tk-requests-changed",
  "mgb:txn-questions-changed",
  "mgb:tk-coverage-changed",
];
var WB_DEBOUNCE_MS = 1500;
var WB_UNDO_MS = 5000;

function WB__ls(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function WB__lsSet(key, val) {
  try {
    if (val == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, val);
  } catch (e) {}
}
function WB_toast(text) {
  try {
    window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text: String(text) } }));
  } catch (e) {}
}
function WB_track(name, detail) {
  try {
    if (typeof window.MGB_track === "function") window.MGB_track(name, detail);
  } catch (e) {}
}

// ---- Client tab pins and recents (H4) ----
// Pins: mgb_wb_pins:<email> (WB_pinsKey), this browser only. Recents are the
// client switcher's own list (CS_readRecent / CS_pushRecent, per person), so
// a client picked here also shows as recent in the switcher.
function WB_pinsRead(email) {
  var k = WB_pinsKey(email);
  return k ? WB_pinsParse(WB__ls(k)) : [];
}
function WB_pinsWrite(email, pins) {
  var k = WB_pinsKey(email);
  var clean = WB_pinsClean(pins);
  if (k) WB__lsSet(k, clean.length ? WB_pinsSerialize(clean) : null);
  return clean;
}
// Pin or unpin one client. Returns { pins, on, dropped } (WB_pinsToggle).
// current: the pins on screen (the tab's state). The toggle works from them,
// not from storage, and the write is best effort, so pin and unpin still work
// for this visit when the browser blocks localStorage.
function WB_pinToggle(email, id, current) {
  var r = WB_pinsToggle(Array.isArray(current) ? current : WB_pinsRead(email), id);
  r.pins = WB_pinsClean(r.pins);
  try {
    WB_pinsWrite(email, r.pins);
  } catch (e) {}
  WB_track("wb-pin", r.on ? "on" : "off");
  // Same-tab sync: the Desk's Client tab and the staff sidebar (L1) both show
  // pins and read them once, so each listens for this and re-reads.
  try {
    window.dispatchEvent(new CustomEvent("mgb:wb-pins", { detail: { email: String(email == null ? "" : email).trim().toLowerCase() } }));
  } catch (e) {}
  return r;
}
function WB__recentKey(email) {
  var e = String(email == null ? "" : email).trim().toLowerCase();
  if (!e || typeof CS_RECENT_KEY !== "string") return null;
  return CS_RECENT_KEY + ":" + e;
}
function WB_recentsRead(email) {
  var k = WB__recentKey(email);
  return k && typeof CS_readRecent === "function" ? CS_readRecent(k) : [];
}
function WB_recentsPush(email, id) {
  var k = WB__recentKey(email);
  if (!k || typeof CS_pushRecent !== "function" || id == null || id === "") return WB_recentsRead(email);
  return CS_pushRecent(k, String(id));
}

var WB_store = (function () {
  var listeners = [];
  var state = {
    on: WB__ls("mgb_wb_on_cache") === "1", // last known switch; confirmed by readFlag()
    flagKnown: false,
    status: "idle", // idle | loading | ready | error | missing
    rows: [],
    error: null,
    at: 0, // last good fetch (ms)
    offline: typeof navigator !== "undefined" && navigator.onLine === false,
    scope: "mine",
    me: "",
    isAdmin: false,
    undo: null, // { id, text, run, until }
    drawerOpen: false,
    openedBy: "", // who opened the Desk last: "restore" (page load reopen) keeps focus where it is (spec 4.2)
    desk: WB_deskParse(null), // R1 column width, saved per person in mgb_wb_desk:<email> v2 (no TTL)
    hub: WB_hubDefault(), // tab, chip, client, scroll per tab (spec 2.2); saved per person in mgb_wb_hub:<email>
    // R2 task view (spec 5.2): the drill stack [{ id, from, focus }] (the shown
    // task last), how it started (closeOnEmpty: the Desk was closed, so leaving
    // the last task closes it again; tab: the Desk tab underneath) and when the
    // Desk closed with a task showing (kept 5 minutes, WB_drillKept). Never saved.
    drill: [],
    drillOrigin: { closeOnEmpty: false, tab: "" },
    drillClosedAt: 0,
  };
  var users = 0;
  var timer = null;
  var poll = null;
  var channel = null;
  var bc = null;
  var inflight = null;
  var again = false;
  var undoTimer = null;
  var cleanups = [];
  var hubTimer = null;
  var hubUser = ""; // whose saved hub (mgb_wb_hub:<email>) the hub state belongs to

  function emit() {
    listeners.slice().forEach(function (fn) {
      try {
        fn(state);
      } catch (e) {}
    });
  }
  function set(patch) {
    state = Object.assign({}, state, patch);
    emit();
  }
  function sb() {
    return typeof window !== "undefined" ? window.mgbSupabase : null;
  }

  function classicOn() {
    return WB__ls("mgb_wb_classic") === "1";
  }

  // Reads the switch once per configure and after a Dev Tools flag change.
  function readFlag() {
    var c = sb();
    var local = function (v) {
      var on = WB_isOn(v, classicOn());
      WB__lsSet("mgb_wb_on_cache", on ? "1" : null);
      var was = state.on;
      set({ on: on, flagKnown: true });
      if (on && !was && users > 0) refresh();
    };
    if (!c) return local(undefined);
    c.from("tk_settings")
      .select("value")
      .eq("key", "wb_enabled")
      .maybeSingle()
      .then(
        function (res) {
          local(res && !res.error && res.data ? res.data.value : undefined);
        },
        function () {
          local(undefined);
        },
      );
  }

  function isMissing(err) {
    var code = err && (err.code || "");
    var msg = String((err && err.message) || "");
    return code === "PGRST202" || code === "42883" || /wb_inbox/.test(msg) && /not find|does not exist/i.test(msg);
  }

  function curScope() {
    return state.isAdmin && state.scope === "everyone" ? "everyone" : "mine";
  }
  function isForbidden(err) {
    return (err && err.code === "42501") || /wb_forbidden/.test(String((err && err.message) || ""));
  }

  // Owner rule (month rhythm): mark overdue task rows whose client's month
  // went out preliminary (TK_lateExcused), so they never count as late.
  // No preliminary month for any client on the list: no extra read.
  // Month rhythm only: with the preview/switch off nothing changes and no
  // extra read is made.
  function excuse(rows) {
    if (typeof TK_rhythmEnabled !== "function" || !TK_rhythmEnabled()) return;
    if (typeof WB_excuseCandidates !== "function" || typeof TK_api === "undefined" || !TK_api.loadReportStates) return;
    var c = sb();
    if (!c) return;
    TK_api.loadReportStates().then(function () {
      if (state.rows !== rows) return;
      var keys = typeof TK_reportStateCache !== "undefined" ? TK_reportStateCache.keys : {};
      var ids = WB_excuseCandidates(rows, WB_today(), keys);
      if (!ids.length) return null;
      return c.from("staff_reminders").select("id, client_id, period_kind, period_start, status").in("id", ids).then(function (res) {
        if (res.error || state.rows !== rows) return;
        var ok = (res.data || []).filter(function (t) {
          return typeof TK_lateExcused === "function" && TK_lateExcused(t);
        }).map(function (t) {
          return String(t.id);
        });
        var next = WB_applyExcused(rows, ok);
        if (next !== rows) set({ rows: next });
      });
    }).catch(function () {});
  }

  function refresh() {
    var c = sb();
    if (!c || !state.on || !state.me) return Promise.resolve();
    if (inflight) {
      again = true;
      return inflight;
    }
    if (state.status !== "ready") set({ status: state.rows.length ? state.status : "loading" });
    var scope = curScope();
    // A response for another person or scope (the scope or user changed while
    // it was in flight) is dropped, and the list is fetched again.
    var stamp = state.me + "|" + scope;
    var stale = function () {
      if (stamp === state.me + "|" + curScope()) return false;
      again = true;
      return true;
    };
    inflight = c
      .rpc("wb_inbox", { p_scope: scope })
      .then(function (res) {
        if (res.error) throw res.error;
        if (stale()) return;
        set({ rows: res.data || [], status: "ready", error: null, at: Date.now(), offline: false });
        excuse(state.rows);
      })
      .catch(function (err) {
        if (stale()) return;
        if (scope === "everyone" && isForbidden(err)) {
          // Everyone is for admins only; fall back to Mine and remember it.
          WB__lsSet("mgb_wb_scope_" + state.me, "mine");
          set({ scope: "mine", rows: [], at: 0, status: "loading" });
          again = true;
          return;
        }
        if (isMissing(err)) set({ status: "missing", error: null });
        else
          set({
            status: state.rows.length || state.at ? "ready" : "error",
            error: err || { message: "error" },
            offline: typeof navigator !== "undefined" && navigator.onLine === false,
          });
      })
      .then(function () {
        inflight = null;
        if (again) {
          again = false;
          return refresh();
        }
      });
    return inflight;
  }

  function soon() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      if (!document.hidden) refresh();
    }, WB_DEBOUNCE_MS);
  }

  function post() {
    try {
      if (bc) bc.postMessage({ t: "changed", at: Date.now() });
    } catch (e) {}
  }

  function wire() {
    var c = sb();
    WB_EVENTS.forEach(function (name) {
      window.addEventListener(name, soon);
      cleanups.push(function () {
        window.removeEventListener(name, soon);
      });
    });
    var onFocus = function () {
      if (!document.hidden && Date.now() - state.at > 20000) refresh();
    };
    var onOnline = function () {
      set({ offline: false });
      refresh();
    };
    var onOffline = function () {
      set({ offline: true });
    };
    var onFlags = function () {
      readFlag();
    };
    // Another tab changed a Workbench flag (or cleared storage).
    var onStorage = function (e) {
      if (!e || !e.key || /^mgb_wb_(preview|classic)$/.test(e.key)) readFlag();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("mgb:feature-flags-changed", onFlags);
    window.addEventListener("storage", onStorage);
    cleanups.push(function () {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("mgb:feature-flags-changed", onFlags);
      window.removeEventListener("storage", onStorage);
    });
    poll = setInterval(function () {
      if (!document.hidden && state.on) refresh();
    }, WB_REFRESH_MS);
    try {
      if (typeof BroadcastChannel === "function") {
        bc = new BroadcastChannel("mgb-wb");
        bc.onmessage = soon;
      }
    } catch (e) {
      bc = null;
    }
    if (c && typeof c.channel === "function") {
      try {
        channel = c
          .channel("wb-" + state.me + "-" + Math.random().toString(36).slice(2, 8), { config: { private: true } })
          .on("postgres_changes", { event: "*", schema: "public", table: "client_messages" }, soon)
          .on("postgres_changes", { event: "*", schema: "public", table: "staff_reminders" }, soon)
          .subscribe();
      } catch (e) {
        channel = null;
      }
    }
  }
  function unwire() {
    cleanups.forEach(function (f) {
      f();
    });
    cleanups = [];
    if (poll) clearInterval(poll);
    poll = null;
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      if (bc) bc.close();
    } catch (e) {}
    bc = null;
    var c = sb();
    try {
      if (channel && c) c.removeChannel(channel);
    } catch (e) {}
    channel = null;
  }

  // A mount (page, drawer, badge) joins; the last one out tears down.
  function join(me, isAdmin) {
    var email = String(me || "").toLowerCase();
    var changed = email !== state.me || !!isAdmin !== state.isAdmin;
    adoptHub(email);
    if (changed) {
      var scope = isAdmin && WB__ls("mgb_wb_scope_" + email) === "everyone" ? "everyone" : "mine";
      set({ me: email, isAdmin: !!isAdmin, scope: scope, rows: email === state.me ? state.rows : [], at: email === state.me ? state.at : 0 });
    }
    users++;
    if (users === 1) {
      wire();
      readFlag();
    }
    if (state.on && (changed || !state.at)) refresh();
    return function leave() {
      users = Math.max(0, users - 1);
      if (users === 0) unwire();
    };
  }

  function setScope(scope) {
    if (!state.isAdmin) return;
    var s = scope === "everyone" ? "everyone" : "mine";
    if (s === state.scope) return;
    WB__lsSet("mgb_wb_scope_" + state.me, s);
    set({ scope: s, rows: [], at: 0, status: "loading" });
    WB_track("wb-scope", s);
    refresh();
  }

  // ---- optimistic writes ----------------------------------------------------
  function patchRow(key, patch) {
    var before = null;
    var rows = state.rows.map(function (r) {
      if (r.item_key !== key) return r;
      before = r;
      return Object.assign({}, r, patch);
    });
    set({ rows: rows });
    return before;
  }
  function restoreRow(before) {
    if (!before) return;
    set({
      rows: state.rows.map(function (r) {
        return r.item_key === before.item_key ? before : r;
      }),
    });
  }
  function offerUndo(text, run) {
    if (undoTimer) clearTimeout(undoTimer);
    var id = Date.now();
    set({ undo: { id: id, text: text, run: run, until: id + WB_UNDO_MS } });
    undoTimer = setTimeout(function () {
      if (state.undo && state.undo.id === id) set({ undo: null });
    }, WB_UNDO_MS);
  }
  function runUndo() {
    var u = state.undo;
    if (!u) return;
    set({ undo: null });
    try {
      u.run();
    } catch (e) {}
  }
  function dismissUndo() {
    set({ undo: null });
  }
  function rpc(name, args) {
    var c = sb();
    if (!c) return Promise.reject(new Error("offline"));
    return c.rpc(name, args).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }
  function failed(what, err) {
    var offline = typeof navigator !== "undefined" && navigator.onLine === false;
    WB_toast(offline ? "You're offline. " + what + " didn't save." : what + " didn't save. Try again.");
    if (err && window.console) console.warn("[wb]", what, err);
  }
  function done() {
    post();
    soon();
  }

  function snooze(row, preset, pick) {
    var until = WB_snoozeUntil(preset, Date.now(), pick);
    if (!row || !until) return Promise.resolve(false);
    var before = patchRow(row.item_key, { snoozed_until: until, snoozed_version: row.version });
    WB_track("wb-snooze", (row.kind || "other") + ":" + preset);
    return rpc("wb_snooze", { p_item_key: row.item_key, p_version: row.version || null, p_until: until }).then(
      function () {
        offerUndo("Snoozed.", function () {
          unsnooze(row);
        });
        done();
        return true;
      },
      function (err) {
        restoreRow(before);
        failed("The snooze", err);
        return false;
      },
    );
  }
  function unsnooze(row) {
    if (!row) return Promise.resolve(false);
    var before = patchRow(row.item_key, { snoozed_until: null, snoozed_version: null });
    return rpc("wb_unsnooze", { p_item_key: row.item_key }).then(
      function () {
        done();
        return true;
      },
      function (err) {
        restoreRow(before);
        failed("Unsnooze", err);
        return false;
      },
    );
  }
  function noReply(row) {
    if (!row || row.kind !== "message" || !row.ref_id) return Promise.resolve(false);
    var before = patchRow(row.item_key, { cleared: true });
    return rpc("wb_mark_no_reply", { p_message_id: row.ref_id }).then(
      function (id) {
        WB_track("wb-noreply", "manual");
        offerUndo("Marked no reply needed.", function () {
          rpc("wb_undo_no_reply", { p_id: id }).then(
            function () {
              restoreRow(before);
              WB_track("wb-noreply", "undo");
              try {
                window.dispatchEvent(new Event("mgb:client-messages-changed"));
              } catch (e) {}
              done();
            },
            function (err) {
              failed("Undo", err);
            },
          );
        });
        try {
          window.dispatchEvent(new Event("mgb:client-messages-changed"));
        } catch (e) {}
        done();
        return true;
      },
      function (err) {
        restoreRow(before);
        var code = String((err && err.message) || "");
        if (/wb_not_latest/.test(code)) {
          WB_toast("A newer message came in. Have a look first.");
          refresh();
        } else failed("No reply needed", err);
        return false;
      },
    );
  }
  function fileChecked(row) {
    if (!row || row.kind !== "doc_upload") return Promise.resolve(false);
    var before = patchRow(row.item_key, { cleared: true });
    return rpc("wb_mark_file_checked", { p_file_id: row.source_id, p_note: null }).then(
      function (id) {
        WB_track("wb-action", "doc_upload:checked");
        offerUndo("Marked checked.", function () {
          rpc("wb_undo_file_checked", { p_id: id }).then(
            function () {
              restoreRow(before);
              done();
            },
            function (err) {
              failed("Undo", err);
            },
          );
        });
        done();
        return true;
      },
      function (err) {
        restoreRow(before);
        failed("Mark checked", err);
        return false;
      },
    );
  }
  // Start a to-do task in place (tk_set_status through TK_api, which raises
  // its own toasts and change events).
  function startTask(row) {
    if (!row || row.kind !== "task" || typeof TK_api === "undefined" || !TK_api.setStatus) return Promise.resolve(false);
    var before = patchRow(row.item_key, { status: "in_progress" });
    WB_track("wb-action", "task:start");
    return TK_api.setStatus(row.source_id, "in_progress").then(
      function () {
        offerUndo("Started.", function () {
          TK_api.setStatus(row.source_id, "todo").then(
            function () {
              restoreRow(before);
              done();
            },
            function (err) {
              failed("Undo", err);
            },
          );
        });
        done();
        return true;
      },
      function (err) {
        restoreRow(before);
        failed("Start", err);
        return false;
      },
    );
  }

  // ---- Hub state (spec 2.2): survives route changes because the store is a
  // module singleton; saved per signed-in person in localStorage
  // (mgb_wb_hub:<email>, try/catch) so a reload keeps the tab, chip and
  // scroll and another person on this browser never inherits them. Writes are
  // throttled to one per 500 ms and flushed when the page is hidden.
  function hubHash() {
    try {
      return window.location && window.location.hash ? String(window.location.hash) : "";
    } catch (e) {
      return "";
    }
  }
  function saveHub() {
    if (hubTimer || !hubUser) return;
    hubTimer = setTimeout(flushHub, 500);
  }
  function flushHub() {
    if (hubTimer) clearTimeout(hubTimer);
    hubTimer = null;
    if (!hubUser) return; // nobody signed in to this store yet: nothing to save
    var h = Object.assign({}, state.hub, { open: state.drawerOpen });
    WB__lsSet(WB_hubKey(hubUser), WB_hubSerialize(h, Date.now(), hubHash()));
  }
  // patch: { tab, chip, clientId, scroll: { tab: n }, collapsed: { group: b },
  // lastFocus }. silent saves without re-rendering (scroll position, focus row).
  function setHub(patch, silent) {
    var next = WB_hubMerge(state.hub, patch);
    var hub = Object.assign({}, next, { open: state.drawerOpen });
    if (silent) state.hub = hub;
    else set({ hub: hub });
    saveHub();
  }
  // by: "bar" | "key" | "drag" | "restore" | "" (who opened it; the focus
  // rule reads it). Closing clears it.
  function setDrawerOpen(open, by) {
    if (!!open === state.drawerOpen) return;
    var patch = { drawerOpen: !!open, openedBy: open ? String(by || "") : "" };
    // Closing with a task showing keeps the stack (D in the task view, a page
    // change); reopening within 5 minutes shows that task again, later the list.
    if (!open && state.drill.length) patch.drillClosedAt = Date.now();
    if (open && state.drill.length && !WB_drillKept(state.drillClosedAt, Date.now())) {
      patch.drill = [];
      patch.drillOrigin = { closeOnEmpty: false, tab: "" };
    }
    if (open) patch.drillClosedAt = 0;
    set(patch);
    if (!open) flushHub();
    else saveHub();
  }
  // R2: open a task in the Desk's task view (TK_openTaskRoute). opts: { from,
  // focus }. A Desk that was closed opens (openedBy "drill") and remembers to
  // close again when the last task is left; one that was open goes back to its
  // list. A closed Desk always starts a new stack (a kept one is dropped).
  function drill(id, opts) {
    if (id == null || id === "") return false;
    var o = opts || {};
    var wasOpen = state.drawerOpen;
    var base = wasOpen ? state.drill : [];
    var origin = base.length ? state.drillOrigin : { closeOnEmpty: !wasOpen, tab: state.hub.tab };
    var next = WB_drillPush(base, { id: id, from: o.from || "", focus: o.focus || null });
    var patch = { drill: next, drillOrigin: origin, drillClosedAt: 0 };
    if (!wasOpen) {
      patch.drawerOpen = true;
      patch.openedBy = "drill";
    }
    set(patch);
    if (!wasOpen) saveHub();
    return true;
  }
  // Back one level (Esc, the back button). Returns the depth left.
  function drillBack() {
    if (!state.drill.length) return 0;
    var next = WB_drillPop(state.drill);
    set({ drill: next });
    return next.length;
  }
  // Leave the task view for the list (Close details, the Desk closing for good).
  function drillClear() {
    if (!state.drill.length && !state.drillClosedAt) return;
    set({ drill: [], drillOrigin: { closeOnEmpty: false, tab: "" }, drillClosedAt: 0 });
  }
  // The first read of a person's saved hub, when they join (and again if
  // someone else signs in without a reload). The old unscoped key is never
  // read; it is removed so nobody can inherit it. Reopens only inside the
  // freshness window, on the same page, and not on an arrival link.
  function adoptHub(email) {
    if (!email || email === hubUser) return;
    if (hubUser) flushHub(); // the previous person's state goes to their own key
    else if (hubTimer) {
      clearTimeout(hubTimer);
      hubTimer = null;
    }
    hubUser = email;
    WB__lsSet(WB_HUB_KEY, null);
    var h = WB_hubParse(WB__ls(WB_hubKey(email)), Date.now(), { hash: hubHash() });
    var raw = WB__ls(WB_deskKey(email));
    var d = WB_deskParse(raw);
    // Migration: a v1 (D3 bottom height) or junk value is rewritten as v2 once.
    if (raw != null && raw !== WB_deskSerialize(d)) WB__lsSet(WB_deskKey(email), WB_deskSerialize(d));
    set({ hub: h, drawerOpen: h.open, openedBy: h.open ? "restore" : "", desk: d, drill: [], drillOrigin: { closeOnEmpty: false, tab: "" }, drillClosedAt: 0 });
  }
  // R1: the column width the person wants (re-clamped to each window when
  // applied). Saved at once, no throttle: it changes only when a drag ends or
  // a key is pressed on the grip.
  function setDeskWidth(w) {
    var n = Number(w);
    var d = WB_deskParse({ v: 2, right: { w: isFinite(n) ? n : state.desk.right.w } });
    if (d.right.w !== state.desk.right.w) set({ desk: d });
    if (hubUser) WB__lsSet(WB_deskKey(hubUser), WB_deskSerialize(d));
  }

  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("pagehide", flushHub);
  }

  return {
    getState: function () {
      return state;
    },
    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (f) {
          return f !== fn;
        });
      };
    },
    join: join,
    refresh: refresh,
    readFlag: readFlag,
    setScope: setScope,
    snooze: snooze,
    unsnooze: unsnooze,
    noReply: noReply,
    fileChecked: fileChecked,
    startTask: startTask,
    runUndo: runUndo,
    dismissUndo: dismissUndo,
    setDrawerOpen: setDrawerOpen,
    setHub: setHub,
    flushHub: flushHub,
    adoptHub: adoptHub,
    setDeskWidth: setDeskWidth,
    drill: drill,
    drillBack: drillBack,
    drillClear: drillClear,
  };
})();

// React hook: the store's state, re-rendering on change. join=true also
// keeps the data path running while the component is mounted.
function WB_useStore(me, isAdmin, join) {
  var pair = React.useState(WB_store.getState());
  var setS = pair[1];
  React.useEffect(function () {
    var off = WB_store.subscribe(function (s) {
      setS(s);
    });
    setS(WB_store.getState());
    return off;
  }, []);
  React.useEffect(
    function () {
      if (!join || !me) return undefined;
      return WB_store.join(me, isAdmin);
    },
    [join, me, isAdmin],
  );
  return pair[0];
}

// Follow the item's link (spec D2) and record the action.
function WB_go(row, action) {
  var link = WB_linkTarget(row, action);
  if (!link) return;
  WB_track("wb-action", (row.kind || "other") + ":" + (action === "request" ? "request" : row.kind === "message" ? "reply" : "open"));
  // Decision 11 (R2): in push layout the Desk is part of the page and stays
  // open across the move; an overlay or the phone sheet covers the page, so it
  // closes. WB_Drawer sets html.wb-desk-push.
  var push = false;
  try {
    push = document.documentElement.classList.contains("wb-desk-push");
  } catch (e) {}
  if (!push) {
    try {
      WB_store.setDrawerOpen(false);
    } catch (e) {}
  }
  if (typeof LK_go === "function") LK_go(link.t, link.hint || null);
  else if (typeof LK_href === "function") window.location.hash = LK_href(link.t);
}

// True when the task drawer will really open (its data is ready and its host
// is mounted), the same test TK_openTask makes. Otherwise TK_openTask would
// send the browser to the Tasks page instead.
function WB__taskDrawerReady() {
  if (typeof TK_openTask !== "function") return false;
  var host = false;
  try {
    host = window.TK_drawerHostReady === true;
  } catch (e) {}
  if (typeof TK_dlOpenTarget !== "function") return host;
  var st = null;
  try {
    st = typeof TK_dwState === "function" ? TK_dwState() : null;
  } catch (e) {}
  return TK_dlOpenTarget({ schema: st ? st.schema : "unknown", hostReady: host }) === "drawer";
}

// Opens the task drawer in place and says whether it really opened.
// TK_DrawerHost answers tk:open-task with tk:drawer-open inside the same
// dispatch (listeners run synchronously), so the answer is known when
// TK_openTask returns. false: nothing took the request.
function WB__openTaskInPlace(taskId) {
  var id = String(taskId);
  var took = false;
  var on = function (e) {
    if (e && e.detail && String(e.detail.id) === id) took = true;
  };
  try {
    window.addEventListener("tk:drawer-open", on);
  } catch (e) {}
  try {
    TK_openTask(id, { from: "wb-hub" });
  } catch (e) {}
  try {
    window.removeEventListener("tk:drawer-open", on);
  } catch (e) {}
  return took;
}

// Asks the app to open the staff chat drawer on a client and person
// (listener in app.jsx). The listener sets detail.handled = true when it took
// the request; it declines when staff chat isn't available (View as, preview,
// the Inbox page itself). dispatchEvent runs listeners synchronously, so the
// answer is known as soon as it returns.
function WB__openChat(clientId, email) {
  var detail = { clientId: clientId || null, email: email || null, handled: false };
  try {
    window.dispatchEvent(new CustomEvent("mgb:open-chat", { detail: detail }));
  } catch (e) {}
  return detail.handled === true;
}

// Opens a client file in Google Drive in a new browser tab through the same
// link helper as the Files tab (DRV_link). The tab is opened first, inside the
// click, so a pop-up blocker lets it through, then pointed at the link when it
// arrives. Resolves true when the file was opened, false after a toast.
// opts (optional; leaving it out keeps the Inbox behavior exactly):
//   failHint: what to try next, said after "Couldn't open that file" in place
//             of the Inbox's "Open full page in the ⋯ menu" (for rows with no
//             ⋯ menu, e.g. the Desk Client tab's Recent files);
//   track:    false skips the wb-action:doc_upload:open-in-drive event.
function WB__openDriveFile(fileId, opts) {
  var o = opts || {};
  var hint = typeof o.failHint === "string" && o.failHint ? o.failHint : null;
  if (typeof DRV_link !== "function") return Promise.resolve(false);
  var win = null;
  try {
    win = window.open("", "_blank");
    if (win) win.opener = null;
  } catch (e) {
    win = null;
  }
  var giveUp = function (text) {
    try {
      if (win) win.close();
    } catch (e) {}
    WB_toast(text);
    return false;
  };
  // The tab has to open inside the click. If the browser refused it, a second
  // open once the link arrives would be refused too, so say so now.
  if (!win) return Promise.resolve(giveUp("Your browser blocked the new tab. Allow pop-ups for this site, then try again."));
  return Promise.resolve()
    .then(function () {
      return DRV_link(fileId);
    })
    .then(
      function (url) {
        if (!/^https:\/\//i.test(String(url || ""))) return giveUp(hint ? "Couldn't open that file. " + hint : "Couldn't open that file. Try Open full page in the ⋯ menu.");
        win.location.href = url;
        if (o.track !== false) WB_track("wb-action", "doc_upload:open-in-drive");
        return true;
      },
      function (err) {
        return giveUp("Couldn't open that file: " + String((err && err.message) || "try again in a moment") + (hint ? ". " + hint : ". Open full page is in the ⋯ menu."));
      },
    );
}

// Hub rows (spec 2.4, H3). While the hub is open, the page underneath never
// changes for:
//   - a task or review: the task drawer opens on top;
//   - a client message: the staff chat drawer opens on top, on that person;
//   - a new client file: it opens in Drive in a new tab (the hub stays).
// Anything else, a hub that is closed (Today's own list), a task drawer that
// can't open or a chat drawer the app declines goes where it lives as before
// (WB_go logs it as a normal open). Returns true when the item was opened in
// place. lastFocus lets the hub give focus back to the row when the drawer
// closes.
function WB_hubOpen(row, action) {
  var a = WB_hubAction(row);
  var open = WB_store.getState().drawerOpen;
  if (a.type === "task" && open && WB__taskDrawerReady()) {
    WB_store.setHub({ lastFocus: row.item_key }, true);
    if (WB__openTaskInPlace(a.taskId)) {
      WB_track("wb-action", (row.kind || "other") + ":open-in-place");
      return true;
    }
    // The drawer host did not take it: go to the task's page (below) rather
    // than leave the click doing nothing.
  }
  if (a.type === "chat" && open) {
    WB_store.setHub({ lastFocus: row.item_key }, true);
    if (WB__openChat(a.clientId, a.email)) {
      WB_track("wb-action", "message:reply-in-place");
      return true;
    }
  }
  if (a.type === "file" && open && typeof DRV_link === "function") {
    WB_store.setHub({ lastFocus: row.item_key }, true);
    WB__openDriveFile(a.fileId);
    return true;
  }
  WB_go(row, action || "open");
  return false;
}
