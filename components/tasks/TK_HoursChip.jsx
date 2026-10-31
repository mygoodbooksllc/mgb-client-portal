// Slate plus hours-vs-budget chip (hidden preview, docs/slateplus-hours-chip-spec.md).
// Shows "used / budget h" for this calendar month next to a client in the Slate
// client header and at the top of the "Assign to" menus, so overload shows
// before more work is assigned. Reuses HB_useBudgets (components/staff/
// HoursBudget.jsx): same data (client_profile.monthly_hours_budget plus
// QuickBooks Time hours already synced), same permissions (admins read every
// client through qbo_hours_by_client, everyone else only their own clients
// through qbo_my_client_hours) and same thresholds (amber from 80%, red from
// 100%). Read only. Renders nothing when the Slate plus gate is off, the client
// has no budget, or the hours are unknown. Rules: TK_hoursChipLogic.js.
//
// props: { clientId }
function TK_HoursChip(props) {
  var plusOn = typeof TKP_useOn === "function" ? TKP_useOn() : false;
  var staff = TK_vUseStore(function (s) {
    return s ? s.staff : null;
  });
  var me = TK_vUseStore(function (s) {
    return s ? s.me : null;
  });
  var ready = plusOn && !!props.clientId && typeof HB_useBudgets === "function" && typeof TKH_chip === "function";
  // Explicit admin flag so the right RPC is used even outside the portal's
  // staff context (the Slate app window).
  var data = typeof HB_useBudgets === "function" ? HB_useBudgets(ready, TKH_isAdmin(staff, me)) : null;
  var chip = ready ? TKH_chip(data, props.clientId) : null;
  if (!chip) return null;
  return (
    <span
      className={"tkh-chip tkh-" + chip.state}
      title={chip.title}
      aria-label={"Hours this month: " + chip.text + (chip.state === "over" ? ", over budget" : chip.state === "near" ? ", 80% or more of the budget" : "")}
    >
      <span className="tkh-text">{chip.text}</span>
    </span>
  );
}
