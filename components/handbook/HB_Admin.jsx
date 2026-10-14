// Staff Handbook: admin tools (spec docs/staff-handbook-spec.md, Parts A, C, E).
//
//   HB_StatusGrid({ status })        Team › Handbook list: policies down the
//                                    side, active bookkeepers across the top.
//   HB_UnfiledCard({ status })       countersigned copies not filed to Drive,
//                                    each with Retry filing (hb_retry_export).
//   HB_PublishEditor({ policy, version, bookkeeperCount, onDone, onCancel })
//                                    the "Publish new version" editor in the
//                                    policy view (latest version only).
//
// Only shown to admins; the database checks admin on every call anyway
// (hb_status returns grid / unfiled only for admins, hb_publish_version and
// hb_retry_export refuse anyone else).
//
// Name care: HoursBudget.jsx owns HB_Cell / HB_Bar / .hb-over / .hb-tag, so
// this file uses HB_GridCell and .hb-gc-* / .hb-pub-* classes.

// One grid cell → { label, tone, date } (the date line under the pill).
function HB_gridCellInfo(g) {
  if (!g) return { label: "No text yet", tone: "neutral", date: "" };
  const pill = HB_statePill(g) || ["Not signed", "warm"];
  let date = "";
  if (g.state === "signed") date = g.countersigned_at ? "v" + g.version_no + " · " + HB_fmtDate(g.countersigned_at) : "";
  else if (g.state === "awaiting_countersign") date = g.signed_at ? "Signed " + HB_fmtDate(g.signed_at) : "";
  else if (g.state === "overdue") date = g.due_date ? "Was due " + HB_fmtDay(g.due_date) : "";
  else date = g.due_date ? "Due " + HB_fmtDay(g.due_date) : "";
  return { label: pill[0], tone: pill[1], date };
}

function HB_GridCell({ g }) {
  const c = HB_gridCellInfo(g);
  return (
    <span className="hb-gc">
      <HB_Pill tone={c.tone}>{c.label}</HB_Pill>
      {c.date && <span className="hb-gc-date">{c.date}</span>}
    </span>
  );
}

