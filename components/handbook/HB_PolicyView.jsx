// Staff Handbook: one policy (spec docs/staff-handbook-spec.md, Part E).
//
//   HB_PolicyView({ slug, versionNo?, status, onBack })
//
// Shows the policy text (HLP_Markdown, text only), then:
//   - the sign panel for a bookkeeper (me.is_signer) who hasn't signed the
//     latest version. It unlocks once the end of the text has been on screen.
//     Before signing, placeholders read "Date of signing" and "Your name".
//   - "My signatures" with Download once the signed copy is filed.
//   - Countersign cards for the countersigner (from hb_status to_countersign).
//   - For admins: each bookkeeper's state on this policy, with Download.
//   - Version history (HB_VersionHistory, HB_HandbookTab.jsx).
// Admins who aren't bookkeepers never see a sign prompt.
// The server decides everything; its error message is shown as is.

function HB_useToastSafe() {
  return typeof useToast === "function" ? useToast() : (m) => window.alert(m);
}

function HB_Pill({ tone, children }) {
  return <span className={"pill " + (tone || "neutral")}>{children}</span>;
}

function HB_Error({ text }) {
  if (!text) return null;
  return (
    <p className="al-error hb-error" role="alert">
      {text}
    </p>
  );
}

// hb_state → [label, tone]
function HB_statePill(my) {
  if (!my) return null;
  if (my.state === "signed") return ["Signed", "good"];
  if (my.state === "awaiting_countersign") return ["Awaiting countersign", "neutral"];
  if (my.state === "overdue") return ["Overdue", "bad"];
  if (my.last_signed_version_no) return ["Needs re-sign", "warm"];
  return ["Not signed", "warm"];
}

// Download button for one signed copy. The server checks signer, countersigner or admin
// and answers 409 while the copy is still being filed.
function HB_DownloadBtn({ signatureId, filename, label }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      await HB_downloadPdf(signatureId, filename);
    } catch (e) {
      setErr(HB_errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="hb-dl">
      <button type="button" className="btn-secondary" disabled={busy} onClick={go}>
        {busy ? "Downloading…" : label || "Download signed copy"}
      </button>
      {err && (
        <span className="hb-field-error" role="alert">
          {err}
        </span>
      )}
    </span>
  );
}

// The bookkeeper's sign panel. `unlocked` comes from the end-of-text sentinel.
function HB_SignPanel({ version, unlocked, onSigned }) {
  const toast = HB_useToastSafe();
  const [agree, setAgree] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [tried, setTried] = React.useState(false);
  const [error, setError] = React.useState("");

  const sign = async () => {
    setTried(true);
    setError("");
    if (!agree || !name.trim()) return;
    setBusy(true);
    try {
      await HB_api.sign(version.id, name.trim(), agree);
      toast("Signed. It's waiting for the countersignature.");
      HB_changed();
      if (typeof onSigned === "function") onSigned();
    } catch (e) {
      setError(HB_errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={"card hb-sign" + (unlocked ? "" : " hb-locked")} aria-labelledby="hb-sign-title">
      <h3 className="card-title" id="hb-sign-title">
        Sign version {version.version_no}
      </h3>
      {!unlocked ? (
        <p className="hb-muted" role="status">
          Read to the end of the policy to sign.
        </p>
      ) : (
        <div>
          <label className="hb-check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{HB_SIGNER_ACK}</span>
          </label>
          <label className="hb-label" htmlFor="hb-sign-name">
            Type your full name to sign
          </label>
          <input
            id="hb-sign-name"
            className="hb-inp"
            value={name}
            placeholder="Full name"
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sign();
            }}
          />
          <p className="hb-muted hb-hint">Use your name as it appears on your staff profile.</p>
          <div className="hb-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={sign}>
              {busy ? "Signing…" : "Sign"}
            </button>
          </div>
          {tried && (!name.trim() || !agree) && (
            <span className="hb-field-error" role="alert">
              Check the box and type your name to sign.
            </span>
          )}
          <HB_Error text={error} />
        </div>
      )}
    </section>
  );
}

