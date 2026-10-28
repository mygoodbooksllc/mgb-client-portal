// ----------------------------------------------------------------------------
// TK_Calendar.jsx: the Calendar view for Slate (month grid), hidden behind the
// Slate plus gate (TKP_useOn(); nobody sees it until launch).
//
// Exports: TK_useCalendar, TK_CalendarView
//
// Front end only, no database change. It shows the tasks the list on that page
// already loaded and filtered (the Slate page's search, client and Slate plus
// filters; a client / project / person list's own filters), so it never reads
// anything new. Rules (month grid, buckets, arrow keys) are in
// TK_calendarLogic.js (node test). A drag, or the keyboard, changes the due date
// through TK_vRowSave (the same path as the due chip on a row, so the same
// checks and the same optimistic save), with an Undo on the toast.
//
// Use: var cal = TK_useCalendar({ enabled, tasks, today, ... });
//   cal.switchEl   the "Calendar" toggle for the toolbar (null when off)
//   cal.on         true while the calendar replaces the list body
//   cal.el         the calendar
// ----------------------------------------------------------------------------

// opts: { enabled (page allows it), tasks (already filtered; done included; or a
// function returning them, called only while the calendar is showing),
// today, clientNames, readOnly, isAdmin, email, label }
function TK_useCalendar(opts) {
  var o = opts || {};
  var plusOn = typeof TKP_useOn === "function" ? TKP_useOn() : false;
  var can = !!plusOn && !!o.enabled && typeof TKC_monthGrid === "function";
  var pair = React.useState(false);
  var on = can && pair[0];
  var switchEl = can ? (
    <button
      type="button"
      className={"tk-tool-btn tk-cal-switch" + (on ? " is-on" : "")}
      aria-pressed={on ? "true" : "false"}
      title={on ? "Back to the list" : "See tasks on a month calendar by due date"}
      data-tour="tk-calendar-switch"
      onClick={function () {
        pair[1](!pair[0]);
      }}
    >
      <TK_vIcon name="calendar" size={15} />
      <span>Calendar</span>
    </button>
  ) : null;
  return {
    can: can,
    on: on,
    switchEl: switchEl,
    el: on ? <TK_CalendarView tasks={(typeof o.tasks === "function" ? o.tasks() : o.tasks) || []} today={o.today} clientNames={o.clientNames || {}} readOnly={!!o.readOnly} isAdmin={!!o.isAdmin} email={o.email} label={o.label || "Slate"} /> : null,
  };
}

