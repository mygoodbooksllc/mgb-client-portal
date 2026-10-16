// Emails page › Client emails › "Ask client emails live" (owner request
// 2026-10-16). Pure rules, no React, no DOM, no Supabase.
//
// The database is the authority: client_email_settings.client_request_enabled
// can only change when public.is_internal_owner() is true (trigger
// tk_guard_client_request_switch raises tk_owner_only otherwise and writes a
// tk_settings_audit row for every change). tk__request_send_mode decides each
// send: off (Send client emails off) / test (test client: one [Test] copy to
// the sender) / dry_run (switch off, or client not in the pilot list) / live.
// These copies only decide what the row shows and what the confirm says.
//
// Loads before ClientEmailSettings.jsx (CEA_ prefix, shared global scope).
// Node test: `node components/staff/clientEmailsAskLogic.test.js`.

function CEA__isInternal(id) {
  try {
    return typeof window !== "undefined" && typeof window.mgbIsInternalClient === "function" && window.mgbIsInternalClient(id);
  } catch (e) {
    return false;
  }
}

// MGB (internal): the row says so (clients.is_internal), or the app's
// mgbIsInternalClient knows the id.
function CEA__internalRow(c) {
  return !!c && (c.is_internal === true || c.isInternal === true || CEA__isInternal(c.id));
}

// Real clients only: not test_only, not MGB (internal).
function CEA_realClients(clients) {
  return (clients || []).filter((c) => c && c.id && c.test_only !== true && c.testOnly !== true && !CEA__internalRow(c));
}

// tk_settings.client_request_pilot (jsonb) -> what the row shows.
// Mirrors tk__request_send_mode: only the string "all" or an array of client
// ids counts; anything else (missing, null, a number, an object) means no
// real client is live.
//   kind: "not_set" | "all" | "list" | "none"
function CEA_pilotStatus(pilot, clients) {
  const real = CEA_realClients(clients);
  const nameOf = (id) => ((clients || []).find((c) => c && c.id === id) || {}).name || id;
  if (pilot === "all") {
    return { kind: "all", count: real.length, names: real.map((c) => c.name || c.id), label: `All real clients (${real.length})` };
  }
  if (Array.isArray(pilot)) {
    const ids = Array.from(new Set(pilot.filter((x) => typeof x === "string" && x.trim() !== "")));
    // A test client in the list is still a test client (one [Test] copy to the
    // sender), so it doesn't count as a real client getting email.
    const testIds = new Set((clients || []).filter((c) => c && (c.test_only === true || c.testOnly === true)).map((c) => c.id));
    const internalIds = new Set((clients || []).filter(CEA__internalRow).map((c) => c.id));
    const realIds = ids.filter((id) => !testIds.has(id) && !internalIds.has(id) && !CEA__isInternal(id));
    if (!realIds.length) return { kind: "none", count: 0, names: [], label: "empty" };
    const names = realIds.map(nameOf);
    return { kind: "list", count: realIds.length, names, label: `${realIds.length} client${realIds.length === 1 ? "" : "s"}: ${names.join(", ")}` };
  }
  return { kind: "not_set", count: 0, names: [], label: "not set" };
}

// The row's description under the label.
function CEA_hint() {
  return (
    "Off (the default): every Ask client email and reminder to a real client is a dry run; nothing is sent. " +
    "On: Ask client emails and their automatic reminders go to real clients in the pilot list only, to the portal users and contacts picked on each request. " +
    "Test clients always get one [Test] copy, sent only to the staff member who sends it (no automatic reminders). Needs Send client emails on."
  );
}

// One line under the row: pilot status and whether anything can go out.
function CEA_statusLine(opts) {
  const p = (opts && opts.pilot) || { kind: "not_set", label: "not set" };
  let tail = "";
  if (p.kind === "not_set" || p.kind === "none") tail = " · no real client gets these emails, even with the switch on";
  return "Pilot list: " + p.label + tail;
}

// Confirm text before turning ON. Says exactly who will be emailed.
function CEA_confirmText(opts) {
  const p = (opts && opts.pilot) || { kind: "not_set", count: 0, names: [] };
  const masterOn = !!(opts && opts.masterOn);
  const lines = ["Turn on Ask client emails?", ""];
  if (p.kind === "all") {
    lines.push(`From now on, Ask client emails and their automatic reminders go to ALL ${p.count} real client${p.count === 1 ? "" : "s"}: the portal users and contacts picked on each request.`);
  } else if (p.kind === "list") {
    lines.push(`From now on, Ask client emails and their automatic reminders go to ${p.count} real client${p.count === 1 ? "" : "s"}: ${p.names.join(", ")}.`);
    lines.push("They go to the portal users and contacts picked on each request. Every other real client stays a dry run.");
  } else {
    lines.push("The pilot list is " + (p.kind === "none" ? "empty" : "not set") + ", so no real client will be emailed yet. Every real client stays a dry run until the pilot list names them.");
  }
  lines.push("Open requests that are already due a reminder can be emailed at the next reminder run (weekdays, morning).");
  lines.push("Test clients still get one [Test] copy to the sender only.");
  if (!masterOn) lines.push("", "Send client emails is off, so nothing sends until that is on too.");
  return lines.join("\n");
}

// Who may click. The database enforces it either way.
function CEA_rowState(opts) {
  const isOwner = !!(opts && opts.isOwner);
  return {
    canToggle: isOwner && !(opts && opts.busy),
    note: isOwner ? "" : "Owner only",
  };
}

// tk_settings_audit row -> "Turned on by x@y · <when>".
function CEA_lastChange(row, whenFn) {
  if (!row) return "";
  const on = row.new_value === true || row.new_value === "true";
  const who = row.changed_by && row.changed_by !== "system" ? row.changed_by : "a database admin";
  const when = row.changed_at ? (typeof whenFn === "function" ? whenFn(row.changed_at) : String(row.changed_at)) : "";
  return `Turned ${on ? "on" : "off"} by ${who}${when ? " · " + when : ""}`;
}

// Error from the save -> what to tell the person.
function CEA_saveError(err) {
  const m = String((err && (err.message || err)) || "");
  if (m.indexOf("tk_owner_only") >= 0) return "Only the owner can turn Ask client emails on or off.";
  return "Couldn't save: " + (m || "unknown error");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CEA_realClients,
    CEA_pilotStatus,
    CEA_hint,
    CEA_statusLine,
    CEA_confirmText,
    CEA_rowState,
    CEA_lastChange,
    CEA_saveError,
  };
}