// One countersign card (the countersigner's queue item for this policy).
function HB_CountersignCard({ item, policyTitle }) {
  const toast = HB_useToastSafe();
  const [agree, setAgree] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [tried, setTried] = React.useState(false);
  const [error, setError] = React.useState("");

  const go = async () => {
    setTried(true);
    setError("");
    if (!agree || !name.trim()) return;
    setBusy(true);
    try {
      await HB_api.countersign(item.signature_id, name.trim(), agree);
      toast("Countersigned. The signed copy is being filed.");
      HB_changed();
    } catch (e) {
      setError(HB_errText(e));
    } finally {
      setBusy(false);
    }
  };

  const fid = "hb-cs-" + item.signature_id;
  return (
    <div className="hb-cs" data-lk={"handbook-cs:" + item.signature_id}>
      <div className="hb-row-head">
        <strong>{item.signer_name || "Bookkeeper"}</strong>
        <HB_Pill tone="neutral">Awaiting countersign</HB_Pill>
      </div>
      <p className="hb-muted">
        Signed {policyTitle || item.policy_title} v{item.version_no} on {HB_fmtDate(item.signed_at)}.
      </p>
      <label className="hb-check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>{HB_COUNTERSIGN_ACK}</span>
      </label>
      <label className="hb-label" htmlFor={fid}>
        Type your full name to countersign
      </label>
      <input id={fid} className="hb-inp" value={name} placeholder="Full name" autoComplete="name" onChange={(e) => setName(e.target.value)} />
      <div className="hb-actions">
        <button type="button" className="btn-primary" disabled={busy} onClick={go}>
          {busy ? "Countersigning…" : "Countersign"}
        </button>
      </div>
      {tried && (!name.trim() || !agree) && (
        <span className="hb-field-error" role="alert">
          Check the box and type your name to countersign.
        </span>
      )}
      <HB_Error text={error} />
    </div>
  );
}

