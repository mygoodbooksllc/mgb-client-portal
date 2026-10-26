// ----------------------------------------------------------------------------
// TK_Board.jsx — Slate app P1: the board view (columns by status or section).
//
// Exports: TK_useBoardLayout, TK_useBoard, TK_BoardSwitch
//
// Only the Slate app shows it: callers gate on TK_boardAllowed (the Slate app
// at regular or full width), so the portal page, app-off, compact and sliver
// keep the list exactly as before. CSS also hides .tk-board under
// .tk-m-compact and .tk-m-sliver.
//
// Moves reuse the single-task paths, never a new write:
//   status column   TK_vSetStatus / TK_vComplete / TK_vWithdraw, as the status
//                   pill does (TK_nextStatuses decides; Done keeps the review
//                   gate and recurring). Shown in place at once, put back with
//                   a toast when it fails.
//   section column  TK_manualMove (tk_manual_reorder), project lists only, the
//                   section must be one of the project's (P2 rule).
//   inside a column the person's manual order (tk_manual_order), only when no
//                   sort is set; otherwise the sort decides.
// Drag is TK_useRowDrag (TK_Drag.jsx) with axis "x". Keys on a focused card:
// Alt+Left / Alt+Right to the next column that takes it, Alt+Up / Alt+Down
// within the column, Enter opens. Moves are read out in a live region.
// Pure rules: TK_board* in TK_viewLogic.js.
// ----------------------------------------------------------------------------

