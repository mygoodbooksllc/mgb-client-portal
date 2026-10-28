// ----------------------------------------------------------------------------
// TK_filterLogic.js — pure rules for the Slate page search box
// (docs/slateplus-filters-spec.md section 2). Plain JS, no React, no network.
//
// Search (live for all staff): TK_searchTerms, TK_searchMatch, TK_applySearch.
// Every word of the query must appear (substring, any case) in the task title,
// its client's name or its notes. An empty query gives the same array back, so
// the Slate list is built exactly as before for anyone not typing.
//
// Node tests: components/tasks/TK_filterLogic.test.js
// ----------------------------------------------------------------------------

var TK_SEARCH_MAX = 200;

function TK__fLower(s) {
  return s == null ? "" : String(s).toLowerCase();
}

// "  Bank  RECON " -> ["bank", "recon"]. Capped at 200 characters.
function TK_searchTerms(q) {
  var text = TK__fLower(q).slice(0, TK_SEARCH_MAX).trim();
  if (!text) return [];
  return text.split(/\s+/).filter(function (w) {
    return !!w;
  });
}

// ctx: { clientNameOf(clientId) -> name }. terms: TK_searchTerms output.
function TK_searchMatch(t, terms, ctx) {
  if (!t) return false;
  var list = Array.isArray(terms) ? terms : [];
  if (!list.length) return true;
  var c = ctx || {};
  var client = t.client_id != null && typeof c.clientNameOf === "function" ? c.clientNameOf(t.client_id) : "";
  var hay = TK__fLower(t.text) + "\n" + TK__fLower(client) + "\n" + TK__fLower(t.description);
  for (var i = 0; i < list.length; i++) if (hay.indexOf(list[i]) < 0) return false;
  return true;
}

// The same array back when the query is empty (identity, so nothing changes).
function TK_applySearch(tasks, q, ctx) {
  var list = Array.isArray(tasks) ? tasks : [];
  var terms = TK_searchTerms(q);
  if (!terms.length) return tasks;
  return list.filter(function (t) {
    return TK_searchMatch(t, terms, ctx);
  });
}

// "1 task matches" / "3 tasks match" / "No tasks match".
function TK_searchCountText(n) {
  var k = Number(n) || 0;
  if (k <= 0) return "No tasks match";
  return k === 1 ? "1 task matches" : k + " tasks match";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_SEARCH_MAX: TK_SEARCH_MAX,
    TK_searchTerms: TK_searchTerms,
    TK_searchMatch: TK_searchMatch,
    TK_applySearch: TK_applySearch,
    TK_searchCountText: TK_searchCountText,
  };
}