function TK_calNarrow() {
  var pair = React.useState(function () {
    try {
      return window.matchMedia ? window.matchMedia("(max-width: 640px)").matches : false;
    } catch (e) {
      return false;
    }
  });
  React.useEffect(function () {
    var mq = null;
    try {
      mq = window.matchMedia ? window.matchMedia("(max-width: 640px)") : null;
    } catch (e) {
      mq = null;
    }
    if (!mq) return undefined;
    var fn = function () {
      pair[1](!!mq.matches);
    };
    if (mq.addEventListener) mq.addEventListener("change", fn);
    else if (mq.addListener) mq.addListener(fn);
    return function () {
      if (mq.removeEventListener) mq.removeEventListener("change", fn);
      else if (mq.removeListener) mq.removeListener(fn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return pair[0];
}

function TK_calChipTitle(t, clientName, today) {
  var bits = [t.text || "Untitled task"];
  if (clientName) bits.push(clientName);
  var tone = typeof TK_rwDueTone === "function" ? TK_rwDueTone(t, today) : "";
  if (tone === "late") bits.push("overdue");
  if (TKC_isDone(t)) bits.push("done");
  return bits.join(", ");
}

// props: { tasks, today, clientNames, readOnly, isAdmin, email, label }
function TK_CalendarView(props) {
  var today = props.today || (typeof TK_vToday === "function" ? TK_vToday() : "");
  var narrow = TK_calNarrow();
  var cap = TKC_chipCap(narrow);
  var ymPair = React.useState(function () {
    return TKC_monthOf(today) || { y: new Date().getFullYear(), m: new Date().getMonth() + 1 };
  });
  var ym = ymPair[0];
  var focusPair = React.useState(today);
  var focusDate = focusPair[0];
  var popPair = React.useState("");
  var popDate = popPair[0];
  var dragPair = React.useState({ id: null, over: "" });
  var drag = dragPair[0];
  var sayPair = React.useState("");
  var rootRef = React.useRef(null);
  var popRef = React.useRef(null);
  var returnRef = React.useRef("");

  var data = React.useMemo(
    function () {
      return TKC_bucket(props.tasks);
    },
    [props.tasks],
  );
  var grid = React.useMemo(
    function () {
      return TKC_monthGrid(ym);
    },
    [ym],
  );
  var names = props.clientNames || {};
  var byId = {};
  (props.tasks || []).forEach(function (t) {
    if (t && t.id != null) byId[t.id] = t;
  });

  var canEdit = function (t) {
    if (props.readOnly) return false;
    if (typeof TK_rwAccess !== "function") return true;
    return TK_rwAccess(t, { me: props.email, isAdmin: props.isAdmin, canEdit: true, online: true }).edit;
  };

  // the roving focus date has to be a date in the shown month
  var inShown = false;
  grid.forEach(function (r) {
    r.forEach(function (c) {
      if (c.date === focusDate && c.inMonth) inShown = true;
    });
  });
  var tabDate = inShown ? focusDate : TKC_monthOf(today) && TKC_monthOf(today).y === ym.y && TKC_monthOf(today).m === ym.m ? today : TKC_iso(ym.y, ym.m, 1);

  var goMonth = function (delta) {
    ymPair[1](TKC_shiftMonth(ym, delta));
    popPair[1]("");
  };
  var goToday = function () {
    ymPair[1](TKC_monthOf(today) || ym);
    focusPair[1](today);
    popPair[1]("");
  };
  var focusCell = function (iso) {
    focusPair[1](iso);
    window.setTimeout(function () {
      var el = rootRef.current ? rootRef.current.querySelector('[data-cal-date="' + iso + '"]') : null;
      if (el) {
        try {
          el.focus({ preventScroll: false });
        } catch (e) {}
      }
    }, 0);
  };

  var openTask = function (id) {
    if (typeof TK_vOpenTask === "function") TK_vOpenTask(id, { from: "list" });
  };

  var moveTask = function (t, iso) {
    if (!t || !TKC_dropOK(t, iso) || !canEdit(t)) return;
    var prev = t.due_date ? String(t.due_date).slice(0, 10) : null;
    var label = TKC_dayLabel(iso);
    sayPair[1]("Moved " + (t.text || "task") + " to " + label);
    TK_vRowSave(t, { due_date: iso }).then(function (res) {
      if (!res) return;
      if (typeof TK_vToast !== "function") return;
      TK_vToast("Due date moved to " + label + ".", {
        label: "Undo",
        onClick: function () {
          TK_vRowSave(t, { due_date: prev });
        },
      });
    });
  };

  var closePop = function (refocus) {
    var back = returnRef.current;
    popPair[1]("");
    if (refocus && back) focusCell(back);
  };
  var openPop = function (iso) {
    returnRef.current = iso;
    popPair[1](iso);
  };

  React.useEffect(
    function () {
      if (!popDate) return undefined;
      var first = popRef.current ? popRef.current.querySelector("button") : null;
      if (first) {
        try {
          first.focus({ preventScroll: true });
        } catch (e) {}
      }
      var onDoc = function (e) {
        if (popRef.current && popRef.current.contains(e.target)) return;
        if (e.target && e.target.closest && e.target.closest(".tk-cal-more")) return;
        popPair[1]("");
      };
      document.addEventListener("mousedown", onDoc, true);
      document.addEventListener("touchstart", onDoc, true);
      return function () {
        document.removeEventListener("mousedown", onDoc, true);
        document.removeEventListener("touchstart", onDoc, true);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [popDate],
  );

  var onCellKey = function (e, iso, tasksHere) {
    if (e.target !== e.currentTarget) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var next = TKC_arrow(iso, e.key);
    if (next) {
      e.preventDefault();
      var nm = TKC_monthOf(next);
      if (nm && (nm.y !== ym.y || nm.m !== ym.m)) ymPair[1](nm);
      focusCell(next);
      return;
    }
    if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      var d = e.key === "PageDown" ? 1 : -1;
      var to = TKC_shiftMonth(ym, d);
      ymPair[1](to);
      var p = TKC_parse(iso);
      var last = new Date(Date.UTC(to.y, to.m, 0)).getUTCDate();
      focusCell(TKC_iso(to.y, to.m, Math.min(p ? p.d : 1, last)));
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && tasksHere.length) {
      e.preventDefault();
      openPop(iso);
    }
  };

  var chipFor = function (t) {
    var cname = t.client_id != null ? names[String(t.client_id)] || "" : "";
    var tone = typeof TK_rwDueTone === "function" ? TK_rwDueTone(t, today) : "";
    var done = TKC_isDone(t);
    var movable = canEdit(t);
    return (
      <button
        key={t.id}
        type="button"
        className={"tk-cal-chip" + (tone === "late" ? " is-late" : "") + (done ? " is-done" : "") + (movable ? " is-draggable" : "") + (drag.id === t.id ? " is-dragging" : "")}
        data-tk-id={t.id}
        title={TK_calChipTitle(t, cname, today)}
        draggable={movable ? "true" : undefined}
        onDragStart={
          movable
            ? function (e) {
                try {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(t.id));
                } catch (er) {}
                dragPair[1]({ id: t.id, over: "" });
              }
            : undefined
        }
        onDragEnd={function () {
          dragPair[1]({ id: null, over: "" });
        }}
        onClick={function (e) {
          e.stopPropagation();
          openTask(t.id);
        }}
        onKeyDown={function (e) {
          e.stopPropagation();
        }}
      >
        <span className="tk-cal-chip-text">{t.text || "Untitled task"}</span>
        <span className="tk-sr">{tone === "late" ? ", overdue" : done ? ", done" : ""}</span>
      </button>
    );
  };

  var dows = TKC_dowLabels();
  var popTasks = popDate ? data.byDate[popDate] || [] : [];
  var noDueText = TKC_noDueText(data.noDue);
  var title = TKC_monthLabel(ym);
  var titleId = "tk-cal-title";

  return (
    <div className="tk-cal" ref={rootRef} data-tour="tk-calendar" aria-label={(props.label || "Slate") + " calendar"}>
      <div className="tk-cal-bar">
        <h3 className="tk-cal-title" id={titleId} aria-live="polite">
          {title}
        </h3>
        <span className="tk-cal-nav">
          <button type="button" className="tk-icon-btn tk-cal-prev" aria-label="Previous month" onClick={function () { goMonth(-1); }}>
            <TK_vIcon name="chevron" size={16} className="tk-cal-flip" />
          </button>
          <button type="button" className="tk-tool-btn tk-cal-today" onClick={goToday}>
            Today
          </button>
          <button type="button" className="tk-icon-btn tk-cal-next" aria-label="Next month" onClick={function () { goMonth(1); }}>
            <TK_vIcon name="chevron" size={16} />
          </button>
        </span>
      </div>
      <div className="tk-cal-grid" role="grid" aria-labelledby={titleId}>
        <div className="tk-cal-row tk-cal-dows" role="row">
          {dows.map(function (d) {
            return (
              <div key={d} className="tk-cal-dow" role="columnheader">
                {d}
              </div>
            );
          })}
        </div>
        {grid.map(function (row, ri) {
          return (
            <div key={ri} className="tk-cal-row" role="row">
              {row.map(function (cell) {
                var here = data.byDate[cell.date] || [];
                var sp = TKC_split(here, cap);
                var isToday = cell.date === today;
                var over = drag.over === cell.date;
                return (
                  <div
                    key={cell.date}
                    role="gridcell"
                    className={"tk-cal-cell" + (cell.inMonth ? "" : " is-out") + (isToday ? " is-today" : "") + (over ? " is-over" : "")}
                    data-cal-date={cell.date}
                    tabIndex={cell.date === tabDate ? 0 : -1}
                    aria-label={TKC_dayLabel(cell.date) + (isToday ? ", today" : "") + ", " + (here.length ? here.length + (here.length === 1 ? " task" : " tasks") : "no tasks")}
                    aria-current={isToday ? "date" : undefined}
                    onFocus={function (e) {
                      if (e.target === e.currentTarget) focusPair[1](cell.date);
                    }}
                    onKeyDown={function (e) {
                      onCellKey(e, cell.date, here);
                    }}
                    onDragOver={function (e) {
                      var t = drag.id != null ? byId[drag.id] : null;
                      if (!t || !TKC_dropOK(t, cell.date)) return;
                      e.preventDefault();
                      if (drag.over !== cell.date) dragPair[1]({ id: drag.id, over: cell.date });
                    }}
                    onDrop={function (e) {
                      var t = drag.id != null ? byId[drag.id] : null;
                      e.preventDefault();
                      dragPair[1]({ id: null, over: "" });
                      if (t) moveTask(t, cell.date);
                    }}
                  >
                    <span className="tk-cal-day" aria-hidden="true">
                      {cell.day}
                    </span>
                    <div className="tk-cal-chips">
                      {sp.shown.map(chipFor)}
                      {sp.more ? (
                        <button
                          type="button"
                          className="tk-cal-more"
                          aria-haspopup="dialog"
                          onClick={function (e) {
                            e.stopPropagation();
                            openPop(cell.date);
                          }}
                        >
                          {"+" + sp.more + " more"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {noDueText ? (
        <p className="tk-cal-foot" data-tour="tk-calendar-nodue">
          {noDueText}
          <span className="tk-cal-foot-hint"> and are not on the calendar.</span>
        </p>
      ) : null}
      {popDate ? (
        <div
          className="tk-cal-pop"
          ref={popRef}
          role="dialog"
          aria-label={TKC_dayLabel(popDate) + ", " + popTasks.length + (popTasks.length === 1 ? " task" : " tasks")}
          onKeyDown={function (e) {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closePop(true);
            }
          }}
        >
          <div className="tk-cal-pop-head">
            <strong>{TKC_dayLabel(popDate)}</strong>
            <button type="button" className="tk-icon-btn" aria-label="Close" onClick={function () { closePop(true); }}>
              <span aria-hidden="true">{"\u00d7"}</span>
            </button>
          </div>
          <ul className="tk-cal-pop-list">
            {popTasks.map(function (t) {
              var cname = t.client_id != null ? names[String(t.client_id)] || "" : "";
              var tone = typeof TK_rwDueTone === "function" ? TK_rwDueTone(t, today) : "";
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className={"tk-cal-pop-item" + (tone === "late" ? " is-late" : "") + (TKC_isDone(t) ? " is-done" : "")}
                    onClick={function () {
                      popPair[1]("");
                      openTask(t.id);
                    }}
                  >
                    <span className="tk-cal-pop-text">{t.text || "Untitled task"}</span>
                    {cname ? <span className="tk-cal-pop-client">{cname}</span> : null}
                    <span className="tk-sr">{tone === "late" ? ", overdue" : TKC_isDone(t) ? ", done" : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="tk-sr" role="status" aria-live="polite">
        {sayPair[0]}
      </div>
    </div>
  );
}