// Watch an element: true once it has been on screen (stays true).
function HB_useSeen(ref, resetKey) {
  const [seen, setSeen] = React.useState(false);
  React.useEffect(() => {
    setSeen(false);
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver !== "function") {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [resetKey]);
  return seen;
}

function HB_PolicyView({ slug, versionNo, status, onBack }) {
  const [st, setSt] = React.useState({ loading: true, data: null, error: "" });
  const [tick, setTick] = React.useState(0);
  const endRef = React.useRef(null);

  React.useEffect(() => {
    let live = true;
    setSt((s) => ({ ...s, loading: true, error: "" }));
    HB_api.policy(slug, versionNo || null)
      .then((d) => live && setSt({ loading: false, data: d, error: "" }))
      .catch((e) => live && setSt({ loading: false, data: null, error: HB_errText(e) }));
    return () => {
      live = false;
    };
  }, [slug, versionNo, tick]);

  // Reload after a sign or countersign anywhere.
  React.useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener(HB_CHANGED_EVENT, on);
    return () => window.removeEventListener(HB_CHANGED_EVENT, on);
  }, []);

  const d = st.data;
  const v = d && d.version;
  const seen = HB_useSeen(endRef, (v && v.id) || "none");
  const docRef = React.useRef(null);

  // Color the calendar bullets to match the words Available (green), Offline (red), Async (blue).
  React.useEffect(() => {
    const root = docRef.current;
    if (!root) return;
    root.querySelectorAll("li").forEach((li) => {
      const m = /^\s*(Available|Offline|Async) \((green|red|blue)\)/.exec(li.textContent || "");
      if (m) li.setAttribute("data-tone", m[2]);
    });
  });

  const back = (
    <button type="button" className="link-btn hb-back" onClick={onBack}>
      ← All policies
    </button>
  );

  if (st.error && !d)
    return (
      <div className="hb-view">
        {back}
        <HB_Error text={st.error} />
      </div>
    );
  if (!d) return <p className="hb-muted">Loading…</p>;

  const me = d.me || {};
  const p = d.policy || {};
  const mySigs = me.signatures || [];
  const sigHere = v ? mySigs.find((s) => s.version_no === v.version_no) : null;
  const fill = sigHere ? { date: HB_fmtDate(sigHere.signed_at), name: me.name || "" } : null;
  const body = v ? HB_fillPlaceholders(v.body_md, fill) : "";
  const pill = HB_statePill(me.status);
  const canSign = !!(me.is_signer && v && v.is_latest && !sigHere);
  const queue = ((status && status.to_countersign) || []).filter((q) => q.policy_slug === p.slug);
  const gridRows = me.is_admin && status && status.grid ? status.grid.filter((g) => g.policy_slug === p.slug) : [];

  return (
    <div className="hb-view">
      {back}
      <div className="card hb-head">
        <div className="hb-row-head">
          <h2 className="hb-title">{p.title}</h2>
          {pill && <HB_Pill tone={pill[1]}>{pill[0]}</HB_Pill>}
        </div>
        {v && (
          <p className="hb-muted">
            Version {v.version_no} · Published {HB_fmtDate(v.published_at)}
            {v.change_note ? " · " + v.change_note : ""}
          </p>
        )}
        {me.is_signer && me.status && (me.status.state === "not_signed" || me.status.state === "overdue") && me.status.due_date && (
          <p className={"hb-due" + (me.status.overdue ? " is-overdue" : "")}>
            {me.status.overdue ? "Overdue. It was due " + HB_fmtDay(me.status.due_date) + "." : "Please sign by " + HB_fmtDay(me.status.due_date) + "."}
          </p>
        )}
        {v && !v.is_latest && (
          <div className="hb-banner warm" role="status">
            You're viewing version {v.version_no}. The current version is {d.latest_version_no}.{" "}
            <button type="button" className="link-btn" onClick={() => HB_goPolicy(p.slug)}>
              Open the current version
            </button>
          </div>
        )}
      </div>

      {v ? (
        <article ref={docRef} className="card hb-doc" aria-label={p.title}>
          <HLP_Markdown source={body} />
          <div ref={endRef} className="hb-end" aria-hidden="true" />
        </article>
      ) : (
        <p className="hb-muted">This policy has no published text yet.</p>
      )}

      {canSign && <HB_SignPanel version={v} unlocked={seen} onSigned={() => setTick((n) => n + 1)} />}

      {me.is_signer && mySigs.length > 0 && (
        <section className="card hb-mine">
          <h3 className="card-title">My signatures</h3>
          <ul className="hb-list">
            {mySigs.map((s) => (
              <li key={s.id} className="hb-list-row">
                <div className="hb-list-main">
                  <strong>Version {s.version_no}</strong>
                  <span className="hb-muted">
                    Signed {HB_fmtDate(s.signed_at)}
                    {s.countersigned_at ? " · Countersigned " + HB_fmtDate(s.countersigned_at) : " · Awaiting countersign"}
                  </span>
                </div>
                {s.has_pdf ? (
                  <HB_DownloadBtn signatureId={s.id} filename={HB_pdfName(p.title, s.version_no, s.signed_at)} />
                ) : s.countersigned_at ? (
                  <span className="hb-muted">Signed copy is being filed.</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {me.is_countersigner && queue.length > 0 && (
        <section className="card hb-queue" aria-labelledby="hb-cs-title">
          <h3 className="card-title" id="hb-cs-title">
            To countersign
          </h3>
          {queue.map((q) => (
            <HB_CountersignCard key={q.signature_id} item={q} policyTitle={p.title} />
          ))}
        </section>
      )}

      {gridRows.length > 0 && (
        <section className="card hb-admin-sigs">
          <h3 className="card-title">Bookkeepers' signatures</h3>
          <p className="hb-muted">Admins only. Signed copies are filed in the Staff Reviews Shared Drive under Handbook.</p>
          <ul className="hb-list">
            {gridRows.map((g) => {
              const gp = HB_statePill(g);
              return (
                <li key={g.staff_email} className="hb-list-row">
                  <div className="hb-list-main">
                    <strong>{g.staff_name || "Bookkeeper"}</strong>
                    <span className="hb-muted">
                      {g.signed_at ? "v" + g.version_no + " signed " + HB_fmtDate(g.signed_at) : g.due_date ? "Due " + HB_fmtDay(g.due_date) : ""}
                    </span>
                  </div>
                  <span className="hb-list-side">
                    {gp && <HB_Pill tone={gp[1]}>{gp[0]}</HB_Pill>}
                    {g.has_pdf && g.signature_id && (
                      <HB_DownloadBtn signatureId={g.signature_id} filename={HB_pdfName(p.title, g.version_no, g.signed_at)} label="Download" />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {typeof HB_VersionHistory === "function" && (
        <HB_VersionHistory slug={p.slug} versions={d.versions || []} current={v ? v.version_no : null} latest={d.latest_version_no} mySigs={mySigs} />
      )}
    </div>
  );
}
