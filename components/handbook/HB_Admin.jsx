// Staff Handbook: admin tools (spec docs/staff-handbook-spec.md, Parts A, C, E).
//
//   HB_StatusGrid({ status })        HR › Handbook list: policies down the
//                                    side, active bookkeepers across the top.
//   HB_UnfiledCard({ status })       countersigned copies not filed to Drive,
//                                    each with Retry filing (hb_retry_export).
//   HB_PublishEditor({ policy, version, bookkeeperCount, onDone, onCancel })
//                                    the "Publish new version" editor in the
//                                    policy view (latest version only). On a
//                                    reference policy or a draft there is no
//                                    kind of change to pick (see below).
//   HB_NewPolicy({ policies, bookkeeperCount, onCancel, onCreated })
//                                    HR › Handbook › New policy: title, link
//                                    name, kind, section, first text. Always
//                                    creates a draft (hb_create_policy).
//   HB_DraftBar({ policy, bookkeeperCount, onDone })
//                                    the draft banner with Publish
//                                    (hb_publish_policy).
//   HB_DetailsEditor({ policy, sections, onCancel, onDone })
//                                    title, section, order (hb_update_policy).
//   HB_ConvertCard({ policy, bookkeeperCount, onCancel, onDone })
//                                    reference -> signed, with an explicit
//                                    confirm (hb_convert_to_signed).
//
// Only shown to admins; the database checks admin on every call anyway
// (hb_status returns grid / unfiled / drafts only for admins; every hb_*
// write RPC refuses anyone else).
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
  // Signing policies only: reference policies and drafts have no signatures.
  const policies = HB_gridPolicies((status && status.policies) || []);
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
        <div className="hb-gc-wrap mgb-sticky-wrap" role="region" aria-label="Signature status grid" tabIndex={0}>
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

