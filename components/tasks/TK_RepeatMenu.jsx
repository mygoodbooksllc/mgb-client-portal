// Slate Repeat menu: the editor for a custom repeat rule.
//
// Used in two places:
//   - the task drawer's Repeat row ("Custom…"): kind "task", with Save / Cancel,
//   - the recurring template editor ("Custom schedule"): kind "template", live
//     (every change goes up through onChange; the template form has its own Save).
// The rule is plain JSON; the date math lives in TK_repeatLogic.js and has an
// SQL twin in supabase/repeat-menu.sql. Names start with TK_Repeat / TK_rpt.

var TK_RPT_PRESETS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom (every N days, weeks, months or years)" },
];

var TK_RPT_UNITS = [
  { value: "daily", one: "day", many: "days" },
  { value: "weekly", one: "week", many: "weeks" },
  { value: "monthly", one: "month", many: "months" },
  { value: "yearly", one: "year", many: "years" },
];

var TK_RPT_NTH = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: -1, label: "last" },
];

var TK_RPT_TZ = "America/Chicago";

// Which preset a rule reads as: Daily, Weekly, Monthly, Quarterly, Yearly, or Custom.
function TK_rptPresetOf(rule) {
  if (!rule) return "weekly";
  var n = rule.interval == null ? 1 : rule.interval;
  if (rule.freq === "daily" && n === 1) return "daily";
  if (rule.freq === "weekly" && n === 1) return "weekly";
  if (rule.freq === "monthly" && n === 1) return "monthly";
  if (rule.freq === "monthly" && n === 3) return "quarterly";
  if (rule.freq === "yearly" && n === 1) return "yearly";
  return "custom";
}

function TK_rptCopy(rule) {
  return JSON.parse(JSON.stringify(rule));
}

// A rule moved to another frequency: keeps skip, time, end (and start / seen),
// takes fresh day settings for the new frequency.
function TK_rptWithFreq(rule, freq, interval, startYmd) {
  var fresh = TK_repeatDefault(freq, startYmd);
  var out = TK_rptCopy(fresh);
  out.interval = interval;
  out.skip = !!rule.skip;
  out.end = rule.end ? TK_rptCopy(rule.end) : { type: "never" };
  if (rule.time) {
    out.time = rule.time;
    out.tz = rule.tz || TK_RPT_TZ;
  }
  if (rule.start) out.start = rule.start;
  if (rule.seen != null) out.seen = rule.seen;
  return out;
}

function TK_rptAddDays(ymd, n) {
  var p = String(ymd || "").split("-");
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
  var z = function (v) {
    return v < 10 ? "0" + v : String(v);
  };
  return d.getUTCFullYear() + "-" + z(d.getUTCMonth() + 1) + "-" + z(d.getUTCDate());
}

// The next `count` due dates. A template lists its schedule from its first date.
// A task lists its own due date, then each date the finished task would roll to
// (the same steps complete_staff_item takes), so the preview is what staff see.
function TK_rptPreview(rule, kind, startYmd, holidays, count, savedRule) {
  if (!rule || !TK_repeatValid(rule)) return [];
  if (kind === "template") {
    if (!rule.start) return [];
    return TK_repeatSeries(rule, rule.start, TK_rptAddDays(rule.start, 366 * 30), holidays, count);
  }
  var out = [];
  var cur = startYmd;
  var r = TK_rptCopy(rule);
  r.start = TK_repeatSaveStart(savedRule, rule, startYmd); // as the task saves it: an unchanged schedule keeps its start
  if (!cur) return out;
  out.push(cur);
  while (out.length < count) {
    if (!TK_repeatMoreToCome(r)) break;
    var next = TK_repeatNext(r, cur, cur, holidays);
    if (!next) break;
    out.push(next);
    cur = next;
    r = TK_repeatAdvance(r);
  }
  return out;
}

