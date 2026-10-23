// Month rhythm S6: the per-person "The thirds | Close order" choice on a
// client's list (Option A or B). Pure grouping lives in TK_closeOrderLogic.js.
// Shown only with the rhythm preview on; the choice is this browser's own
// (localStorage), never a data change.

// opts: { email, clientId, on, reloadKey }. Returns { on, choice, setChoice, refs, waitingIds }.
function TK_useCloseOrder(opts) {
  var o = opts || {};
  var on = !!o.on && o.clientId != null && typeof TK_rhythmEnabled === "function" && TK_rhythmEnabled();
  var key = typeof TK_closeOrderKey === "function" ? TK_closeOrderKey(o.email) : null;
  var cid = o.clientId != null ? String(o.clientId) : "";
  var choicePair = React.useState(function () {
    return key ? TK_closeOrderChoice(TK_vLsGet(key, {}), cid) : "A";
  });
  var setChoiceState = choicePair[1];
  React.useEffect(function () {
    setChoiceState(key ? TK_closeOrderChoice(TK_vLsGet(key, {}), cid) : "A");
  }, [key, cid]);
  var choice = on ? choicePair[0] : "A";
  var refsPair = React.useState(null);
  var waitPair = React.useState({});
  var setRefs = refsPair[1];
  var setWait = waitPair[1];
  React.useEffect(function () {
    if (!on || choice !== "B" || typeof TK_api === "undefined") return undefined;
    var live = true;
    if (typeof TK_api.rhythmTemplateRefs === "function") {
      TK_api.rhythmTemplateRefs().then(function (m) { if (live) setRefs(m || {}); }, function () {});
    }
    if (typeof TK_api.listClientRequests === "function") {
      TK_api.listClientRequests(null, cid).then(function (rows) {
        if (live) setWait(TK_closeOrderWaitingIds(rows));
      }, function () { if (live) setWait({}); });
    }
    return function () { live = false; };
  }, [on, choice, cid, o.reloadKey]);
  var setChoice = function (next) {
    var v = next === "B" ? "B" : "A";
    setChoiceState(v);
    if (key) TK_vLsSet(key, TK_closeOrderSave(TK_vLsGet(key, {}), cid, v));
  };
  return {
    on: on,
    choice: choice,
    setChoice: setChoice,
    refs: choice === "B" ? refsPair[0] : null,
    waitingIds: waitPair[0],
  };
}

// props: { value: "A" | "B", onChange(v) }
function TK_CloseOrderSwitch(props) {
  return (
    <label className="tk-select-wrap tk-groupby tk-close-order-switch" data-tour="tk-close-order">
      <span className="tk-groupby-label">Month view</span>
      <select
        className="tk-select"
        value={props.value === "B" ? "B" : "A"}
        aria-label="Month view for this client"
        title="Your own choice for this client's list. Nobody else's view changes."
        onChange={function (e) { props.onChange(e.target.value); }}
      >
        <option value="A">The thirds</option>
        <option value="B">Close order</option>
      </select>
    </label>
  );
}
