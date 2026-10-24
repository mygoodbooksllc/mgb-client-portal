// Flagged clients: the two test orgs (basic-test, grace-community; clients.test_only)
// and MGB (internal) (clients.is_internal). ONE helper for every client list and
// picker in the app, so they all sort and label these the same way:
//
//   CF_flag(c)            "internal" | "test" | null
//   CF_sort(list)         normal clients first (order kept), then Test, then Internal
//   CF_Badge              the small "Test" / "Internal" pill beside a name
//   CF_label(c)           plain-text "Name · Test" for <option>s, which can't hold a badge
//   CF_useShowTest(email) the shared "Show test clients" switch, remembered per person
//   CF_Toggle             the switch itself (Clients page header + client switcher)
//   CF_pick(list, opts)   sort, and hide test clients while the switch is off
//
// The switch is OFF by default. Off hides test clients from lists and pickers for
// EVERYONE, assigned or not, except the client they have open right now (so the
// picker never loses its place). Search, direct links and View as still reach them. It never changes what a person is ALLOWED to
// open (routes, links and permissions are untouched), and it never decides who
// sees MGB (internal): that stays with the per-admin permission.
//
// Stored in localStorage as "mgb-show-test-clients:<email>" (covered by Dev
// Tools' "Reset local state", which clears every mgb- key).

const CF_KEY_PREFIX = "mgb-show-test-clients:";
const CF_EVENT = "mgb:show-test-clients-changed";

function CF_flag(c) {
  if (!c) return null;
  if (c.isInternal === true) return "internal";
  if (c.testOnly === true) return "test";
  return null;
}

function CF_rank(c) {
  const f = CF_flag(c);
  return f === "internal" ? 2 : f === "test" ? 1 : 0;
}

// Stable: inside each group the incoming order (usually A to Z) is kept.
// getClient: optional, for rows that wrap a client (row => row.c).
function CF_sort(list, getClient) {
  const pick = typeof getClient === "function" ? getClient : (x) => x;
  return (list || [])
    .map((c, i) => [c, i])
    .sort((a, b) => CF_rank(pick(a[0])) - CF_rank(pick(b[0])) || a[1] - b[1])
    .map((p) => p[0]);
}

// Ids of every test client and MGB (internal) in the roster, for aggregates that
// work from rows keyed by client_id (hours, tasks, assignments).
function CF_excludedIds() {
  const out = new Set();
  (window.CLIENTS || []).forEach((c) => {
    if (c && (c.testOnly === true || c.isInternal === true)) out.add(c.id);
  });
  return out;
}

function CF_badgeText(c) {
  const f = CF_flag(c);
  return f === "internal" ? "Internal" : f === "test" ? "Test" : "";
}

function CF_label(c) {
  const t = CF_badgeText(c);
  const name = String((c && (c.name || c.id)) || "");
  return t ? name + " · " + t : name;
}

// <CF_Badge client={c} /> or <CF_Badge flag="test" />. Renders nothing for a
// normal client.
function CF_Badge({ client, flag }) {
  const f = flag || CF_flag(client);
  if (!f) return null;
  return (
    <span
      className={"cf-badge cf-badge-" + f}
      title={f === "internal" ? "MyGoodBooks' own workspace. Not a client." : "A practice client for trying things out. Not counted in real numbers."}
    >
      {f === "internal" ? "Internal" : "Test"}
    </span>
  );
}

function CF_readShow(email) {
  if (!email) return false;
  try {
    return localStorage.getItem(CF_KEY_PREFIX + String(email).toLowerCase()) === "1";
  } catch (e) {
    return false;
  }
}

function CF_writeShow(email, on) {
  if (!email) return;
  try {
    localStorage.setItem(CF_KEY_PREFIX + String(email).toLowerCase(), on ? "1" : "0");
  } catch (e) {}
  try {
    window.dispatchEvent(new CustomEvent(CF_EVENT, { detail: { email: String(email).toLowerCase(), on: !!on } }));
  } catch (e) {}
}

// [show, setShow]. Every caller shares one state (the event keeps them in step,
// including a second tab through the storage event).
function CF_useShowTest(emailIn) {
  // The signed-in person's own address (App publishes it), so "View as" doesn't
  // swap in the previewed person's switch.
  const email = window.mgbViewerEmail || emailIn;
  const [show, setShowState] = React.useState(() => CF_readShow(email));
  React.useEffect(() => {
    setShowState(CF_readShow(email));
    const sync = () => setShowState(CF_readShow(email));
    window.addEventListener(CF_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CF_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [email]);
  const setShow = React.useCallback((on) => CF_writeShow(email, on), [email]);
  return [show, setShow];
}

// opts: { show, keepId }  (isAssigned is accepted but ignored: assignment no longer
// overrides the switch)
// Normal clients and MGB (internal) pass straight through (internal visibility
// is decided elsewhere); a test client stays when the switch is on or when it is
// the open client (keepId).
function CF_pick(list, opts) {
  const o = opts || {};
  const kept = (list || []).filter((c) => {
    if (!c || c.testOnly !== true || c.isInternal === true) return true;
    if (o.show) return true;
    return !!(o.keepId && c.id === o.keepId);
  });
  return CF_sort(kept);
}

// Is this person explicitly on this client? Assigned bookkeeper or account
// manager, or one of the ids App published (staff_client_access rows and live
// temporary grants: window.mgbAssignedClientIds).
function CF_isAssigned(c, email) {
  const me = String(email || "").toLowerCase();
  if (!c || !me) return false;
  if (c.assignedBookkeeper && String(c.assignedBookkeeper.email || "").toLowerCase() === me) return true;
  if (c.accountManager && String(c.accountManager.email || "").toLowerCase() === me) return true;
  const ids = window.mgbAssignedClientIds;
  return !!(ids && typeof ids.has === "function" && ids.has(c.id));
}

// For components that get a raw client list: the same sort + switch rule the
// App applies to its own lists. keepId: a client that must stay listed (the one
// open / already chosen).
function CF_usePicked(list, emailIn, keepId) {
  const email = window.mgbViewerEmail || emailIn;
  const [show] = CF_useShowTest(email);
  return React.useMemo(
    () => CF_pick(list, { show, keepId, isAssigned: (c) => CF_isAssigned(c, email) }),
    [list, show, keepId, email],
  );
}

// Same switch, two homes. `compact` is the switcher footer version.
function CF_Toggle({ email, compact, count }) {
  const [show, setShow] = CF_useShowTest(email);
  // View as is read-only: the switch is the viewed person's saved setting.
  const ro = typeof MGB_viewAsReadOnly === "function" && MGB_viewAsReadOnly();
  return (
    <label className={"cf-toggle" + (compact ? " cf-toggle-compact" : "")} data-tour="show-test-clients" title={ro ? "Read-only in View as" : undefined}>
      <input type="checkbox" checked={!!show} disabled={ro} onChange={(e) => { if (!ro) setShow(e.target.checked); }} />
      <span className="cf-toggle-text">
        Show test clients{typeof count === "number" && count > 0 ? ` (${count})` : ""}
        <small className="cf-toggle-hint">Test clients are hidden unless this is on</small>
      </span>
    </label>
  );
}
