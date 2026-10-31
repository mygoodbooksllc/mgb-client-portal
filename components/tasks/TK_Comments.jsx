// ----------------------------------------------------------------------------
// Tasks module, drawer slice: the comment thread (spec C7, rows 2.4, 2.5).
//
//   TK_Comments({ task, staffUser, staff, canComment, showActivity, nameOf })
//
// Comments come from TK_api.listComments; with showActivity the activity rows
// are merged in (TK_mergeTimeline) for the "All" tab. Mentions: typing "@"
// opens a list of active staff; the server reads the handles from the body.
// Shared hooks and helpers (TK_dwUseRows, TK_dwApi, ...) live in TK_Drawer.jsx
// and are used at render time only.
//
// Slate plus (hidden preview, TKP_on() in TK_slatePlus.js): the "@" list shows
// only people who will see the mention (tk_mention_candidates) plus a muted
// "can't see this task" line, a note after posting says who was notified, and
// a mention of you stands out (is-me). Off: everything below behaves exactly
// as before (no extra call, no extra markup or class).
// ----------------------------------------------------------------------------

var TK_CM_MAX = 5000;
var TK_CM_WARN = 4500;

var TK_CM_KIND_LABELS = {
  send_back: "Sent back",
  client_reply: "Client reply",
  system: "Update",
};

function TK_cmHandleMap(staff) {
  var map = {};
  (staff || []).forEach(function (s) {
    if (!s || !s.email) return;
    map[TK_dlHandle(s.email)] = s.name || TK_dlHandle(s.email);
  });
  return map;
}

function TK_cmBody(props) {
  var parts = TK_dlSplitMentions(props.body, props.handles);
  var meOn = !!props.plusOn && !!props.me && typeof TKM_isMe === "function";
  return (
    <div className="tk-cm-body">
      {parts.map(function (part, i) {
        if (part.type === "mention") {
          return (
            <span key={i} className={meOn && TKM_isMe(part.handle, props.me) ? "tk-cm-mention is-me" : "tk-cm-mention"} title={"@" + part.handle}>
              @{part.name}
            </span>
          );
        }
        return <React.Fragment key={i}>{part.text}</React.Fragment>;
      })}
    </div>
  );
}

function TK_cmTime(props) {
  var iso = props.at;
  var exact = "";
  try {
    exact = iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
  } catch (e) {}
  return (
    <time className="tk-cm-time" dateTime={iso || undefined} title={exact}>
      {TK_dlRelTime(iso, Date.now())}
    </time>
  );
}

