// Client org profile: the staff "Organization profile" card on a client's
// Overview, under Key dates (spec §5). Renders nothing unless OP_isOn()
// (firm switch tk_settings.org_profile_enabled, or the person's preview flag).
// Data: staff_client_org_profile (active staff who can open the client);
// Client since: staff_set_client_since (a date, or null to go back to the
// launch date). Get-to-know answers come back only for admins, the assigned
// bookkeeper and the account manager (server rule op__can_read_gtk).
// Tour target: data-tour="op-staff-card". Styles: components/client/op.css.

function OP_StaffCard({ client }) {
  const on = OP_useGate();
  if (!on || !client || !client.id) return null;
  return <OP_StaffCardBody client={client} />;
}

function OP_StaffCardBody({ client }) {
  const cid = client.id;
  const [st, setSt] = React.useState({ status: "loading", data: null, error: "" });
  const [editing, setEditing] = React.useState(false);
  const [since, setSince] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");

  React.useEffect(() => {
    let live = true;
    setSt({ status: "loading", data: null, error: "" });
    setEditing(false);
    setMsg("");
    OP_api.staffProfile(cid).then((res) => {
      if (!live) return;
      if (res.error) {
        const missing = typeof isMissingTableError === "function" && isMissingTableError(res.error);
        const fnMissing = res.error.code === "PGRST202" || res.error.code === "42883";
        setSt({
          status: "error",
          data: null,
          error: missing || fnMissing ? "This needs supabase/client-org-profile.sql, which hasn't been run here." : "Couldn't load the organization profile.",
        });
      } else setSt({ status: "ready", data: res.data || {}, error: "" });
    });
    return () => {
      live = false;
    };
  }, [cid]);

  // View as is read-only, and the get-to-know check runs on the admin's JWT,
  // so those answers stay hidden there (fail closed, view-as spec §10.8).
  const ro = typeof MGB_viewAsReadOnly === "function" && MGB_viewAsReadOnly();
  const d = st.data || {};
  // A row made only by staff_set_client_since (no client save yet: updated_by
  // is set by the client's save only) still counts as "Not started".
  const p = d.profile && d.profile.updated_by ? d.profile : null;

  const saveSince = async (iso) => {
    setBusy(true);
    setMsg("");
    const res = await OP_api.setClientSince(cid, iso);
    setBusy(false);
    if (res.error) {
      setMsg(/between/.test(res.error.message || "") ? "Pick a date between 1900 and today." : "Couldn't save Client since.");
      return;
    }
    setSt({ status: "ready", data: res.data || {}, error: "" });
    setEditing(false);
  };

  const pill = !p ? (
    <span className="pill neutral">Not started</span>
  ) : d.complete ? (
    <span className="pill good">Complete</span>
  ) : (
    <span className="pill warm">Incomplete</span>
  );

  const fye = (v) => (v ? OP_fmtMonthDay(v) || v : "");
  const row = (label, value) =>
    value ? (
      <React.Fragment key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </React.Fragment>
    ) : null;

  const sinceSource =
    d.client_since_source === "staff"
      ? "set by staff" + (d.client_since_set_by ? " (" + d.client_since_set_by + ")" : "")
      : d.client_since_source === "launch_date"
        ? "from launch date"
        : "";

  return (
    <OV_Card anchor="ov-orgprofile" tour="op-staff-card" title="Organization profile" actions={st.status === "ready" ? pill : null} noLk>
      {st.status === "loading" && <p className="card-subtitle">Loading…</p>}
      {st.status === "error" && <p className="card-subtitle">{st.error}</p>}
      {st.status === "ready" && (
        <>
          {!p && <p className="card-subtitle">The client hasn't filled in their organization profile yet. They're asked when they sign in.</p>}
          {p && (
            <dl className="op-card-grid">
              {row("Card name", p.card_name)}
              {row("Type", p.org_type)}
              {row("Founding date", p.established_unknown ? "Not sure" : OP_fmtDate(p.established_date))}
              {row("Gift address", p.gift_address ? p.gift_address + (p.gift_same_as_org ? "\n(same as organization address)" : "") : "")}
              {row("Receives deliveries", p.receiver_name)}
              {row("Courier phone", p.courier_phone)}
              {row("Main contact", [p.contact_name, p.contact_email, p.contact_phone].filter(Boolean).join(" · "))}
              {row("Fiscal year end", fye(p.fiscal_year_end))}
              {row("Updated", p.updated_at ? OP_fmtStamp(p.updated_at) + (p.updated_by ? " by " + p.updated_by : "") : "")}
            </dl>
          )}
          {d.fiscal_year_mismatch && (
            <p className="op-flag">
              The client says their fiscal year ends {fye(p && p.fiscal_year_end)}; Key dates says {fye(d.staff_fiscal_year_end)}. Key dates was not changed.
            </p>
          )}

          <h4 style={{ margin: "14px 0 6px", fontSize: 13.5 }}>Client since</h4>
          {!editing ? (
            <div className="op-since">
              <span>{d.client_since ? OP_fmtDate(d.client_since) : "Not set"}</span>
              {sinceSource && <span className="op-hint" style={{ margin: 0 }}>{sinceSource}</span>}
              <button
                type="button"
                className="link-btn"
                disabled={ro}
                title={ro ? "Read-only in View as" : undefined}
                onClick={() => {
                  setSince(d.client_since ? String(d.client_since).slice(0, 10) : "");
                  setEditing(true);
                }}
              >
                Edit
              </button>
            </div>
          ) : (
            <div className="op-since">
              <input
                type="date"
                aria-label="Client since"
                value={since}
                min="1900-01-01"
                max={OP_isoDate(new Date())}
                onChange={(e) => setSince(e.target.value)}
              />
              <button type="button" className="btn-primary btn-sm" disabled={busy || !since} onClick={() => saveSince(since)}>
                Save
              </button>
              {d.client_since_source === "staff" && (
                <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => saveSince(null)}>
                  {d.launch_date ? "Use launch date" : "Clear"}
                </button>
              )}
              <button type="button" className="link-btn" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          )}
          {msg && <p className="op-err">{msg}</p>}

          <h4 style={{ margin: "14px 0 6px", fontSize: 13.5 }}>Get to know them</h4>
          {ro ? (
            <p className="card-subtitle">Hidden in View as.</p>
          ) : d.can_see_get_to_know ? (
            d.get_to_know && Object.keys(d.get_to_know).length ? (
              <dl className="op-card-grid">
                {OP_GTK_FIELDS.map((f) => row(f.label, d.get_to_know[f.key]))}
                {row("Sent", d.get_to_know_submitted_at ? OP_fmtStamp(d.get_to_know_submitted_at) : "")}
              </dl>
            ) : (
              <p className="card-subtitle">No answers yet.</p>
            )
          ) : (
            <p className="card-subtitle">
              {d.has_get_to_know ? "Answers are in. " : ""}Shared with admins and the assigned team only.
            </p>
          )}
        </>
      )}
    </OV_Card>
  );
}