function HB_StatusGrid({ status }) {
  const people = (status && status.bookkeepers) || [];
  const policies = (status && status.policies) || [];
  const grid = (status && status.grid) || [];
  if (!policies.length) return null;
  const at = {};
  grid.forEach((g) => {
    at[g.policy_slug + "|" + g.staff_email] = g;
  });
  const late = grid.filter((g) => g.state === "overdue").length;
  return (
    <section className="card hb-grid-card" aria-labelledby="hb-grid-title">
      <h3 className="card-title" id="hb-grid-title">
        Signatures by bookkeeper
      </h3>
      <p className="hb-muted">
        Admins only. Re-signing is due 7 days after a version that needs it is published.
        {late > 0 ? " " + late + (late === 1 ? " signature is" : " signatures are") + " overdue." : ""}
      </p>
      {!people.length ? (
        <p className="hb-muted">No active bookkeepers.</p>
      ) : (
        <div className="hb-gc-wrap" role="region" aria-label="Signature status grid" tabIndex={0}>
          <table className="hb-gc-table">
            <thead>
              <tr>
                <th scope="col">Policy</th>
                {people.map((b) => (
                  <th scope="col" key={b.email}>
                    {b.name || "Bookkeeper"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    <button type="button" className="link-btn hb-gc-policy" onClick={() => HB_goPolicy(p.slug)}>
                      {p.title}
                    </button>
                    <span className="hb-gc-date">Version {p.latest_version_no}</span>
                  </th>
                  {people.map((b) => (
                    <td key={b.email}>
                      <HB_GridCell g={at[p.slug + "|" + b.email]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Countersigned copies whose PDF isn't in Drive yet. Retry asks the server to
// build and file it again (hb_retry_export → team-reviews export_handbook);
// the list refreshes a few seconds later.
function HB_UnfiledCard({ status }) {
  const toast = HB_useToastSafe();
  const [busy, setBusy] = React.useState({});
  const [error, setError] = React.useState("");
  const rows = (status && status.unfiled) || [];
  if (!rows.length) return null;
  // The first export can take up to a minute; the server refuses a retry for
  // 2 minutes after the countersignature so two exports can't race.
  const young = (u) => {
    const t = Date.parse(u.countersigned_at || "");
    return !isNaN(t) && Date.now() - t < 120000;
  };
  const retry = async (id) => {
    setBusy((b) => ({ ...b, [id]: true }));
    setError("");
    try {
      await HB_api.retryExport(id);
      toast("Filing started. The list updates in a few seconds.");
      setTimeout(HB_changed, 8000);
      setTimeout(() => setBusy((b) => ({ ...b, [id]: false })), 8000);
    } catch (e) {
      setError(HB_errText(e));
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };
  return (
    <section className="card hb-unfiled" aria-labelledby="hb-unfiled-title">
      <h3 className="card-title" id="hb-unfiled-title">
        Not filed to Drive yet
      </h3>
      <p className="hb-muted">
        These are countersigned, but the signed copy hasn't reached the Staff Reviews Shared Drive. It usually files within a minute. If one stays here, retry. If it
        still fails, check Google Drive in Dev Tools.
      </p>
      <ul className="hb-list">
        {rows.map((u) => (
          <li key={u.signature_id} className="hb-list-row">
            <div className="hb-list-main">
              <strong>
                {u.signer_name || "Bookkeeper"}, {u.policy_title} v{u.version_no}
              </strong>
              <span className="hb-muted">Countersigned {HB_fmtDate(u.countersigned_at)}</span>
            </div>
            <button type="button" className="btn-secondary" disabled={!!busy[u.signature_id] || young(u)} onClick={() => retry(u.signature_id)}>
              {busy[u.signature_id] || young(u) ? "Filing…" : "Retry filing"}
            </button>
          </li>
        ))}
      </ul>
      <HB_Error text={error} />
    </section>
  );
}

// The admin editor. Starts from the current text; preview uses the same
// renderer as the policy view (HLP_Markdown, placeholders shown as "Date of
// signing" / "Your name"). Publishing needs a kind (no default) and a second
// click to confirm, and the button locks while it runs, so one click makes
// one version and at most one email per bookkeeper.
// Unsaved edits are kept per policy + starting version in sessionStorage, so
// leaving the page inside the app (another tab, Today) doesn't lose them.
function HB_draftKey(policy, baseNo) {
  return "mgb.hb.draft." + ((policy && policy.id) || "x") + "." + baseNo;
}
function HB_draftLoad(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d.body === "string" ? d : null;
  } catch (e) {
    return null;
  }
}
function HB_draftSave(key, d) {
  try {
    if (d) window.sessionStorage.setItem(key, JSON.stringify(d));
    else window.sessionStorage.removeItem(key);
  } catch (e) {
    /* storage blocked: the beforeunload warning still covers reloads */
  }
}

function HB_PublishEditor({ policy, version, bookkeeperCount, onDone, onCancel }) {
  const toast = HB_useToastSafe();
  // The version the edit started from. If someone else publishes while this
  // is open, `version` moves on and publishing is blocked (see `stale`).
  const [base] = React.useState(() => ({ no: (version && version.version_no) || 0, body: (version && version.body_md) || "" }));
  const original = base.body;
  const first = base.no === 0; // version 1 always needs signing (the server forces it)
  const key = HB_draftKey(policy, base.no);
  const [draft] = React.useState(() => HB_draftLoad(key));
  const [body, setBody] = React.useState(draft ? draft.body : original);
  const [note, setNote] = React.useState(draft && typeof draft.note === "string" ? draft.note : "");
  const [kind, setKind] = React.useState(first ? "resign" : draft && (draft.kind === "resign" || draft.kind === "minor") ? draft.kind : ""); // "resign" | "minor"
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const dirty = body !== original;
  const stale = ((version && version.version_no) || 0) !== base.no;

  React.useEffect(() => {
    HB_draftSave(key, dirty || note.trim() ? { body, note, kind } : null);
  }, [key, body, note, kind, dirty]);

  React.useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const nextNo = base.no + 1;
  const problem = stale
    ? "Version " + ((version && version.version_no) || "") + " was published while you were editing."
    : !body.trim()
      ? "The policy text is empty."
      : !dirty
        ? "Change the text before publishing."
        : !kind
          ? "Choose Needs re-signing or Minor edit."
          : !note.trim()
            ? "Add a short change note so people know what changed."
            : "";

  const publish = async () => {
    if (busy || stale) return;
    setBusy(true);
    setError("");
    try {
      const r = await HB_api.publish(policy.id, body, kind === "resign", note.trim());
      const n = Number(r && r.notified) || 0;
      toast(
        "Version " +
          ((r && r.version_no) || nextNo) +
          " published." +
          (r && r.requires_resign ? " " + n + (n === 1 ? " bookkeeper was" : " bookkeepers were") + " asked to re-sign." : " Nobody needs to re-sign."),
      );
      HB_draftSave(key, null);
      HB_changed();
      if (typeof onDone === "function") onDone(r);
    } catch (e) {
      setError(HB_errText(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (dirty && !window.confirm("Discard your changes to the policy text?")) return;
    HB_draftSave(key, null);
    if (typeof onCancel === "function") onCancel();
  };

  return (
    <section className="card hb-pub" aria-labelledby="hb-pub-title">
      <div className="hb-row-head">
        <h3 className="card-title" id="hb-pub-title">
          Publish version {nextNo}
        </h3>
        <button type="button" className="link-btn" onClick={cancel}>
          Cancel
        </button>
      </div>
      <p className="hb-muted">
        Edit the text in Markdown. Keep {"{{effective_date}}"} and {"{{employee_name}}"} where the signing date and the signer's name go. Published versions can't be changed
        later.
      </p>
      {draft && !stale && (
        <p className="hb-muted" role="status">
          Your unsaved changes from earlier were restored.
        </p>
      )}
      {stale && (
        <div className="hb-banner warm" role="alert">
          Someone published version {(version && version.version_no) || ""} while you were editing, so this text is based on an older version. Copy anything you want to
          keep, click Cancel, then start again from the current version.
        </div>
      )}
      <div className="hb-pub-cols">
        <div className="hb-pub-col">
          <label className="hb-label" htmlFor="hb-pub-body">
            Policy text
          </label>
          <textarea
            id="hb-pub-body"
            className="hb-inp hb-pub-text"
            value={body}
            spellCheck="true"
            onChange={(e) => {
              setBody(e.target.value);
              setConfirming(false);
            }}
          />
        </div>
        <div className="hb-pub-col">
          <span className="hb-label" id="hb-pub-prev-label">
            Preview
          </span>
          <div className="hb-doc hb-pub-preview" aria-labelledby="hb-pub-prev-label">
            {body.trim() ? <HLP_Markdown source={HB_fillPlaceholders(body, null)} /> : <p className="hb-muted">Nothing to preview.</p>}
          </div>
        </div>
      </div>

      <label className="hb-label" htmlFor="hb-pub-note">
        Change note
      </label>
      <input
        id="hb-pub-note"
        className="hb-inp"
        value={note}
        maxLength={500}
        placeholder="What changed, in one line"
        onChange={(e) => {
          setNote(e.target.value);
          setConfirming(false);
        }}
      />

      <fieldset className="hb-pub-kind">
        <legend className="hb-label">Kind of change</legend>
        <label className="hb-check">
          <input
            type="radio"
            name="hb-pub-kind"
            checked={kind === "resign"}
            onChange={() => {
              setKind("resign");
              setConfirming(false);
            }}
          />
          <span>
            <strong>Needs re-signing.</strong> Every bookkeeper gets one email, a Today item and a badge, and has 7 days to sign the new version.
          </span>
        </label>
        <label className="hb-check">
          <input
            type="radio"
            name="hb-pub-kind"
            checked={kind === "minor"}
            disabled={first}
            onChange={() => {
              setKind("minor");
              setConfirming(false);
            }}
          />
          <span>
            <strong>Minor edit</strong> (typo, formatting). Nobody re-signs, and nobody is emailed. Existing signatures stay with the version each person signed.
            {first ? " Not available for the first version, which everyone signs." : ""}
          </span>
        </label>
      </fieldset>

      {!confirming ? (
        <div className="hb-actions">
          <button type="button" className="btn-primary" disabled={!!problem} onClick={() => setConfirming(true)}>
            Publish version {nextNo}
          </button>
          {problem && <span className="hb-muted">{problem}</span>}
        </div>
      ) : (
        <div className="hb-banner warm hb-pub-confirm" role="alert">
          <p>
            {kind === "resign"
              ? "Publish version " +
                nextNo +
                " and ask " +
                (bookkeeperCount === 1 ? "1 bookkeeper" : (bookkeeperCount || 0) + " bookkeepers") +
                " to re-sign? Each gets one email now."
              : "Publish version " + nextNo + " as a minor edit? Nobody is emailed."}
          </p>
          <div className="hb-actions">
            <button type="button" className="btn-primary" disabled={busy || stale} onClick={publish}>
              {busy ? "Publishing…" : "Yes, publish"}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Back
            </button>
          </div>
        </div>
      )}
      <HB_Error text={error} />
    </section>
  );
}
