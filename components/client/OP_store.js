// Client org profile + anniversary gifts: the gate, the client's shared
// state and the API wrappers. Loads after OP_logic.js, before the OP_ .jsx.
//
// The gate (spec §1, preview-flag pattern): ONE resolver, OP_isOn().
//   - a person's own preview: localStorage mgb_orgprofile_preview === "1"
//     (Developer tools › Feature flags, "Client org profile + gifts (preview)")
//   - OR the firm switch tk_settings.org_profile_enabled (owner-only; code never
//     writes it). Staff read it from tk_settings here, and the last answer is
//     remembered per browser in mgb_orgprofile_cache. Clients cannot read
//     tk_settings: client_org_profile_mine() returns `enabled`, passed in as
//     OP_isOn(enabled).
// With the gate off nothing shows: no prompt, no Needs-you item, no ? entry,
// no staff card, no Client gifts tab, no onboarding step, no launch notice.

function OP__ls(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function OP__lsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (e) {}
}
function OP__ss(k) {
  try {
    return window.sessionStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function OP__ssSet(k, v) {
  try {
    window.sessionStorage.setItem(k, v);
  } catch (e) {}
}
function OP__sb() {
  return typeof window !== "undefined" ? window.mgbSupabase : null;
}
function OP__emit(name) {
  try {
    window.dispatchEvent(new Event(name));
  } catch (e) {}
}

function OP_previewOn() {
  return OP__ls("mgb_orgprofile_preview") === "1";
}

function OP__switchValue(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// Staff: one read of tk_settings.org_profile_enabled per page load, after
// sign-in (a read before sign-in sees nothing, so it waits for a session).
var OP__switch = { state: "idle" }; // idle | reading | done
function OP_readSwitch(force) {
  var c = OP__sb();
  if (!c || (!force && OP__switch.state !== "idle")) return;
  OP__switch.state = "reading";
  var fail = function () {
    OP__switch.state = "idle";
  };
  try {
    var go = function () {
      c.from("tk_settings")
        .select("value")
        .eq("key", "org_profile_enabled")
        .maybeSingle()
        .then(function (res) {
          if (!res || res.error) return fail();
          OP__switch.state = "done";
          var before = OP__ls("mgb_orgprofile_cache");
          OP__lsSet("mgb_orgprofile_cache", res.data && OP__switchValue(res.data.value) ? "1" : null);
          if (OP__ls("mgb_orgprofile_cache") !== before) OP__emit("mgb:orgprofile");
        }, fail);
    };
    if (c.auth && typeof c.auth.getSession === "function") {
      c.auth.getSession().then(function (r) {
        if (r && r.data && r.data.session) go();
        else fail();
      }, fail);
    } else go();
  } catch (e) {
    fail();
  }
}

// The one resolver. `serverEnabled` (a boolean) is the client RPC's answer;
// staff call it with nothing and get the cached tk_settings answer.
function OP_isOn(serverEnabled) {
  if (OP_previewOn()) return true;
  if (typeof serverEnabled === "boolean") return serverEnabled;
  if (OP__switch.state === "idle") OP_readSwitch();
  return OP__ls("mgb_orgprofile_cache") === "1";
}

// Re-render hook for staff UI: bumps when the switch cache or the preview
// flag changes.
function OP_useGate() {
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(function () {
    var on = function () {
      bump(function (n) {
        return n + 1;
      });
    };
    var onStorage = function (e) {
      if (!e || !e.key || /^mgb_orgprofile_/.test(e.key)) on();
    };
    window.addEventListener("mgb:orgprofile", on);
    window.addEventListener("storage", onStorage);
    return function () {
      window.removeEventListener("mgb:orgprofile", on);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return OP_isOn();
}

// ---- API wrappers (all through RLS / security-definer RPCs) --------------
function OP__rpc(name, args) {
  var c = OP__sb();
  if (!c) return Promise.resolve({ data: null, error: { message: "Not connected" } });
  return c.rpc(name, args || {}).then(
    function (res) {
      return res;
    },
    function (e) {
      return { data: null, error: e || { message: "Request failed" } };
    },
  );
}

var OP_api = {
  // Client: {eligible, enabled, profile, prefill, complete, has_get_to_know}
  mine: function () {
    return OP__rpc("client_org_profile_mine");
  },
  // Client: save, returns the same shape as mine().
  save: function (payload) {
    return OP__rpc("client_org_profile_save", { p: payload });
  },
  // Staff: one client's card.
  staffProfile: function (clientId) {
    return OP__rpc("staff_client_org_profile", { p_client_id: clientId });
  },
  // Staff: set or (null) reset Client since.
  setClientSince: function (clientId, iso) {
    return OP__rpc("staff_set_client_since", { p_client_id: clientId, p_date: iso || null });
  },
  // Admin: anniversaries in the next `days` days.
  upcoming: function (days) {
    return OP__rpc("admin_upcoming_anniversaries", { p_days: days || 30 });
  },
  // Admin: which anniversary the gift list follows ("client_since" | "established").
  giftBasis: function () {
    return OP__rpc("admin_gift_basis");
  },
  // Admin: save it (firm-wide, audited in tk_settings_audit).
  setGiftBasis: function (basis) {
    return OP__rpc("admin_set_gift_basis", { p_basis: basis });
  },
  // Admin (RLS): gifts already on record.
  gifts: function () {
    var c = OP__sb();
    if (!c) return Promise.resolve({ data: [], error: null });
    return c
      .from("client_gifts")
      .select("id,client_id,occasion,occasion_year,occasion_date,status,item,amount,notes,planned_by,sent_at,sent_by,updated_at")
      .order("occasion_date", { ascending: false })
      .limit(300);
  },
  // Admin (RLS): add a gift for one anniversary (planned, sent or skipped).
  addGift: function (row) {
    var c = OP__sb();
    if (!c) return Promise.resolve({ data: null, error: { message: "Not connected" } });
    return c
      .from("client_gifts")
      .insert({
        client_id: row.client_id,
        occasion: row.occasion,
        occasion_date: row.occasion_date,
        occasion_year: +String(row.occasion_date).slice(0, 4),
        status: row.status || "planned",
        item: row.item || null,
        amount: row.amount === "" || row.amount == null ? null : Number(row.amount),
        notes: row.notes || null,
      })
      .select()
      .maybeSingle();
  },
  // Admin (RLS): change a gift (status, item, amount, notes).
  updateGift: function (id, patch) {
    var c = OP__sb();
    if (!c) return Promise.resolve({ data: null, error: { message: "Not connected" } });
    return c.from("client_gifts").update(patch).eq("id", id).select().maybeSingle();
  },
  // Staff (RLS: clients they can open): which clients finished the profile.
  completedIds: function () {
    var c = OP__sb();
    if (!c) return Promise.resolve({ data: [], error: null });
    return c.from("client_org_profile").select("client_id,completed_at").not("completed_at", "is", null);
  },
};

// ---- The client's shared state (prompt, Needs-you item, ? menu) ----------
// One mine() call per page load for a real client session. With the gate off
// the answer simply hides everything.
var OP_mine = (function () {
  var state = { status: "idle", data: null }; // idle | loading | ready | error
  var subs = [];
  var set = function (patch) {
    state = Object.assign({}, state, patch);
    subs.slice().forEach(function (fn) {
      try {
        fn(state);
      } catch (e) {}
    });
  };
  return {
    get: function () {
      return state;
    },
    subscribe: function (fn) {
      subs.push(fn);
      return function () {
        subs = subs.filter(function (x) {
          return x !== fn;
        });
      };
    },
    load: function (force) {
      if (!force && (state.status === "loading" || state.status === "ready")) return;
      set({ status: "loading" });
      OP_api.mine().then(function (res) {
        if (res && !res.error) set({ status: "ready", data: res.data || { eligible: false } });
        else set({ status: "error", data: null });
      });
    },
    // After a save: the RPC returns the fresh mine() shape.
    setData: function (data) {
      set({ status: "ready", data: data });
    },
  };
})();

// Should the form be offered at all? eligible AND (switch or preview).
// Decided on the RPC's `eligible`, never on resolveAccess().isFullAccess.
function OP_clientGate(st) {
  var d = st && st.status === "ready" ? st.data : null;
  if (!d || !d.eligible) return { on: false, data: d };
  return { on: OP_isOn(!!d.enabled), data: d, complete: !!d.complete };
}

function OP_laterKey(email) {
  return "mgb_op_later:" + String(email || "").toLowerCase();
}
function OP_laterSet(email) {
  OP__ssSet(OP_laterKey(email), "1");
}
function OP_laterOn(email) {
  return OP__ss(OP_laterKey(email)) === "1";
}

// Open the form (from Needs you or the ? menu). OP_ClientPrompt listens.
function OP_openForm() {
  OP__emit("mgb:op-open");
}

// Hook: the client's shared state. `active` is the real-client check
// (clientPortalUser && !isStaffSession && !impersonating && !isPreviewingUser).
function OP_useMine(active) {
  var s = React.useState(OP_mine.get());
  var st = s[0];
  var setSt = s[1];
  React.useEffect(
    function () {
      if (!active) return undefined;
      var off = OP_mine.subscribe(setSt);
      OP_mine.load();
      setSt(OP_mine.get());
      return off;
    },
    [active],
  );
  return active ? st : { status: "idle", data: null };
}

// Needs you item (CLIENT_HomeTop), or null.
function OP_useNeedsItem(active) {
  var g = OP_clientGate(OP_useMine(active));
  if (!active || !g.on || g.complete) return null;
  return {
    key: "op-profile",
    text: "Finish your organization profile",
    sub: "A few details so we can mark your milestones with you.",
    action: "Finish",
    onClick: OP_openForm,
  };
}

// ? menu item (CLIENT_HelpButton), or null. Shown while the gate is on and
// the person is eligible, complete or not, so they can update it.
function OP_useHelpItem(active) {
  var g = OP_clientGate(OP_useMine(active));
  if (!active || !g.on) return null;
  return { key: "op-profile", label: "Organization profile", run: OP_openForm };
}

// For the client tour (Tour.jsx): hold the auto-start while the prompt is
// open, or may be about to open (mine() still loading for someone whose gate
// is known to be on: their preview flag, or the last answer this browser saw).
function OP_promptPending() {
  try {
    if (document.getElementById("op-prompt")) return true;
  } catch (e) {}
  var st = OP_mine.get();
  if (st.status === "loading" || st.status === "idle") {
    return OP_previewOn() || OP__ls("mgb_orgprofile_client_cache") === "1";
  }
  return false;
}

// Remember the last `enabled` a real client saw (only for OP_promptPending).
OP_mine.subscribe(function (st) {
  if (st.status !== "ready" || !st.data || !st.data.eligible) return;
  OP__lsSet("mgb_orgprofile_client_cache", st.data.enabled ? "1" : null);
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = { OP_isOn: OP_isOn, OP_clientGate: OP_clientGate, OP_laterKey: OP_laterKey, OP_promptPending: OP_promptPending, OP_mine: OP_mine };
}