// The List | Board choice (and the board's group by) for one list, per person,
// in this browser only. scope: "my" or "list:<listKey>".
function TK_useBoardLayout(email, scope, kind) {
  var read = function () {
    try {
      return TK_boardLayoutRead(window.localStorage.getItem(TK_BOARD_LAYOUT_KEY), email, scope, kind);
    } catch (e) {
      return { layout: "list", by: "" };
    }
  };
  var pair = React.useState(read);
  React.useEffect(
    function () {
      // keep the same object when nothing changed, so a mount (every list,
      // flag on or off) does not cost an extra render
      var next = read();
      pair[1](function (c) {
        return c && c.layout === next.layout && c.by === next.by ? c : next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [email, scope, kind],
  );
  var cur = pair[0];
  var choices = TK_boardGroupChoices(kind);
  var by = choices.indexOf(cur.by) >= 0 ? cur.by : choices[0] || "status";
  var save = function (layout, nextBy) {
    var n = { layout: layout === "board" ? "board" : "list", by: nextBy || "" };
    pair[1](n);
    try {
      var raw = window.localStorage.getItem(TK_BOARD_LAYOUT_KEY);
      // the default group by is not stored, so a later default change applies
      var keepBy = n.by && n.by !== choices[0] ? n.by : "";
      window.localStorage.setItem(TK_BOARD_LAYOUT_KEY, TK_boardLayoutWrite(raw, email, scope, n.layout, keepBy));
    } catch (e) {}
  };
  return {
    layout: cur.layout,
    by: by,
    choices: choices,
    setLayout: function (l) {
      save(l, cur.by);
    },
    setBy: function (b) {
      save("board", b);
    },
  };
}

var TK_BOARD_BY_LABEL = { status: "Status", section: "Section" };

// props: { layout, onLayout(l), by, choices, onBy(b) }
function TK_BoardSwitch(props) {
  var board = props.layout === "board";
  var choices = Array.isArray(props.choices) ? props.choices : [];
  return (
    <span className="tk-board-switch" data-tour="tk-board-switch">
      <span className="tk-seg" role="group" aria-label="Layout">
        <button
          type="button"
          className={"tk-seg-btn" + (board ? "" : " is-on")}
          aria-pressed={board ? "false" : "true"}
          onClick={function () {
            props.onLayout("list");
          }}
        >
          List
        </button>
        <button
          type="button"
          className={"tk-seg-btn" + (board ? " is-on" : "")}
          aria-pressed={board ? "true" : "false"}
          onClick={function () {
            props.onLayout("board");
          }}
        >
          Board
        </button>
      </span>
      {board && choices.length > 1 ? (
        <span className="tk-seg tk-board-by" role="group" aria-label="Columns by">
          {choices.map(function (c) {
            var on = props.by === c;
            return (
              <button
                key={c}
                type="button"
                className={"tk-seg-btn" + (on ? " is-on" : "")}
                aria-pressed={on ? "true" : "false"}
                onClick={function () {
                  props.onBy(c);
                }}
              >
                {TK_BOARD_BY_LABEL[c] || c}
              </button>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}

function TK_vBoardCard(props) {
  var t = props.task;
  var id = t.id;
  var ref = React.useRef(null);
  var focused = !!props.focused;
  React.useEffect(
    function () {
      if (!focused || !ref.current) return;
      var a = document.activeElement;
      // follow the j/k focus unless the person is working in something else
      if (a && a !== document.body && !(ref.current.closest(".tk-board") || ref.current).contains(a)) return;
      try {
        ref.current.focus({ preventScroll: true });
        if (ref.current.scrollIntoView) ref.current.scrollIntoView({ block: "nearest", inline: "nearest" });
      } catch (e) {}
    },
    [focused],
  );
  var priority = typeof TK_rwPriorityOf === "function" ? TK_rwPriorityOf(t) : t.priority === "high" || t.priority === "low" ? t.priority : "normal";
  var who = TK_vLower(t.assignee_email);
  var whoName = who ? (props.nameOf ? props.nameOf(who) : who) : "";
  var kids = props.kids;
  var subText = kids && kids.length ? TK_subChipText(TK_subCount(kids)) : "";
  var subCount = kids && kids.length ? TK_subCount(kids) : null;
  var status = TK_vStatusOf(t);
  var open = function () {
    if (props.onFocus) props.onFocus(id);
    TK_vOpenTask(id, { from: "list" });
  };
  var titleClick = function (e) {
    e.stopPropagation();
    if (typeof TK_openTaskClick === "function") {
      if (props.onFocus) props.onFocus(id);
      TK_openTaskClick(id)(e);
      return;
    }
    if (!TK_vPlainClick(e)) return;
    e.preventDefault();
    open();
  };
  var title = t.text || "Untitled task";
  return (
    <li
      ref={ref}
      className={"tk-card" + (props.draggable ? " is-draggable" : "") + (status === "done" ? " is-done" : "") + (focused ? " is-focused" : "")}
      data-tk-id={id}
      data-lk={"task:" + id}
      data-tk-drag-handle={props.draggable ? "1" : undefined}
      tabIndex={props.tabbable ? 0 : -1}
      aria-label={title}
      aria-describedby={props.hintId}
      onFocus={function (e) {
        if (e.target === e.currentTarget && props.onFocus) props.onFocus(id);
      }}
      onClick={function (e) {
        if (e.target && e.target.closest && e.target.closest("a, button")) return;
        open();
      }}
      onKeyDown={function (e) {
        if (e.target !== e.currentTarget) return;
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          var dir = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : "";
          if (!dir) return;
          // the list keys' guards (menu, dialog, tour, composing), as Alt+Up/Down on rows
          if (typeof TK_shouldHandleKey === "function" && typeof TK_vKeyCtx === "function") {
            var probe = { target: e.target, isComposing: e.nativeEvent && e.nativeEvent.isComposing, keyCode: e.keyCode, defaultPrevented: e.defaultPrevented };
            if (!TK_shouldHandleKey(probe, Object.assign({}, TK_vKeyCtx(), { keysOff: false }))) return;
          }
          e.preventDefault();
          e.stopPropagation();
          if (props.onKeyMove) props.onKeyMove(id, dir);
          return;
        }
        if (e.key === "Enter" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          open();
        }
      }}
    >
      <a className="tk-card-title" href={TK_vTaskHref(id)} tabIndex={-1} draggable={false} onClick={titleClick}>
        {title}
      </a>
      <span className="tk-card-meta">
        {priority !== "normal" ? (
          <span className={"tk-card-prio tk-card-prio-" + priority} title={priority === "high" ? "High priority" : "Low priority"}>
            <span className={"tk-prio-dot tk-prio-dot-" + priority} aria-hidden="true" />
            <span className="tk-sr">{priority === "high" ? "High priority" : "Low priority"}</span>
          </span>
        ) : null}
        {props.clientName ? <span className="tk-card-client">{props.clientName}</span> : null}
        {props.sectionName ? <span className="tk-card-section">{props.sectionName}</span> : null}
        <TK_DuePill task={t} today={props.today} />
        {subText ? (
          <span className="tk-card-subs" title={subCount.done + " of " + subCount.total + " subtasks done"}>
            <span aria-hidden="true">{subText}</span>
            <span className="tk-sr">{subCount.done + " of " + subCount.total + " subtasks done"}</span>
          </span>
        ) : null}
        <span className="tk-card-who">
          {who ? (
            <TK_vAvatar name={whoName} email={who} size="sm" title={whoName} />
          ) : (
            <span className="tk-card-unassigned">Unassigned</span>
          )}
        </span>
      </span>
    </li>
  );
}

// opts: { on, kind, by, scope (tk_manual_order scope or null), tasks (in the
// order to show), sections (the project's), canReorder (no sort, manual order
// allowed), manualKeys, readOnly, isAdmin, today, clientNames, nameOf(email),
// subs ({ kidsOf }), focusedId, setFocusedId, showClient, showSection, label,
// and (Slate app interactions, optional) ixTouch, ixDrop(value, id),
// ixLongPress(id, x, y) }
// -> { ids (focus order), el }
function TK_useBoard(opts) {
  var o = opts || {};
  var on = !!o.on;
  var cPair = React.useState({});
  var collapsed = cPair[0];
  var pPair = React.useState({});
  var pending = pPair[0];
  var setPending = pPair[1];
  var boxRef = React.useRef(null);
  var say = typeof TK_useManualAnnouncer === "function" ? TK_useManualAnnouncer() : { el: null, say: function () {} };
  var hintId = React.useMemo(function () {
    return "tk-board-hint-" + Math.random().toString(36).slice(2, 8);
  }, []);
  React.useEffect(
    function () {
      if (on && typeof TK_vTrack === "function") TK_vTrack("slate-board-open");
    },
    [on],
  );

  var tasks = Array.isArray(o.tasks) ? o.tasks : [];
  var cols = on ? TK_boardColumns(tasks, { by: o.by, kind: o.kind, sections: o.sections || [], collapsed: collapsed }) : [];
  if (on && o.canReorder && typeof TK_manualSortGroups === "function") cols = TK_manualSortGroups(cols, o.manualKeys || {});
  var kidsOf = (o.subs && o.subs.kidsOf) || {};
  if (on && typeof TK_subNestGroups === "function") cols = TK_subNestGroups(cols, kidsOf);
  if (on) cols = TK_boardApplyPending(cols, pending);
  var byId = {};
  tasks.forEach(function (t) {
    if (t && t.id != null) byId[String(t.id)] = t;
  });
  var me = TK_vMe();
  var check = function (task, from, to) {
    var items = to && to.status && typeof TK_nextStatuses === "function" ? TK_nextStatuses(task, { isAdmin: !!o.isAdmin, me: me }) : [];
    return TK_boardDropCheck(task, from, to, { kind: o.kind, items: items, sections: o.sections || [], readOnly: !!o.readOnly, canReorder: !!(o.canReorder && o.scope) });
  };
  var colOf = function (key) {
    for (var i = 0; i < cols.length; i++) if (cols[i].key === key) return cols[i];
    return null;
  };
  var labelOf = function (key) {
    var c = colOf(key);
    return c ? c.label : "";
  };
  var refuse = function (why) {
    var text = TK_boardWhyText(why);
    say.say(text);
    if (typeof TK_vToast === "function") TK_vToast(text);
  };
  var tracked = function () {
    if (typeof TK_vTrack === "function") TK_vTrack("slate-board-move");
  };
  var clearPending = function (id) {
    setPending(function (p) {
      if (!Object.prototype.hasOwnProperty.call(p, id)) return p;
      var n = Object.assign({}, p);
      delete n[id];
      return n;
    });
  };

  var run = function (plan) {
    if (!plan) return;
    var task = byId[String(plan.id)];
    var from = colOf(plan.fromKey);
    var to = colOf(plan.groupKey);
    var c = check(task, from, to);
    if (!c.ok) {
      // a drop back in its own sorted column is just a cancel
      if (c.why !== "sorted") refuse(c.why);
      return;
    }
    if ((c.action === "reorder" || c.action === "section") && (!o.scope || typeof TK_manualMove !== "function")) return;
    if (c.action === "reorder") {
      TK_manualMove(plan, { scope: o.scope, labelOf: labelOf, say: say.say, undoGroups: cols }).then(function (r) {
        if (r) tracked();
      });
      return;
    }
    if (c.action === "section") {
      TK_manualMove(plan, {
        scope: o.scope,
        sectionOf: function (k) {
          var col = colOf(k);
          return col && col.section ? col.section : null;
        },
        labelOf: labelOf,
        say: null,
        undoGroups: cols,
      }).then(function (r) {
        if (!r) return;
        say.say(TK_boardAnnounce(plan, to.label));
        tracked();
      });
      return;
    }
    // A status column: the status pill's paths. Shown in place now; the store
    // brings the real status back, and a failure puts the card back (the path
    // has toasted).
    var id = String(plan.id);
    setPending(function (p) {
      var n = Object.assign({}, p);
      n[id] = { key: to.key, index: plan.index };
      return n;
    });
    var req =
      c.action === "complete"
        ? TK_vComplete(task, !!o.isAdmin)
        : c.action === "withdraw"
        ? TK_vWithdraw(task)
        : TK_vSetStatus(task, to.status, null, !!o.isAdmin);
    Promise.resolve(req).then(
      function (r) {
        clearPending(id);
        if (!r) {
          say.say("Couldn't move the task. It is back where it was.");
          return;
        }
        if (r.reportPick) return; // the task opened to pick the reports first
        if (o.canReorder && o.scope && typeof TK_manualMove === "function") {
          TK_manualMove(Object.assign({}, plan, { crossGroup: false }), { scope: o.scope });
        }
        say.say(r.sentForReview ? "Sent for review." : TK_boardAnnounce(plan, to.label));
        tracked();
      },
      function () {
        clearPending(id);
        say.say("Couldn't move the task. It is back where it was.");
      },
    );
  };

  var keyMove = function (id, dir) {
    var task = byId[String(id)];
    if (!task) return;
    var r = TK_boardKeyMove(cols, id, dir, function (from, to) {
      return check(task, from, to);
    });
    if (!r) return;
    if (r.why) {
      refuse(r.why);
      return;
    }
    run(r.plan);
  };

  if (typeof TK_useRowDrag === "function") {
    TK_useRowDrag({
      enabled: on && !o.readOnly,
      containerRef: boxRef,
      groups: cols,
      crossGroup: true,
      axis: "x",
      canDrop: function (fromIdx, toIdx, id) {
        var task = byId[String(id)];
        var r = check(task, cols[fromIdx], cols[toIdx]);
        return !!(r && r.ok);
      },
      onBlocked: function (fromIdx, toIdx, id) {
        var task = byId[String(id)];
        var r = check(task, cols[fromIdx], cols[toIdx]);
        if (r && !r.ok) refuse(r.why);
      },
      onMove: run,
      // Slate app interactions: press and hold on touch, the person / date
      // dock, the long-press menu (unset: as before)
      touch: !!o.ixTouch,
      onDropTarget: o.ixDrop,
      onLongPress: o.ixLongPress,
    });
  }

  var ids = on ? TK_boardIds(cols) : [];
  if (!on) return { ids: ids, el: null };

  var focusedId = o.focusedId;
  var firstTab = focusedId != null && ids.indexOf(focusedId) >= 0 ? focusedId : ids[0];
  var dragFor = function (t) {
    if (o.readOnly) return false;
    if (o.kind === "my" && !TK_vLower(t.assignee_email)) return false;
    return true;
  };
  var toggle = function (key, isCol) {
    cPair[1](function (c) {
      var n = Object.assign({}, c);
      n[key] = !isCol;
      return n;
    });
  };

  var el = (
    <div className="tk-board-wrap">
      <p className="tk-sr" id={hintId}>
        Press Enter to open. Alt plus Left or Right arrow moves the task to the next column; Alt plus Up or Down arrow moves it within the column.
      </p>
      <div className="tk-board" ref={boxRef} role="region" aria-label={(o.label || "Tasks") + " board"} data-tour="tk-board">
        {cols.map(function (c, ci) {
          var hid = "tk-bcol-" + ci + "-" + hintId;
          return (
            <section key={c.key} className={"tk-board-col" + (c.status ? " tk-board-col-" + c.status : "") + (c.collapsed ? " is-collapsed" : "")} aria-labelledby={hid}>
              <h3 className="tk-board-head" id={hid}>
                <button
                  type="button"
                  className="tk-board-head-btn"
                  aria-expanded={c.collapsed ? "false" : "true"}
                  onClick={function () {
                    toggle(c.key, c.collapsed);
                  }}
                >
                  <TK_vIcon name="chevron" size={14} className="tk-chev" />
                  <span className="tk-board-name">{c.label}</span>
                  <span className="tk-count">{c.tasks.length}</span>
                </button>
              </h3>
              <ul className={"tk-board-cards" + (c.collapsed ? " is-folded" : "")} data-tk-group={String(ci)} aria-label={c.label}>
                {c.collapsed
                  ? null
                  : c.tasks.map(function (t) {
                      return (
                        <TK_vBoardCard
                          key={t.id}
                          task={t}
                          today={o.today}
                          kids={kidsOf[String(t.id)] || null}
                          clientName={o.showClient !== false && t.client_id != null && o.clientNames ? o.clientNames[String(t.client_id)] || "" : ""}
                          sectionName={o.showSection && t.section ? String(t.section) : ""}
                          nameOf={o.nameOf}
                          focused={focusedId === t.id}
                          tabbable={firstTab === t.id}
                          draggable={dragFor(t)}
                          hintId={hintId}
                          onFocus={o.setFocusedId}
                          onKeyMove={keyMove}
                        />
                      );
                    })}
                {!c.collapsed && !c.tasks.length ? <li className="tk-board-empty">No tasks</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
      {say.el}
    </div>
  );
  return { ids: ids, el: el };
}