// A textarea with the "@" list. Used by the composer and by inline edit.
function TK_cmEditor(props) {
  var p = props;
  var ref = React.useRef(null);
  var qPair = React.useState(null); // { start, query }
  var mq = qPair[0];
  var setMq = qPair[1];
  var activePair = React.useState(0);
  var active = activePair[0];
  var setActive = activePair[1];
  var listId = React.useRef("tk-cm-list-" + Math.random().toString(36).slice(2, 8)).current;

  // Slate plus: split into who can be picked and who can't see the task.
  var plusLists = mq && p.plusOn && Array.isArray(p.candidates) && typeof TKM_pickerLists === "function"
    ? TKM_pickerLists(mq.query, p.staff, p.candidates, TK_mentionMatches, p.me)
    : null;
  var matches = plusLists ? plusLists.pick : mq ? TK_mentionMatches(mq.query, p.staff, 6) : [];
  var offList = plusLists ? plusLists.off : [];
  var navOpen = !!mq && matches.length > 0;
  var listOpen = navOpen || (!!mq && offList.length > 0);

  React.useEffect(function () {
    if (p.autoFocus && ref.current) {
      ref.current.focus();
      var n = ref.current.value.length;
      try { ref.current.setSelectionRange(n, n); } catch (e) {}
    }
  }, []);

  React.useEffect(function () {
    if (p.focusSignal && ref.current) ref.current.focus();
  }, [p.focusSignal]);

  var syncQuery = function (el) {
    var q = TK_mentionQuery(el.value, el.selectionStart);
    setMq(q);
    setActive(0);
  };

  var pick = function (s) {
    var el = ref.current;
    if (!el || !s) return;
    var res = TK_insertMention(el.value, el.selectionStart, TK_dlHandle(s.email));
    p.onChange(res.body);
    setMq(null);
    setTimeout(function () {
      if (!ref.current) return;
      ref.current.focus();
      try { ref.current.setSelectionRange(res.caret, res.caret); } catch (e) {}
    }, 0);
  };

  return (
    <div className="tk-cm-editor">
      <textarea
        ref={ref}
        className="tk-dw-textarea tk-cm-input"
        rows={p.rows || 3}
        maxLength={TK_CM_MAX}
        value={p.value}
        placeholder={p.placeholder}
        disabled={p.disabled}
        aria-label={p.label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen ? "true" : "false"}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={navOpen ? listId + "-" + active : undefined}
        onChange={function (e) {
          p.onChange(e.target.value);
          syncQuery(e.target);
        }}
        onClick={function (e) { syncQuery(e.target); }}
        onBlur={function () {
          setTimeout(function () { setMq(null); }, 150);
        }}
        onKeyDown={function (e) {
          if (navOpen) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((active + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((active - 1 + matches.length) % matches.length);
              return;
            }
            if ((e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
              e.preventDefault();
              pick(matches[active]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setMq(null);
              return;
            }
          }
          if (listOpen && !navOpen && e.key === "Escape") {
            // Slate plus: only "can't see this task" lines are showing
            e.preventDefault();
            e.stopPropagation();
            setMq(null);
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            p.onSubmit();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (p.onCancel) p.onCancel();
            else e.currentTarget.blur();
          }
        }}
        onKeyUp={function (e) {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") syncQuery(e.target);
        }}
      />
      {listOpen && (
        <ul className="tk-cm-list" role="listbox" id={listId} aria-label="People to mention">
          {matches.map(function (s, i) {
            return (
              <li
                key={s.email}
                id={listId + "-" + i}
                role="option"
                aria-selected={i === active ? "true" : "false"}
                className={"tk-cm-option" + (i === active ? " is-active" : "")}
                onMouseDown={function (e) {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={function () { setActive(i); }}
              >
                <span className="tk-dw-avatar tk-dw-avatar-sm" aria-hidden="true">
                  {TK_dlInitials(s.name, s.email)}
                </span>
                <span className="tk-cm-option-name">{s.name || TK_dlHandle(s.email)}</span>
                <span className="tk-cm-option-handle">@{TK_dlHandle(s.email)}</span>
              </li>
            );
          })}
          {offList.map(function (s) {
            return (
              <li
                key={"off-" + s.email}
                role="option"
                aria-disabled="true"
                aria-selected="false"
                className="tk-cm-option tk-cm-option-off"
                onMouseDown={function (e) { e.preventDefault(); }}
              >
                <span className="tk-dw-avatar tk-dw-avatar-sm" aria-hidden="true">
                  {TK_dlInitials(s.name, s.email)}
                </span>
                <span className="tk-cm-option-name">{s.name || TK_dlHandle(s.email)}</span>
                <span className="tk-cm-option-handle">can't see this task</span>
              </li>
            );
          })}
        </ul>
      )}
      {p.value.length > TK_CM_WARN && (
        <p className={"tk-dw-counter" + (p.value.length >= TK_CM_MAX ? " is-bad" : "")} aria-live="polite">
          {p.value.length.toLocaleString("en-US")} of 5,000
        </p>
      )}
    </div>
  );
}

function TK_cmComment(props) {
  var p = props;
  var c = p.comment;
  var editPair = React.useState(null);
  var editing = editPair[0];
  var setEditing = editPair[1];
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];
  var confirmPair = React.useState(false);
  var confirming = confirmPair[0];
  var setConfirming = confirmPair[1];
  var mine = TK_dwLower(c.author_email) === p.me;
  var deleted = !!(c.deleted || c.deleted_at);
  var api = TK_dwApi();
  // Client answers (tasks p2 s5) carry client:<email> or contact:<id>.
  var name = (typeof TK_requestAuthorLabel === "function" && TK_requestAuthorLabel(c.author_email, p.requestNames)) || p.nameOf(c.author_email);
  var staffRow = (p.staff || []).filter(function (s) { return TK_dwLower(s.email) === TK_dwLower(c.author_email); })[0];

  var saveEdit = function () {
    var text = String(editing || "").trim();
    if (!text || !api || busy) return;
    if (text === String(c.body || "").trim()) {
      setEditing(null);
      return;
    }
    setBusy(true);
    api.editComment(c.id, text).then(
      function () {
        setBusy(false);
        setEditing(null);
        p.onChanged();
      },
      function (e) {
        setBusy(false);
        TK_dwSaveError(e);
      },
    );
  };

  var doDelete = function () {
    setConfirming(false);
    if (!api) return;
    api.deleteComment(c.id).then(function () { p.onChanged(); }, TK_dwSaveError);
  };

  return (
    <li className={"tk-cm-item" + (deleted ? " is-deleted" : "") + (c.kind && c.kind !== "comment" ? " is-" + c.kind : "")}>
      <span className="tk-dw-avatar" aria-hidden="true">
        {TK_dlInitials(staffRow ? staffRow.name : "", c.author_email)}
      </span>
      <div className="tk-cm-main">
        <div className="tk-cm-meta">
          <span className="tk-cm-name">
            {staffRow && TK_cmPersonOn() ? (
              // Slate plus: staff authors open their profile. Client authors never link.
              <TKP_PersonLink email={staffRow.email} title={"Open " + name + "'s profile"}>{name}</TKP_PersonLink>
            ) : (
              name
            )}
          </span>
          {c.kind && TK_CM_KIND_LABELS[c.kind] && <span className="tk-cm-kind">{TK_CM_KIND_LABELS[c.kind]}</span>}
          <TK_cmTime at={c.created_at} />
          {c.edited_at && !deleted && (
            <span className="tk-cm-edited">
              {c.edited_by && TK_dwLower(c.edited_by) !== TK_dwLower(c.author_email)
                ? "(edited by " + p.nameOf(c.edited_by) + ")"
                : "(edited)"}
            </span>
          )}
        </div>
        {editing !== null ? (
          <div className="tk-cm-edit">
            <TK_cmEditor
              value={editing}
              onChange={setEditing}
              onSubmit={saveEdit}
              onCancel={function () { setEditing(null); }}
              staff={p.staff}
              plusOn={p.plusOn}
              candidates={p.candidates}
              me={p.plusOn ? p.me : undefined}
              label="Edit comment"
              autoFocus
              disabled={busy}
              rows={2}
            />
            <div className="tk-cm-actions">
              <button type="button" className="btn-primary tk-dw-btn-sm" disabled={busy || !String(editing).trim()} onClick={saveEdit}>
                Save
              </button>
              <button type="button" className="btn-secondary tk-dw-btn-sm" disabled={busy} onClick={function () { setEditing(null); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : deleted ? (
          <p className="tk-cm-body tk-dw-muted">Comment deleted</p>
        ) : (
          <TK_cmBody body={c.body} handles={p.handles} plusOn={p.plusOn} me={p.me} />
        )}
        {mine && !deleted && editing === null && p.canComment && (
          <div className="tk-cm-own">
            <button type="button" className="link-btn" onClick={function () { setEditing(c.body || ""); }}>
              Edit
            </button>
            <button type="button" className="link-btn" onClick={function () { setConfirming(true); }}>
              Delete
            </button>
          </div>
        )}
      </div>
      {confirming && (
        <TK_dwConfirm
          title="Delete this comment?"
          body="It's replaced with a note that a comment was deleted."
          confirmLabel="Delete"
          onConfirm={doDelete}
          onCancel={function () { setConfirming(false); }}
        />
      )}
    </li>
  );
}

// Slate plus: a staff name links to the profile (plain check, no hook).
function TK_cmPersonOn() {
  return typeof TKP_PersonLink === "function" && typeof TKP_on === "function" && TKP_on();
}

// The staff row for an email, or null (client authors and unknown emails).
function TK_cmStaffOf(staff, email) {
  var em = TK_dwLower(email);
  if (!em) return null;
  return (staff || []).filter(function (s) { return TK_dwLower(s.email) === em; })[0] || null;
}

function TK_cmActivityLine(props) {
  var a = props.entry;
  var text = TK_activityText(a, { nameOf: props.nameOf, statusLabel: TK_dwStatusLabel, today: TK_dwToday() });
  var actorName = (typeof TK_requestAuthorLabel === "function" && TK_requestAuthorLabel(a.actor_email, props.requestNames)) || props.nameOf(a.actor_email);
  var actorStaff = TK_cmPersonOn() ? TK_cmStaffOf(props.staff, a.actor_email) : null;
  return (
    <li className="tk-cm-activity">
      <span className="tk-cm-dot" aria-hidden="true" />
      <span className="tk-cm-activity-text">
        <span className="tk-cm-name">
          {actorStaff ? (
            <TKP_PersonLink email={actorStaff.email} title={"Open " + actorName + "'s profile"}>{actorName}</TKP_PersonLink>
          ) : (
            actorName
          )}
        </span>{" "}
        {text}
      </span>
      <TK_cmTime at={a.created_at} />
    </li>
  );
}

function TK_Comments(props) {
  var p = props || {};
  var task = p.task || {};
  var me = TK_dwLower(p.staffUser && p.staffUser.email);
  var nameOf = p.nameOf || TK_dwNameFn(p.staff);
  var staff = p.staff || [];
  var api = TK_dwApi();
  var handles = React.useMemo(function () { return TK_cmHandleMap(staff); }, [staff]);
  // Slate plus gate (one shared check). typeof is stable for the page's life.
  var plusOn = typeof TKP_useOn === "function" ? TKP_useOn() : typeof TKP_on === "function" ? TKP_on() : false;
  var candPair = React.useState(null); // array of emails once loaded; null = old list
  var cands = candPair[0];
  var setCands = candPair[1];
  var notePair = React.useState("");
  var note = notePair[0];
  var setNote = notePair[1];
  React.useEffect(function () {
    setCands(null);
    setNote("");
    if (!plusOn || !task.id || !api || typeof api.mentionCandidates !== "function") return undefined;
    var live = true;
    Promise.resolve(api.mentionCandidates(task.id)).then(
      function (list) { if (live) setCands(Array.isArray(list) ? list : null); },
      function () { if (live) setCands(null); },
    );
    return function () { live = false; };
  }, [plusOn, task.id]);

  var cm = TK_dwUseRows(
    "c",
    task.id || null,
    function () { return api ? api.listComments(task.id) : []; },
    { tables: ["tk_comments"] },
  );
  var act = TK_dwUseRows(
    "a",
    p.showActivity && task.id ? task.id : null,
    function () { return api ? api.listActivity(task.id) : []; },
    { stamp: task.updated_at || "" },
  );

  var draftPair = React.useState("");
  var draft = draftPair[0];
  var setDraft = draftPair[1];
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];
  var errPair = React.useState("");
  var err = errPair[0];
  var setErr = errPair[1];
  var listRef = React.useRef(null);

  React.useEffect(function () {
    setDraft("");
    setErr("");
  }, [task.id]);

  var reloadAll = function () {
    cm.reload();
    if (p.showActivity) act.reload();
  };

  var post = function () {
    var text = draft.trim();
    if (!text || busy || !api || !p.canComment) return;
    if (text.length > TK_CM_MAX) {
      setErr("Keep the comment under 5,000 characters.");
      return;
    }
    setBusy(true);
    setErr("");
    api.addComment(task.id, text).then(
      function (row) {
        setBusy(false);
        setDraft("");
        if (plusOn && typeof TKM_postNote === "function") {
          setNote(TKM_postNote({ body: text, staff: staff, mentions: row && row.mentions, candidates: cands, me: me }).text);
        }
        TK_dwTrack("tasks-comment", { mentions: (text.match(/(^|\s)@[A-Za-z0-9._-]{2,}/g) || []).length });
        reloadAll();
        setTimeout(function () {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
        }, 0);
      },
      function (e) {
        setBusy(false);
        if (e && e.code === "tk_offline") setErr(TK_dwCopy("offline", "You're offline."));
        else {
          setErr("Couldn't post the comment. Try again.");
          if (typeof console !== "undefined") console.error("[TK]", e);
        }
      },
    );
  };

  var items = p.showActivity
    ? TK_mergeTimeline(cm.rows, act.rows)
    : (cm.rows || []).map(function (c) {
        return { type: "comment", at: c.created_at, item: c.deleted_at ? Object.assign({}, c, { deleted: true }) : c };
      });
  var loading = cm.loading || (p.showActivity && act.loading);
  var error = cm.error;

  return (
    <div className="tk-cm">
      {loading && !items.length ? (
        <div aria-busy="true">
          <div className="tk-dw-skel tk-dw-skel-row" />
          <div className="tk-dw-skel tk-dw-skel-row" />
        </div>
      ) : error && !items.length ? (
        <p className="tk-dw-muted">
          Couldn't load comments.{" "}
          <button type="button" className="link-btn" onClick={reloadAll}>
            {TK_dwCopy("retry", "Try again")}
          </button>
        </p>
      ) : !items.length ? (
        <p className="tk-dw-muted tk-cm-empty">{p.showActivity ? "No comments or changes yet." : "No comments yet."}</p>
      ) : (
        <ul className="tk-cm-thread" ref={listRef} aria-live="polite">
          {items.map(function (it) {
            if (it.type === "activity") {
              return <TK_cmActivityLine key={"a" + it.item.id} entry={it.item} nameOf={nameOf} staff={staff} />;
            }
            return (
              <TK_cmComment
                key={"c" + it.item.id}
                comment={it.item}
                me={me}
                staff={staff}
                nameOf={nameOf}
                handles={handles}
                canComment={p.canComment}
                onChanged={reloadAll}
                plusOn={plusOn}
                candidates={plusOn ? cands : null}
              />
            );
          })}
        </ul>
      )}

      <div className="tk-cm-composer">
        <TK_cmEditor
          value={draft}
          onChange={function (v) {
            setDraft(v);
            if (err) setErr("");
            if (note) setNote("");
          }}
          onSubmit={post}
          staff={staff}
          plusOn={plusOn}
          candidates={plusOn ? cands : null}
          me={plusOn ? me : undefined}
          label="Add a comment"
          placeholder={
            p.canComment
              ? "Add a comment. Type @ to mention someone."
              : p.task && p.task.deleted_at
                ? TK_dwCopy("deletedComment", "This task is deleted. Restore it to add a comment.")
                : TK_dwCopy("offline", "You're offline.")
          }
          disabled={!p.canComment || busy}
        />
        {err && (
          <p className="tk-dw-warn" role="alert">
            {err}
          </p>
        )}
        {plusOn && note && (
          <p className="tk-cm-note" role="status">
            {note}
          </p>
        )}
        {/* A deleted task takes no comments: no Post button, only the
            placeholder that says to restore it. */}
        {!(p.task && p.task.deleted_at) && (
        <div className="tk-cm-actions">
          <span className="tk-dw-hint tk-cm-hint">Ctrl or {"⌘"} + Enter to post</span>
          <button
            type="button"
            className="btn-primary tk-dw-btn-sm"
            disabled={!p.canComment || busy || !draft.trim() || draft.trim().length > TK_CM_MAX}
            onClick={post}
          >
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
