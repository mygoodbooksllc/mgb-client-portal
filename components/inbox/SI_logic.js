// ----------------------------------------------------------------------------
// SI_logic: pure rules for the staff inbox, node-tested
// (`node components/inbox/SI_logic.test.js`). A plain script like WB_logic.js,
// so the browser build loads it as a global and node can require it.
// ----------------------------------------------------------------------------

// The person to open when the inbox is asked to open on an email (a client's
// Messages tab, or the Workbench hub's Reply). With a client named, the person
// on THAT client: the same email can be a contact for more than one client,
// and opening the wrong client's thread would be worse than opening none.
// Returns the entry, or null when that person isn't in the list.
function SI_findInitialEntry(entries, email, clientId) {
  var want = String(email || "").trim().toLowerCase();
  if (!want) return null;
  var list = entries || [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (e && e.email === want && (!clientId || e.clientId === clientId)) return e;
  }
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SI_findInitialEntry: SI_findInitialEntry };
}
