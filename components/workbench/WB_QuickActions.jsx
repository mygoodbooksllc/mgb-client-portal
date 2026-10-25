// ----------------------------------------------------------------------------
// WB_QuickActions: small pieces shared by the Desk additions (hidden preview,
// WB_plus.js gate; docs/workbench-hub-spec.md section 3, slices S3 and S4).
//
// WB_AskClientModal({ clientId, clientName, onClose })
//   TK_AskClientModal, unmodified, opened task-less (taskId: null). The server
//   decides everything about sending (test clients get only a [Test] copy to
//   the sender; clients whose emails are not switched on get a dry run), so
//   nothing is gated here. TK_api.askClient fires mgb:tk-requests-changed, which
//   the Client tab's Waiting section already listens to.
//   Drawn into <body> (a portal) so it never sits inside the rail or the Desk
//   column (their arrow-key and focus handlers would see its keystrokes); key
//   events are stopped at the wrapper for the same reason. The overlay is the
//   usual .modal-overlay, which the Desk's Esc ladder already treats as a layer
//   (WB_LAYERS "modal"), so Esc closes the modal before the Desk.
//
// Browser file; loads after WB_HubClient.jsx. Uses TK_* and React globals at
// render time only.
// ----------------------------------------------------------------------------

function WB_AskClientModal(props) {
  if (typeof TK_AskClientModal !== "function" || typeof ReactDOM === "undefined" || typeof ReactDOM.createPortal !== "function") return null;
  var close = props.onClose;
  return ReactDOM.createPortal(
    <div
      className="wb-ask-host"
      onKeyDown={function (e) {
        e.stopPropagation();
      }}
    >
      <TK_AskClientModal
        clientId={props.clientId}
        clientName={props.clientName || ""}
        taskId={null}
        onClose={close}
        onAsked={close}
      />
    </div>,
    document.body,
  );
}
