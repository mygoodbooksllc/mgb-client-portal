// Month rhythm S7: "Pre-fill by client type" on the Templates page (admin,
// rhythm preview on). Makes DRAFT templates for the Quarterly and Annual work
// each client type usually needs; a draft never makes tasks until an admin
// activates it. Filings stay on Work > Deadlines. Logic: TK_optionCLogic.js.

// props: { clients, templates, online, onDone() }
function TK_OptionCPanel(props) {
  var typePair = React.useState("church");
  var type = typePair[0];
  var setType = typePair[1];
  var pickPair = React.useState({});
  var picks = pickPair[0];
  var setPicks = pickPair[1];
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];
  var plan = TK_optionCPlan(type, props.clients, props.templates);
  var chosen = plan.items.filter(function (it) {
    return !it.exists && picks[type + "|" + it.title] !== false;
  });
  var make = function () {
    if (!chosen.length || !plan.clientIds.length) return;
    setBusy(true);
    var made = 0;
    var failed = 0;
    var firstErr = null;
    chosen
      .reduce(function (p, it) {
        return p.then(function () {
          var payload = TK_optionCPayload(type, it.title, plan.clientIds);
          if (!payload) return null;
          return TK_api.saveTemplate(null, payload).then(
            function () { made++; },
            function (e) {
              failed++;
              if (!firstErr) firstErr = e;
            },
          );
        });
      }, Promise.resolve())
      .then(function () {
        setBusy(false);
        TK_vToast(
          (made ? made + (made === 1 ? " draft template" : " draft templates") + " made. Review and activate each one when ready." : "") +
            (failed ? (made ? " " : "") + failed + " could not be saved: " + (typeof TK_tplErr === "function" ? TK_tplErr(firstErr) : "try again.") : ""),
        );
        if (props.onDone) props.onDone();
      });
  };
  var typeLabel = (TK_OPTION_C_TYPES.filter(function (x) { return x.key === type; })[0] || {}).label || "";
  return (
    <section className="tk-tpl-card tk-optc" aria-labelledby="tk-optc-title" data-tour="tk-optc">
      <details>
        <summary className="tk-group-head" id="tk-optc-title">
          <span className="tk-group-name">Pre-fill Quarterly and Annual work by client type</span>
        </summary>
        <p className="tk-tpl-card-sub tk-muted">
          Makes draft templates for the work outside the month rhythm. Drafts never make tasks until you activate them. Filings
          (990, 1099, W-2, 941, 940) keep their one date on Work › Deadlines, so they are not here.
        </p>
        <label className="tk-select-wrap tk-groupby">
          <span className="tk-groupby-label">Client type</span>
          <select className="tk-select" value={type} disabled={busy} onChange={function (e) { setType(e.target.value); }}>
            {TK_OPTION_C_TYPES.map(function (x) {
              return <option key={x.key} value={x.key}>{x.label}</option>;
            })}
          </select>
        </label>
        <p className="tk-muted">
          {plan.clientIds.length
            ? "Each draft would reach the " + plan.clientIds.length + " " + typeLabel.toLowerCase() + " on the roster (test clients left out). You can change the clients on each draft."
            : "No " + typeLabel.toLowerCase() + " on the roster."}
        </p>
        <ul className="tk-optc-list">
          {plan.items.map(function (it) {
            var k = type + "|" + it.title;
            var on = !it.exists && picks[k] !== false;
            return (
              <li key={k} className="tk-optc-item">
                <label>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={it.exists || busy}
                    onChange={function (e) {
                      var v = e.target.checked;
                      setPicks(function (p) {
                        var n = Object.assign({}, p);
                        n[k] = v;
                        return n;
                      });
                    }}
                  />
                  <span>
                    <strong>{it.title}</strong>
                    {" · " + (it.cadence === "quarterly" ? "Quarterly" : "Annual") + (it.exists ? " · already a template" : "")}
                  </span>
                </label>
                <span className="tk-muted tk-optc-desc">{it.description}</span>
              </li>
            );
          })}
        </ul>
        {plan.occasional.length ? (
          <p className="tk-muted">{"Occasional ideas (no schedule, add as one-off tasks when they come up): " + plan.occasional.join("; ") + "."}</p>
        ) : null}
        <button
          type="button"
          className="tk-tool-btn is-primary"
          disabled={busy || !props.online || !chosen.length || !plan.clientIds.length}
          onClick={make}
        >
          {busy ? "Making drafts…" : "Make " + chosen.length + (chosen.length === 1 ? " draft" : " drafts")}
        </button>
      </details>
    </section>
  );
}
