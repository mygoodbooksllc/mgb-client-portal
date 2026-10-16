// /respond: answer one request from MyGoodBooks without a portal login
// (Tasks Phase 2, S6; spec C6). Talks only to the public tk-request-respond
// edge function.
//
// The link is /respond#t=<token> (or #t=<token>&stop=1 from a reminder's
// "Stop reminders"). The token lives in the fragment, which browsers never
// send to a server. This script reads it, wipes it from the address bar
// before any request (history.replaceState), keeps it only in memory and
// sends it only in the X-MGB-Token header. Everything shown is set with
// textContent: nothing from the request is ever parsed as HTML.
(function () {
  "use strict";
  var FN = "https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/tk-request-respond";
  var SUPPORT = "admin@mygoodbooks.org";
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var $ = function (id) { return document.getElementById(id); };

  var frag = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  var token = frag.get("t") || "";
  var stopMode = frag.get("stop") === "1";
  try {
    history.replaceState(null, "", location.pathname);
  } catch (e) {}

  var view = null;
  var staged = []; // { name, id } files already uploaded on this page

  function show(id) {
    ["loading", "form", "done", "closed", "stop"].forEach(function (s) { $(s).hidden = s !== id; });
  }
  function text(id, value) { $(id).textContent = value || ""; }

  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "";
    var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return months[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
  }

  function mailto(first) {
    var subj = first ? "A question for " + first : "A question about a MyGoodBooks request";
    $("closed-mail").href = "mailto:" + SUPPORT + "?subject=" + encodeURIComponent(subj);
    text("closed-mail", first ? "Email " + first + " at MyGoodBooks" : "Email MyGoodBooks");
  }

  function call(action, opts) {
    var o = opts || {};
    var headers = { "X-MGB-Token": token };
    if (o.json) headers["Content-Type"] = "application/json";
    if (o.file) {
      headers["X-MGB-Filename"] = encodeURIComponent(o.file.name);
      if (o.file.type) headers["Content-Type"] = o.file.type;
    }
    return fetch(FN + "?action=" + action, {
      method: "POST",
      headers: headers,
      body: o.file ? o.file : o.json ? JSON.stringify(o.json) : undefined,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    }).then(
      function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) {
          return { status: r.status, body: b || {} };
        });
      },
      function () { return { status: 0, body: { error: "network" } }; },
    );
  }

  // A closed or refused link. first: the asker's first name, when known.
  function closed(code, first) {
    var who = first || "your bookkeeper";
    var t = "This link has closed";
    var s = "";
    if (code === "expired") {
      t = "This link has expired";
      s = "Links work for 14 days. Email " + who + " and they'll send a fresh one.";
    } else if (code === "answered_already") {
      t = "Already answered";
      s = "This request was already answered, so nothing more is needed here. Thank you.";
    } else if (code === "revoked") {
      t = "This link was replaced";
      s = "A newer email from MyGoodBooks has a fresh link, or the request changed. Check your inbox, or email " + who + ".";
    } else if (code === "cancelled") {
      t = "Nothing needed";
      s = "MyGoodBooks cancelled this request, so there's nothing to do.";
    } else if (code === "rate_limited") {
      t = "Too many tries";
      s = "Please wait a few minutes, then open the link from your email again.";
    } else if (code === "invalid") {
      t = "Link not recognized";
      s = "Open the link straight from the newest MyGoodBooks email. If it still doesn't work, email us.";
    } else {
      t = "Something went wrong";
      s = "Please try again in a few minutes, or email us.";
    }
    text("closed-title", t);
    text("closed-sub", s);
    mailto(first);
    show("closed");
  }

  function err(msg) {
    var e = $("err");
    e.textContent = msg || "";
    e.hidden = !msg;
  }

  var ERR_TEXT = {
    reply_required: "Type an answer or add a file first.",
    too_many: "That's more files than this link takes. Send up to 5.",
    too_large: "That file is too big. Files can be up to 25 MB.",
    bad_type: "That kind of file can't be sent. Use PDF, a picture, a spreadsheet, Word or text.",
    not_connected: "Uploads aren't working right now. Type your answer, or email us the file.",
    bad_request: "Something about that didn't work. Check your answer and try again.",
    network: "You seem to be offline. Check your connection and try again.",
  };

  function render(v) {
    view = v;
    document.title = "MyGoodBooks: " + (v.title || "Reply or upload");
    text("client", v.client_display_name);
    text("title", v.title);
    text("prompt", v.prompt);
    var meta = [];
    if (v.asked_by_first_name) meta.push("Asked by " + v.asked_by_first_name + " on " + longDate(v.asked_on));
    if (v.due_date) meta.push("Needed by " + longDate(v.due_date));
    if (v.expires_on) meta.push("Link works until " + longDate(v.expires_on));
    text("meta", meta.join(" · "));
    var lim = v.limits || {};
    var types = Array.isArray(lim.types) ? lim.types : [];
    $("filebox").hidden = !v.needs_upload;
    if (types.length) $("files").accept = types.map(function (t) { return "." + t; }).join(",");
    text("limits", "Up to " + (lim.max_files || 5) + " files, " + (lim.max_mb || 25) + " MB each" + (types.length ? " (" + types.join(", ") + ")" : "") + ".");
    if (v.needs_upload) $("reply").placeholder = "Optional note with your files";
    show("form");
  }

  function fileRow(name, cls, note) {
    var li = document.createElement("li");
    li.className = cls || "";
    li.textContent = name + (note ? " · " + note : "");
    $("filelist").appendChild(li);
  }

  // Uploads the picked files one at a time (each its own request, so size
  // and type are checked from headers before the body is read), then sends
  // the answer with their ids. Files that went up stay up if Send is retried.
  function submit(e) {
    e.preventDefault();
    err("");
    var reply = $("reply").value.trim();
    var lim = (view && view.limits) || {};
    var maxBytes = (lim.max_mb || 25) * 1024 * 1024;
    var picked = view && view.needs_upload ? Array.prototype.slice.call($("files").files || []) : [];
    var todo = picked.filter(function (f) {
      return !staged.some(function (s) { return s.name === f.name && s.size === f.size; });
    });
    if (!reply && !todo.length && !staged.length) return err(ERR_TEXT.reply_required);
    if (staged.length + todo.length > (lim.max_files || 5)) return err(ERR_TEXT.too_many);
    for (var i = 0; i < todo.length; i++) if (todo[i].size > maxBytes) return err(todo[i].name + ": " + ERR_TEXT.too_large);
    $("send").disabled = true;
    $("send").textContent = todo.length ? "Uploading…" : "Sending…";
    $("filelist").textContent = "";
    staged.forEach(function (s) { fileRow(s.name, "is-ok", "uploaded"); });

    var chain = Promise.resolve(true);
    todo.forEach(function (f) {
      chain = chain.then(function (ok) {
        if (!ok) return false;
        return call("upload", { file: f }).then(function (r) {
          if (r.status === 200 && r.body.file_id) {
            staged.push({ name: f.name, size: f.size, id: r.body.file_id });
            fileRow(f.name, "is-ok", "uploaded");
            return true;
          }
          return stop(r, f.name);
        });
      });
    });
    chain.then(function (ok) {
      if (!ok) return;
      $("send").textContent = "Sending…";
      return call("answer", { json: { reply: reply || null, file_ids: staged.map(function (s) { return s.id; }) } }).then(function (r) {
        if (r.status === 200 && r.body.ok) {
          var first = view && view.asked_by_first_name;
          text("done-title", "Thanks" + (first ? ", " + first + " has it" : ", we have it"));
          text("done-sub", "Your answer went to MyGoodBooks. You can close this page.");
          token = "";
          show("done");
          return;
        }
        stop(r, null);
      });
    });
  }

  // A refused upload or answer: a closed link leaves the form, anything
  // else shows why and lets them try again.
  function stop(r, fileName) {
    var code = (r.body && r.body.error) || "server_error";
    if (r.status === 410 || r.status === 404 || code === "rate_limited") {
      closed(code, view && view.asked_by_first_name);
      return false;
    }
    if (fileName) fileRow(fileName, "is-bad", "not sent");
    err((fileName ? fileName + ": " : "") + (ERR_TEXT[code] || "That didn't go through. Try again in a moment."));
    $("send").disabled = false;
    $("send").textContent = "Send";
    return false;
  }

  $("answer").addEventListener("submit", submit);
  $("stop-go").addEventListener("click", function () {
    $("stop-go").disabled = true;
    call("stop_nudges").then(function (r) {
      if (r.status === 200 && r.body.ok) {
        text("stop-title", "Reminders stopped");
        text("stop-sub", "We won't send you more reminders about these requests. Your bookkeeper can still reach you directly.");
        $("stop-go").hidden = true;
        return;
      }
      closed((r.body && r.body.error) || "server_error", null);
    });
  });

  if (!TOKEN_RE.test(token)) {
    closed("invalid", null);
  } else if (stopMode) {
    show("stop");
  } else {
    call("view").then(function (r) {
      if (r.status === 200 && r.body.view) render(r.body.view);
      else closed((r.body && r.body.error) || "server_error", r.body && r.body.asked_by_first_name);
    });
  }
})();