function HB_PublishEditor({ policy, version, bookkeeperCount, approval, approverFirst, onDone, onCancel }) {
  const toast = HB_useToastSafe();
  // The version the edit started from. If someone else publishes while this
  // is open, `version` moves on and publishing is blocked (see `stale`).
  const [base] = React.useState(() => ({ no: (version && version.version_no) || 0, body: (version && version.body_md) || "" }));
  const original = base.body;
  const first = base.no === 0; // version 1 always needs signing (the server forces it)
  // No kind to pick on a reference policy (never signed) or a draft (nobody
  // has signed it yet). A signed draft's new text is the version everyone
  // signs at publish, so it is saved as one that needs signing (no email
  // while it's a draft).
  const reference = HB_kindOf(policy) === "reference";
  const unpublished = HB_isDraft(policy);
  const fixedKind = reference ? "minor" : unpublished ? "resign" : "";
  // Part L: saving new text on a draft sends it back to the approver. Say so
  // before saving, loudest when it was already approved.
  const who = approverFirst || "the approver";
  const apStatus = unpublished && approval ? approval.status : "";
  const resetNote =
    apStatus === "approved"
      ? who + " already approved this draft. Saving new text sends it back to " + who + " for approval, and it can't be published until it's approved again."
      : apStatus === "changes_requested"
        ? "Saving new text sends this draft back to " + who + " for approval."
        : apStatus === "pending"
          ? "It's waiting for " + who + "'s approval. " + who + " approves the newest text you save."
          : "";
  const key = HB_draftKey(policy, base.no);
  const [draft] = React.useState(() => HB_draftLoad(key));
  const [body, setBody] = React.useState(draft ? draft.body : original);
  const [note, setNote] = React.useState(draft && typeof draft.note === "string" ? draft.note : "");
  const [kindPick, setKind] = React.useState(first ? "resign" : draft && (draft.kind === "resign" || draft.kind === "minor") ? draft.kind : ""); // "resign" | "minor"
  const kind = fixedKind || kindPick;
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const dirty = body !== original;
  const stale = ((version && version.version_no) || 0) !== base.no;

  React.useEffect(() => {
    HB_draftSave(key, dirty || note.trim() ? { body, note, kind: kindPick } : null);
  }, [key, body, note, kindPick, dirty]);

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
        unpublished
          ? "Version " + ((r && r.version_no) || nextNo) + " saved. It's still a draft" + (apStatus ? ", waiting for " + who + "'s approval." : ".")
          : "Version " +
              ((r && r.version_no) || nextNo) +
              " published." +
              (r && r.requires_resign
                ? " " + n + (n === 1 ? " bookkeeper was" : " bookkeepers were") + " asked to re-sign."
                : reference
                  ? ""
                  : " Nobody needs to re-sign."),
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
          {unpublished ? "Edit text (version " + nextNo + ")" : "Publish version " + nextNo}
        </h3>
        <button type="button" className="link-btn" onClick={cancel}>
          Cancel
        </button>
      </div>
      <p className="hb-muted">
        {reference
          ? "Edit the text in Markdown. This is a reference policy: nobody signs it" +
            (unpublished ? "." : " and nobody is emailed.") +
            " Versions can't be changed later."
          : 'Edit the text in Markdown. Keep {{effective_date}} and {{employee_name}} where the signing date and the signer\'s name go. Versions can\'t be changed later.'}
        {unpublished ? " It's a draft, so only admins see this text until you publish the policy." : ""}
      </p>
      {resetNote && (
        <div className={"hb-banner" + (apStatus === "pending" ? "" : " warm")} role="note">
          {resetNote}
        </div>
      )}
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

      {!fixedKind && (
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
      )}

      {!confirming ? (
        <div className="hb-actions">
          <button type="button" className="btn-primary" disabled={!!problem} onClick={() => setConfirming(true)}>
            {unpublished ? "Save version " + nextNo : "Publish version " + nextNo}
          </button>
          {problem && <span className="hb-muted">{problem}</span>}
        </div>
      ) : (
        <div className="hb-banner warm hb-pub-confirm" role="alert">
          <p>
            {unpublished
              ? "Save version " + nextNo + " of the draft? No bookkeeper is emailed." +
                (apStatus === "approved" || apStatus === "changes_requested"
                  ? " " + who + "'s approval is cleared and the draft goes back to " + who + " for approval."
                  : "")
              : reference
                ? "Publish version " + nextNo + "? Everyone sees the new text. Nobody is emailed."
                : kind === "resign"
              ? "Publish version " +
                nextNo +
                " and ask " +
                (bookkeeperCount === 1 ? "1 bookkeeper" : (bookkeeperCount || 0) + " bookkeepers") +
                " to re-sign? Each gets one email now."
              : "Publish version " + nextNo + " as a minor edit? Nobody is emailed."}
          </p>
          <div className="hb-actions">
            <button type="button" className="btn-primary" disabled={busy || stale} onClick={publish}>
              {busy ? (unpublished ? "Saving…" : "Publishing…") : unpublished ? "Yes, save" : "Yes, publish"}
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

// ---------------------------------------------------------------------------
// New policy (HR › Handbook › New policy). Always saves a reference draft:
// nothing is emailed and nothing reaches Today or the badge. Asking anyone to
// sign takes the explicit "Make this a signed policy" step (HB_ConvertCard);
// hb_create_policy refuses kind 'signed'.
// The link name follows the title until it's edited by hand. Unsaved input is
// kept in sessionStorage like the publish editor's.
// ---------------------------------------------------------------------------
const HB_NEW_KEY = "mgb.hb.new";

function HB_NewPolicy({ policies, onCancel, onCreated }) {
  const toast = HB_useToastSafe();
  const [saved] = React.useState(() => HB_draftLoad(HB_NEW_KEY));
  const s0 = saved || {};
  const [title, setTitle] = React.useState(s0.title || "");
  const [slug, setSlug] = React.useState(s0.slug || "");
  const [slugEdited, setSlugEdited] = React.useState(!!s0.slugEdited);
  const [section, setSection] = React.useState(s0.section || "");
  const [body, setBody] = React.useState(typeof s0.body === "string" ? s0.body : "");
  const [tried, setTried] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const autoSlug = HB_slugify(title);
  const linkName = slugEdited ? slug : autoSlug;
  const taken = (policies || []).map((p) => p.slug);
  const sections = HB_sections(policies);
  const dirty = !!(title.trim() || body.trim() || section.trim());

  React.useEffect(() => {
    HB_draftSave(HB_NEW_KEY, dirty ? { title, slug, slugEdited, section, body } : null);
  }, [title, slug, slugEdited, section, body, dirty]);

  React.useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const titleProblem = !title.trim() ? "Add a title." : title.trim().length > 200 ? "Keep the title under 200 characters." : "";
  const slugProblem = HB_slugProblem(linkName, taken);
  const sectionProblem = section.trim().length > 80 ? "Keep the section under 80 characters." : "";
  const bodyProblem = !body.trim() ? "Add the policy text." : "";
  const problem = titleProblem || slugProblem || sectionProblem || bodyProblem;

  const create = async () => {
    setTried(true);
    setError("");
    if (problem || busy) return;
    setBusy(true);
    try {
      const r = await HB_api.createPolicy({ title: title.trim(), slug: linkName, section: section.trim(), body });
      HB_draftSave(HB_NEW_KEY, null);
      toast("Draft saved. Only admins can see it. It's waiting for approval before it can be published.");
      HB_changed();
      if (typeof onCreated === "function") onCreated((r && r.slug) || linkName);
    } catch (e) {
      setError(HB_errText(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (dirty && !window.confirm("Discard this new policy?")) return;
    HB_draftSave(HB_NEW_KEY, null);
    if (typeof onCancel === "function") onCancel();
  };

  return (
    <div className="hb-view">
      <button type="button" className="link-btn hb-back" onClick={cancel}>
        ← All policies
      </button>
      <section className="card hb-pub hb-new" aria-labelledby="hb-new-title">
        <div className="hb-row-head">
          <h3 className="card-title" id="hb-new-title">
            New policy
          </h3>
          <button type="button" className="link-btn" onClick={cancel}>
            Cancel
          </button>
        </div>
        <p className="hb-muted">
          It's saved as a draft. Only admins see a draft. The policy approver approves it before it can be published, and no
          bookkeeper is emailed until you publish it.
          {saved ? " Your unsaved input from earlier was restored." : ""}
        </p>

        <label className="hb-label" htmlFor="hb-new-name">
          Title
        </label>
        <input id="hb-new-name" className="hb-inp" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        {tried && titleProblem && (
          <span className="hb-field-error" role="alert">
            {titleProblem}
          </span>
        )}

        <label className="hb-label" htmlFor="hb-new-slug">
          Link name
        </label>
        <input
          id="hb-new-slug"
          className="hb-inp"
          value={linkName}
          maxLength={81}
          spellCheck="false"
          autoComplete="off"
          aria-describedby="hb-new-slug-hint"
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value.toLowerCase());
          }}
        />
        <p className="hb-muted hb-hint" id="hb-new-slug-hint">
          The policy's address: {HB_policyHash(linkName || "…")}. It can't change after the policy is created.
          {slugEdited && autoSlug && linkName !== autoSlug && (
            <>
              {" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setSlugEdited(false);
                  setSlug("");
                }}
              >
                Use the title
              </button>
            </>
          )}
        </p>
        {(tried || slugEdited) && linkName && slugProblem && (
          <span className="hb-field-error" role="alert">
            {slugProblem}
          </span>
        )}
        {tried && !linkName && (
          <span className="hb-field-error" role="alert">
            {slugProblem}
          </span>
        )}

        <p className="hb-muted hb-kind-note">
          New policies are for reference: everyone can read them and nobody signs. To ask bookkeepers to sign, open the policy
          and use <strong>Make this a signed policy</strong>.
        </p>

        <label className="hb-label" htmlFor="hb-new-section">
          Section <span className="hb-muted">(optional)</span>
        </label>
        <input
          id="hb-new-section"
          className="hb-inp"
          value={section}
          maxLength={80}
          list="hb-new-sections"
          placeholder="For example: Time off"
          onChange={(e) => setSection(e.target.value)}
        />
        <datalist id="hb-new-sections">
          {sections.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        <p className="hb-muted hb-hint">Reference policies are listed under their section. Policies to sign have their own group.</p>
        {sectionProblem && (
          <span className="hb-field-error" role="alert">
            {sectionProblem}
          </span>
        )}

        <div className="hb-pub-cols">
          <div className="hb-pub-col">
            <label className="hb-label" htmlFor="hb-new-body">
              Policy text (version 1)
            </label>
            <textarea id="hb-new-body" className="hb-inp hb-pub-text" value={body} spellCheck="true" onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="hb-pub-col">
            <span className="hb-label" id="hb-new-prev-label">
              Preview
            </span>
            <div className="hb-doc hb-pub-preview" aria-labelledby="hb-new-prev-label">
              {body.trim() ? <HLP_Markdown source={HB_fillPlaceholders(body, null)} /> : <p className="hb-muted">Nothing to preview.</p>}
            </div>
          </div>
        </div>
        <p className="hb-muted hb-hint">
          Markdown: # for headings, - for lists, **bold**.
        </p>
        {tried && bodyProblem && (
          <span className="hb-field-error" role="alert">
            {bodyProblem}
          </span>
        )}

        <div className="hb-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={create}>
            {busy ? "Saving…" : "Save draft"}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={cancel}>
            Cancel
          </button>
        </div>
        <HB_Error text={error} />
      </section>
    </div>
  );
}

// The draft banner in the policy view (admins). Publish asks once more; a
// signed policy then emails each active bookkeeper (one each), a reference
// policy emails nobody. Publish stays disabled, with the reason, until the
// policy approver has approved the exact text that's there now (Part L; the
// server refuses it too). `approval` is null on a server older than part 4.
function HB_DraftBar({ policy, bookkeeperCount, approval, approverMissing, onDone }) {
  const toast = HB_useToastSafe();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const signed = HB_kindOf(policy) === "signed";
  const n = bookkeeperCount || 0;
  const people = n === 1 ? "1 bookkeeper" : n + " bookkeepers";
  const blocked = !!approval && (approverMissing || !approval.current);
  const hint = !blocked
    ? ""
    : approverMissing
      ? "Publishing is blocked until an admin chooses a policy approver who is an active admin."
      : approval.problem || "This draft needs approval before it can be published.";

  const publish = async () => {
    if (busy || blocked) return;
    setBusy(true);
    setError("");
    try {
      const r = await HB_api.publishPolicy(policy.id);
      const sent = Number(r && r.notified) || 0;
      toast(signed ? "Published. " + sent + (sent === 1 ? " bookkeeper was" : " bookkeepers were") + " asked to sign." : "Published. Everyone can read it now.");
      HB_changed();
      if (typeof onDone === "function") onDone(r);
    } catch (e) {
      setError(HB_errText(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hb-banner hb-draft-bar" role="status">
      <div className="hb-cs-line">
        <span>
          <strong>Draft.</strong> Only admins can see this policy. Nobody has been emailed.
        </span>
        {!confirming && (
          <button
            type="button"
            className="btn-primary"
            disabled={blocked}
            aria-describedby={blocked ? "hb-draft-hint" : undefined}
            onClick={() => setConfirming(true)}
          >
            Publish
          </button>
        )}
      </div>
      {blocked && (
        <p className="hb-muted hb-draft-hint" id="hb-draft-hint">
          {hint}
        </p>
      )}
      {confirming && !blocked && (
        <div className="hb-pub-confirm">
          <p>
            {signed
              ? "Publish it and ask " + people + " to sign? Each gets one email now and has 7 days."
              : "Publish it for everyone to read? Nobody is emailed and nobody signs it."}
          </p>
          <div className="hb-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={publish}>
              {busy ? "Publishing…" : "Yes, publish"}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Back
            </button>
          </div>
        </div>
      )}
      <HB_Error text={error} />
    </div>
  );
}

// Draft approval (Part L), in the policy view for admins. Everyone sees the
// state; only the policy approver gets Approve and Request changes (the
// server checks it too: hb_approve_policy / hb_request_changes). Approving
// sends the version the approver is reading, so a draft edited meanwhile is
// refused instead of approved by mistake.
function HB_ApprovalCard({
  policy,
  approval,
  approverFirst,
  approverMissing,
  approverSetting,
  isApprover,
  latestVersionId,
  latestVersionNo,
  viewingLatest,
  onDone,
}) {
  const toast = HB_useToastSafe();
  const [asking, setAsking] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const a = approval || {};
  const who = approverFirst || "the approver";
  const current = !!a.current;
  const status = a.status === "approved" && !current ? "pending" : a.status;
  const byName = a.approved_by_name || a.approved_by || who;
  const canAct = !!isApprover && !approverMissing;
  const noteProblem = !note.trim() ? "Say what needs to change." : note.trim().length > 2000 ? "Keep it under 2,000 characters." : "";

  const done = () => {
    HB_changed();
    if (typeof onDone === "function") onDone();
  };

  const approve = async () => {
    if (busy || !latestVersionId) return;
    setBusy(true);
    setError("");
    try {
      await HB_api.approve(policy.id, latestVersionId);
      toast("Approved version " + (latestVersionNo || "") + ". Any admin can publish it now.");
      done();
    } catch (e) {
      setError(HB_errText(e));
      if (typeof onDone === "function") onDone(); // show the newer text if it changed
    } finally {
      setBusy(false);
    }
  };

  const sendBack = async () => {
    if (busy || noteProblem) return;
    setBusy(true);
    setError("");
    try {
      const res = await HB_api.requestChanges(policy.id, note.trim());
      toast(HB_changesSentText(res) + " It comes back to you once it's edited.");
      setAsking(false);
      setNote("");
      done();
    } catch (e) {
      setError(HB_errText(e));
    } finally {
      setBusy(false);
    }
  };

  let line;
  if (status === "approved") {
    line =
      "Approved by " +
      byName +
      (a.approved_at ? " on " + HB_fmtDate(a.approved_at) : "") +
      " (version " +
      (a.approved_version_no || latestVersionNo || "") +
      "). Any admin can publish it.";
  } else if (status === "changes_requested") {
    line = who + " asked for changes. Edit the text or details, and it goes back to " + who + " for approval.";
  } else if (a.status === "approved" && !current) {
    line =
      byName +
      " approved version " +
      (a.approved_version_no || "") +
      ", but the text changed since. It's waiting for " +
      who +
      " to approve version " +
      (latestVersionNo || "") +
      ".";
  } else {
    line = "Waiting for " + who + " to approve version " + (latestVersionNo || "") + " before it can be published.";
  }

  return (
    <section className="card hb-approval" aria-labelledby="hb-approval-title">
      <h3 className="card-title" id="hb-approval-title">
        Approval
      </h3>
      {approverMissing ? (
        <div className="hb-banner warm" role="alert">
          {a.problem ||
            "Nobody can approve handbook drafts right now: the policy approver (" +
              (approverSetting || "not set") +
              ") is not an active admin. A new approver can be chosen in HR › Handbook."}
        </div>
      ) : (
        <p className="hb-approval-line">{line}</p>
      )}
      {a.note && (status === "changes_requested" || status === "pending") && (
        <blockquote className="hb-approval-note">
          <span className="hb-label">{status === "changes_requested" ? "What " + who + " asked for" : "Earlier note from " + who}</span>
          <span className="hb-approval-note-text">{a.note}</span>
        </blockquote>
      )}

      {canAct && !viewingLatest && <p className="hb-muted">You're reading an older version. Open the current version to approve it.</p>}
      {canAct && viewingLatest && !asking && (
        <div className="hb-actions">
          {status !== "approved" && (
            <button type="button" className="btn-primary" disabled={busy || !latestVersionId} onClick={approve}>
              {busy ? "Approving…" : "Approve version " + (latestVersionNo || "")}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setAsking(true);
              setError("");
            }}
          >
            {status === "approved" ? "Withdraw approval and ask for changes" : "Request changes"}
          </button>
        </div>
      )}
      {canAct && viewingLatest && status !== "approved" && !asking && (
        <p className="hb-muted hb-hint">Approve once you've read the text below. If anyone edits it after, it comes back to you.</p>
      )}
      {canAct && asking && (
        <div className="hb-approval-ask">
          <label className="hb-label" htmlFor="hb-approval-note">
            What needs to change
          </label>
          <textarea
            id="hb-approval-note"
            className="hb-inp hb-approval-text"
            value={note}
            maxLength={2000}
            placeholder="Say what needs to change. The admins editing it see this note on the draft"
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="hb-muted hb-hint">
            We email your note to whoever edited the draft last, unless that was you, the original import, or someone who's no longer an admin. It also shows on the draft.
          </p>
          <div className="hb-actions">
            <button type="button" className="btn-primary" disabled={busy || !!noteProblem} onClick={sendBack}>
              {busy ? "Sending…" : "Send back for changes"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setAsking(false);
                setError("");
              }}
            >
              Cancel
            </button>
            {noteProblem && note.length > 0 && <span className="hb-muted">{noteProblem}</span>}
          </div>
        </div>
      )}
      {!isApprover && !approverMissing && <p className="hb-muted hb-hint">Only {who} can approve handbook drafts.</p>}
      <HB_Error text={error} />
    </section>
  );
}

// Title, section and list order (admins). The link name never changes.
// On a draft that was approved (or sent back), a new title or section sends it
// back to the approver; the list order alone doesn't (Part L).
function HB_DetailsEditor({ policy, sections, approval, approverFirst, onCancel, onDone }) {
  const toast = HB_useToastSafe();
  const [title, setTitle] = React.useState(policy.title || "");
  const [section, setSection] = React.useState(policy.section || "");
  const [sort, setSort] = React.useState(policy.sort == null ? "" : String(policy.sort));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const sortOk = sort.trim() === "" || /^-?\d{1,6}$/.test(sort.trim());
  const problem = !title.trim() ? "Add a title." : !sortOk ? "The order is a whole number." : "";
  const who = approverFirst || "the approver";
  const wasReviewed = !!approval && (approval.status === "approved" || approval.status === "changes_requested");
  const resets = wasReviewed && (title.trim() !== (policy.title || "") || section.trim() !== (policy.section || ""));

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError("");
    try {
      await HB_api.updatePolicy(policy.id, title.trim(), section.trim(), sort.trim());
      toast(resets ? "Details saved. It's back with " + who + " for approval." : "Details saved.");
      HB_changed();
      if (typeof onDone === "function") onDone();
    } catch (e) {
      setError(HB_errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card hb-details" aria-labelledby="hb-details-title">
      <h3 className="card-title" id="hb-details-title">
        Edit details
      </h3>
      <p className="hb-muted">The link name ({policy.slug}) stays the same so links in emails keep working.</p>
      <label className="hb-label" htmlFor="hb-det-title">
        Title
      </label>
      <input id="hb-det-title" className="hb-inp" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      <label className="hb-label" htmlFor="hb-det-section">
        Section <span className="hb-muted">(optional)</span>
      </label>
      <input id="hb-det-section" className="hb-inp" value={section} maxLength={80} list="hb-det-sections" onChange={(e) => setSection(e.target.value)} />
      <datalist id="hb-det-sections">
        {(sections || []).map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <label className="hb-label" htmlFor="hb-det-sort">
        Order <span className="hb-muted">(lower numbers list first)</span>
      </label>
      <input id="hb-det-sort" className="hb-inp hb-inp-short" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
      {resets && (
        <div className="hb-banner warm" role="alert">
          {approval.status === "approved"
            ? who + " approved this draft. Saving a new title or section sends it back to " + who + " for approval, and it can't be published until it's approved again."
            : "Saving a new title or section sends this draft back to " + who + " for approval."}{" "}
          Changing only the order doesn't.
        </div>
      )}
      <div className="hb-actions">
        <button type="button" className="btn-primary" disabled={busy || !!problem} onClick={save}>
          {busy ? "Saving…" : "Save details"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {problem && <span className="hb-muted">{problem}</span>}
      </div>
      <HB_Error text={error} />
    </section>
  );
}

// Reference -> signed. The only way to start asking for signatures on a
// reference policy: a change note, a checkbox, then one click. The current
// text becomes a new version that everyone signs. It can't be undone.
// On a draft (Part L) it needs the approver's approval of the current text
// first, and the converted draft goes back to the approver after.
function HB_ConvertCard({ policy, bookkeeperCount, approval, approverFirst, approverMissing, onCancel, onDone }) {
  const toast = HB_useToastSafe();
  const [note, setNote] = React.useState("");
  const [agree, setAgree] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const draft = HB_isDraft(policy);
  const n = bookkeeperCount || 0;
  const people = n === 1 ? "1 bookkeeper" : n + " bookkeepers";
  const who = approverFirst || "the approver";
  const needsApproval = draft && !!approval && (!approval.current || !!approverMissing);
  const problem = needsApproval
    ? (approverMissing
        ? approval.problem || "Nobody can approve handbook drafts right now, so this draft can't be converted. A new approver can be chosen in HR › Handbook."
        : approval.problem || "This draft needs approval first.")
    : !note.trim()
      ? "Add a short note that says why it now needs signing."
      : !agree
        ? "Check the box to confirm."
        : "";

  const go = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await HB_api.convertToSigned(policy.id, note.trim());
      const sent = Number(r && r.notified) || 0;
      toast(
        draft
          ? "It's now a signed policy. It's back with " + who + " for approval. Bookkeepers are asked to sign when you publish it."
          : "It's now a signed policy. " + sent + (sent === 1 ? " bookkeeper was" : " bookkeepers were") + " asked to sign.",
      );
      HB_changed();
      if (typeof onDone === "function") onDone(r);
    } catch (e) {
      setError(HB_errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card hb-convert" aria-labelledby="hb-convert-title">
      <h3 className="card-title" id="hb-convert-title">
        Make this a signed policy
      </h3>
      <p className="hb-muted">
        The current text is published again as a new version that every bookkeeper signs, with the firm's countersignature.
        {draft ? " It's a draft, so nobody is emailed until you publish it." : " Each active bookkeeper gets one email, a Today item and a badge, and has 7 days to sign."}{" "}
        A signed policy can't go back to reference.
        {draft && approval ? " " + who + " approves the draft before it changes, and again after, since bookkeepers will sign it." : ""}
      </p>
      <label className="hb-label" htmlFor="hb-convert-note">
        Change note
      </label>
      <input
        id="hb-convert-note"
        className="hb-inp"
        value={note}
        maxLength={500}
        placeholder="Why it now needs signing, in one line"
        onChange={(e) => setNote(e.target.value)}
      />
      <label className="hb-check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>{draft ? "I understand every bookkeeper will need to sign this policy once it's published." : "Ask " + people + " to sign this policy now."}</span>
      </label>
      <div className="hb-actions">
        <button type="button" className="btn-primary" disabled={busy || !!problem} onClick={go}>
          {busy ? "Working…" : "Make it a signed policy"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {problem && <span className="hb-muted">{problem}</span>}
      </div>
      <HB_Error text={error} />
    </section>
  );
}