function TK_rptDateLabel(ymd) {
  var p = String(ymd || "").split("-");
  if (p.length !== 3) return ymd || "";
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// What the editor needs from a rule to be saved: null when fine, else a sentence.
function TK_rptProblem(rule, kind) {
  if (!rule) return "Pick how often it repeats.";
  if (kind === "template" && !/^\d{4}-\d{2}-\d{2}$/.test(String(rule.start || ""))) return "Pick the first date.";
  if (!TK_repeatValid(rule)) return "That schedule doesn't work. Check the numbers.";
  return null;
}

// props: { value, kind: "task" | "template", start (ymd), today (ymd), holidays,
//          withTime, live (call onChange on every edit), onChange(rule),
//          onSave(rule), onCancel(), busy, idPrefix }
function TK_RepeatEditor(props) {
  var kind = props.kind === "template" ? "template" : "task";
  var anchor = props.start || props.today || "";
  var idp = props.idPrefix || "tk-rpt";
  var initial = props.value && TK_repeatValid(props.value) ? props.value : null;
  var rs = React.useState(function () {
    var r = initial ? TK_rptCopy(initial) : TK_repeatDefault("weekly", anchor);
    if (kind === "template" && !r.start && anchor) r.start = anchor;
    return r;
  });
  var rule = rs[0];
  var setRule = rs[1];
  var ms = React.useState(function () {
    return TK_rptPresetOf(initial);
  });
  var preset = ms[0];
  var setPreset = ms[1];

  var change = function (next) {
    setRule(next);
    if (props.live && props.onChange) props.onChange(next);
  };
  var patch = function (bits) {
    var next = TK_rptCopy(rule);
    Object.keys(bits).forEach(function (k) {
      if (bits[k] === undefined) delete next[k];
      else next[k] = bits[k];
    });
    change(next);
  };

  var interval = rule.interval == null ? 1 : rule.interval;
  var freqUnit = TK_RPT_UNITS.filter(function (u) {
    return u.value === rule.freq;
  })[0] || TK_RPT_UNITS[1];

  var pickPreset = function (v) {
    setPreset(v);
    if (v === "custom") return;
    var freq = v === "quarterly" ? "monthly" : v;
    var n = v === "quarterly" ? 3 : 1;
    change(TK_rptWithFreq(rule, freq, n, anchor));
  };
  var pickUnit = function (freq) {
    change(TK_rptWithFreq(rule, freq, interval, anchor));
  };

  var dows = Array.isArray(rule.dows) && rule.dows.length ? rule.dows : null;
  var toggleDow = function (n) {
    var cur = dows ? dows.slice() : [];
    var i = cur.indexOf(n);
    if (i >= 0) {
      if (cur.length === 1) return; // keep at least one day
      cur.splice(i, 1);
    } else cur.push(n);
    cur.sort(function (a, b) {
      return a - b;
    });
    patch({ dows: cur });
  };

  var by = rule.by || "dom";
  var monthly = rule.freq === "monthly";
  var yearly = rule.freq === "yearly";
  var anchorDay = anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? Number(anchor.slice(8, 10)) : 1;
  var pickBy = function (v) {
    if (v === "dom") patch({ by: "dom", day: rule.day || anchorDay, n: undefined, dow: undefined });
    else if (v === "nth") patch({ by: "nth", n: rule.n || 1, dow: rule.dow || 1, day: undefined });
    else patch({ by: "last", day: undefined, n: undefined, dow: undefined });
  };

  var endType = rule.end && rule.end.type ? rule.end.type : "never";
  var pickEnd = function (v) {
    if (v === "never") patch({ end: { type: "never" } });
    else if (v === "on") patch({ end: { type: "on", date: (rule.end && rule.end.date) || TK_rptAddDays(anchor || props.today || "2026-01-01", 365) } });
    else patch({ end: { type: "count", n: (rule.end && rule.end.n) || 10 } });
  };

  var hasTime = !!rule.time;
  var problem = TK_rptProblem(rule, kind);
  var holidays = props.holidays || [];
  var dates = TK_rptPreview(rule, kind, anchor, holidays, 5, initial);
  var summary = TK_repeatText(rule, kind === "template" ? rule.start || anchor : anchor);

  var numberInput = function (id, value, min, max, onVal, label) {
    return (
      <input
        id={id}
        type="number"
        className="tk-dw-input tk-rpt-num"
        min={min}
        max={max}
        step="1"
        defaultValue={value}
        key={id + ":" + preset + ":" + rule.freq + ":" + (rule.by || "")}
        aria-label={label}
        disabled={props.busy}
        onBlur={function (e) {
          var v = e.target.value === "" ? "" : Number(e.target.value);
          onVal(v);
        }}
        onChange={function (e) {
          // commit as soon as it is a usable number; an empty box waits for blur
          if (e.target.value !== "" && Number(e.target.value) >= min && Number(e.target.value) <= max) onVal(Number(e.target.value));
        }}
      />
    );
  };

  return (
    <div className="tk-rpt" data-tour="tk-repeat-menu">
      {kind === "template" ? (
        <div className="tk-rpt-row">
          <label className="tk-rpt-label" htmlFor={idp + "-start"}>
            First date
          </label>
          <input
            id={idp + "-start"}
            type="date"
            className="tk-dw-input tk-rpt-date"
            value={rule.start || ""}
            disabled={props.busy}
            onChange={function (e) { patch({ start: e.target.value || undefined }); }}
          />
        </div>
      ) : null}

      <div className="tk-rpt-row">
        <label className="tk-rpt-label" htmlFor={idp + "-preset"}>
          Repeats
        </label>
        <select id={idp + "-preset"} className="tk-dw-select" value={preset} disabled={props.busy} onChange={function (e) { pickPreset(e.target.value); }}>
          {TK_RPT_PRESETS.map(function (p) {
            return (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            );
          })}
        </select>
      </div>

      {preset === "custom" ? (
        <div className="tk-rpt-row">
          <span className="tk-rpt-label">Every</span>
          <div className="tk-rpt-inline">
            {numberInput(idp + "-interval", interval, 1, 99, function (v) { patch({ interval: v === "" ? 1 : Math.max(1, Math.min(99, v)) }); }, "Repeat every")}
            <select
              className="tk-dw-select"
              aria-label="Unit"
              value={rule.freq}
              disabled={props.busy}
              onChange={function (e) { pickUnit(e.target.value); }}
            >
              {TK_RPT_UNITS.map(function (u) {
                return (
                  <option key={u.value} value={u.value}>
                    {interval === 1 ? u.one : u.many}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      ) : null}

      {rule.freq === "weekly" ? (
        <div className="tk-rpt-row">
          <span className="tk-rpt-label" id={idp + "-dows"}>
            On
          </span>
          <div className="tk-rpt-dows" role="group" aria-labelledby={idp + "-dows"}>
            {[1, 2, 3, 4, 5, 6, 7].map(function (n) {
              var picked = dows ? dows.indexOf(n) >= 0 : false;
              return (
                <button
                  key={n}
                  type="button"
                  className={"tk-rpt-dow" + (picked ? " is-on" : "")}
                  aria-pressed={picked}
                  aria-label={TK_REPEAT_DOW_NAMES[n]}
                  disabled={props.busy}
                  onClick={function () { toggleDow(n); }}
                >
                  {TK_REPEAT_DOW_SHORT[n].charAt(0) + TK_REPEAT_DOW_SHORT[n].charAt(1)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {monthly ? (
        <div className="tk-rpt-row">
          <label className="tk-rpt-label" htmlFor={idp + "-by"}>
            On
          </label>
          <div className="tk-rpt-inline">
            <select id={idp + "-by"} className="tk-dw-select" value={by} disabled={props.busy} onChange={function (e) { pickBy(e.target.value); }}>
              <option value="dom">A day of the month</option>
              <option value="nth">A weekday, like the 2nd Tuesday</option>
              <option value="last">The last day of the month</option>
            </select>
            {by === "dom"
              ? numberInput(idp + "-day", rule.day == null ? anchorDay : rule.day, 1, 31, function (v) { patch({ day: v === "" ? 1 : Math.max(1, Math.min(31, v)) }); }, "Day of the month")
              : null}
            {by === "nth" ? (
              <React.Fragment>
                <select className="tk-dw-select" aria-label="Which one" value={rule.n || 1} disabled={props.busy} onChange={function (e) { patch({ n: Number(e.target.value) }); }}>
                  {TK_RPT_NTH.map(function (o) {
                    return (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    );
                  })}
                </select>
                <select className="tk-dw-select" aria-label="Weekday" value={rule.dow || 1} disabled={props.busy} onChange={function (e) { patch({ dow: Number(e.target.value) }); }}>
                  {[1, 2, 3, 4, 5, 6, 7].map(function (n) {
                    return (
                      <option key={n} value={n}>
                        {TK_REPEAT_DOW_NAMES[n]}
                      </option>
                    );
                  })}
                </select>
              </React.Fragment>
            ) : null}
          </div>
        </div>
      ) : null}

      {yearly ? (
        <p className="tk-field-help tk-rpt-note">
          {kind === "template" ? "It repeats on the same month and day as the first date." : "It repeats on the same month and day as the due date."}
        </p>
      ) : null}

      <div className="tk-rpt-row">
        <label className="tk-rpt-label" htmlFor={idp + "-end"}>
          Ends
        </label>
        <div className="tk-rpt-inline">
          <select id={idp + "-end"} className="tk-dw-select" value={endType} disabled={props.busy} onChange={function (e) { pickEnd(e.target.value); }}>
            <option value="never">Never</option>
            <option value="on">On a date</option>
            <option value="count">After a number of times</option>
          </select>
          {endType === "on" ? (
            <input
              type="date"
              className="tk-dw-input tk-rpt-date"
              aria-label="Last date"
              value={(rule.end && rule.end.date) || ""}
              disabled={props.busy}
              onChange={function (e) { patch({ end: { type: "on", date: e.target.value || "" } }); }}
            />
          ) : null}
          {endType === "count"
            ? numberInput(idp + "-count", (rule.end && rule.end.n) || 1, 1, 999, function (v) { patch({ end: { type: "count", n: v === "" ? 1 : Math.max(1, Math.min(999, v)) } }); }, "Number of times")
            : null}
          {endType === "count" ? <span className="tk-rpt-unit">times</span> : null}
        </div>
      </div>

      {props.withTime !== false ? (
        <div className="tk-rpt-row">
          <span className="tk-rpt-label">Time</span>
          <div className="tk-rpt-inline">
            <label className="tk-dw-check">
              <input
                type="checkbox"
                checked={hasTime}
                disabled={props.busy}
                onChange={function (e) { patch(e.target.checked ? { time: "09:00", tz: TK_RPT_TZ } : { time: undefined, tz: undefined }); }}
              />
              <span>Due at a set time</span>
            </label>
            {hasTime ? (
              <input
                type="time"
                className="tk-dw-input tk-rpt-time"
                aria-label="Time of day"
                value={rule.time || "09:00"}
                disabled={props.busy}
                onChange={function (e) { patch({ time: e.target.value || "09:00", tz: TK_RPT_TZ }); }}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="tk-rpt-row">
        <span className="tk-rpt-label">Skip</span>
        <label className="tk-dw-check">
          <input type="checkbox" checked={!!rule.skip} disabled={props.busy} onChange={function (e) { patch({ skip: e.target.checked }); }} />
          <span>Skip weekends and firm holidays (use the next business day)</span>
        </label>
      </div>

      <div className="tk-rpt-sum" aria-live="polite">
        <p className="tk-rpt-sum-line">{problem ? problem : summary}</p>
        {!problem && dates.length ? (
          <div>
            <p className="tk-field-help tk-rpt-next-title">{kind === "template" ? "Next " + dates.length + " dates" : "This task, then the next ones"}</p>
            <ol className="tk-rpt-next">
              {dates.map(function (d, i) {
                return <li key={d + i}>{TK_rptDateLabel(d)}</li>;
              })}
            </ol>
          </div>
        ) : null}
      </div>

      {!props.live ? (
        <div className="tk-rpt-actions">
          <button type="button" className="tk-btn" disabled={props.busy} onClick={function () { if (props.onCancel) props.onCancel(); }}>
            Cancel
          </button>
          <button
            type="button"
            className="tk-btn tk-btn-primary"
            disabled={props.busy || !!problem}
            onClick={function () { if (!problem && props.onSave) props.onSave(rule); }}
          >
            Save repeat
          </button>
        </div>
      ) : null}
    </div>
  );
}
