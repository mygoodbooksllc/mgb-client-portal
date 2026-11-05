// Client org profile: the staff "Organization profile" card on a client's
// Overview, under Key dates (spec §5). Renders nothing unless OP_isOn()
// (firm switch tk_settings.org_profile_enabled, or the person's preview flag).
// Data: staff_client_org_profile (active staff who can open the client);
// Client since: staff_set_client_since (a date, or null to go back to the
// launch date). Get-to-know answers come back only for admins, the assigned
// bookkeeper and the account manager (server rule op__can_read_gtk).
// Tour target: data-tour="op-staff-card". Styles: components/client/op.css.
// Client contacts (docs/client-contacts-spec.md section 8), only while
// OPC_isOn(): a "People to contact" section (anchor ov-orgprofile-people,
// tour target op-staff-people) listing contact_list, add/edit through
// staff_client_contact_save, remove through tk_retire_client_contact, and the
// greeting mismatch flag. Gate off: the card is exactly as before.

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
  const contactsOn = OPC_useGate();
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
          {contactsOn && p && p.greeting_name ? (
            <dl className="op-card-grid" style={{ marginTop: 6 }}>
              {row("Greeting", p.greeting_name)}
            </dl>
          ) : null}
          {contactsOn && d.greeting && d.greeting.mismatch ? (
            <p className="op-flag">
              The client asks to be greeted as "{d.greeting.org_profile}"; Client info says "{d.greeting.client_profile}". Client info was not changed.
            </p>
          ) : null}
          {contactsOn ? (
            <OP_StaffPeople
              cid={cid}
              ro={ro}
              list={Array.isArray(d.contact_list) ? d.contact_list : []}
              onList={(list) => setSt((cur) => ({ status: "ready", error: "", data: Object.assign({}, cur.data || {}, { contact_list: list }) }))}
              onReload={() =>
                OP_api.staffProfile(cid).then((res) => {
                  if (!res.error) setSt({ status: "ready", data: res.data || {}, error: "" });
                })
              }
            />
          ) : null}

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

// ---- People to contact (client contacts gate) ----------------------------

function OP_staffContactError(e) {
  const msg = String((e && e.message) || "");
  if (/tk_contact_exists/.test(msg) || (e && e.code === "23505")) return "That email is already on this client's list.";
  if (/cc_off/.test(msg)) return "Contacts are still off for this client. Only a real admin can try it on a real client.";
  if (/cc_need_main/.test(msg)) return "Pick another person as the main contact instead.";
  if (/tk_bad_contact/.test(msg)) return "Check the name and email (no ? & , % # < > or quotes in the email).";
  if (/tk_not_found/.test(msg)) return "That contact was just changed or removed. Reload and try again.";
  return "Couldn't save the contact.";
}

function OP_StaffPeople({ cid, ro, list, onList, onReload }) {
  const [edit, setEdit] = React.useState(null); // contact_id, "new" or null
  const [extra, setExtra] = React.useState({}); // contact_id -> {role, notes} (staff-only fields)
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const preview = (() => {
    try {
      return window.localStorage.getItem("mgb_orgcontacts_preview") === "1";
    } catch (e) {
      return false;
    }
  })();

  React.useEffect(() => {
    let live = true;
    setEdit(null);
    setMsg("");
    if (ro) return undefined;
    OP_api.contactRows(cid).then((res) => {
      if (!live || !res || res.error) return;
      const m = {};
      (res.data || []).forEach((r) => {
        m[r.id] = { role: r.role || "", notes: r.notes || "" };
      });
      setExtra(m);
    });
    return () => {
      live = false;
    };
  }, [cid, ro]);

  const save = async (form, id) => {
    setBusy(true);
    setMsg("");
    const p = {
      name: form.name,
      email: form.email,
      title: form.title || null,
      role: form.role || null,
      notes: form.notes || null,
      gets_monthly_emails: !!form.gets_monthly_emails,
      can_answer: !!form.can_answer,
      is_main: !!form.is_main,
    };
    if (id) p.id = id;
    const res = await OP_api.saveContact(cid, p, preview);
    setBusy(false);
    if (res.error) {
      setMsg(OP_staffContactError(res.error));
      return;
    }
    const out = res.data || {};
    if (out.id) setExtra((m) => Object.assign({}, m, { [out.id]: { role: p.role || "", notes: p.notes || "" } }));
    if (Array.isArray(out.contact_list)) onList(out.contact_list);
    setEdit(null);
  };

  const retire = async (c) => {
    const who = c.name || c.email;
    const text = c.source === "main" ? "Remove " + who + "? The client will be asked to pick a new main contact." : "Remove " + who + "? Their open request links stop working.";
    if (!window.confirm(text)) return;
    setBusy(true);
    setMsg("");
    const res = await OP_api.retireContact(c.contact_id);
    setBusy(false);
    if (res.error) {
      setMsg("Couldn't remove the contact.");
      return;
    }
    onReload();
  };

  const editable = (c) => !!c.contact_id && (c.source === "main" || c.source === "contact");
  const badges = (c) => (
    <span className="op-badges">
      {c.is_main ? <span className="pill good">Main</span> : null}
      {c.gets_monthly_emails ? <span className="pill neutral">Monthly emails</span> : null}
      {c.can_answer ? <span className="pill neutral">Can answer</span> : null}
      {c.added_by_client ? <span className="pill warm">Added by client</span> : null}
      {c.opted_out ? <span className="pill warm">Opted out</span> : null}
    </span>
  );

  return (
    <div id="ov-orgprofile-people" data-tour="op-staff-people">
      <h4 style={{ margin: "14px 0 6px", fontSize: 13.5 }}>People to contact</h4>
      <p className="op-hint" style={{ margin: "0 0 8px" }}>
        One list for the Review board and email drafts. The client sees names, emails and titles here too, never notes.
      </p>
      {!list.length && edit !== "new" ? <p className="card-subtitle">No one yet.</p> : null}
      <ul className="op-people-list">
        {list.map((c, i) => {
          const key = c.contact_id || c.source + ":" + (c.email || i);
          if (edit && edit === c.contact_id) {
            const x = extra[c.contact_id] || {};
            return (
              <li key={key}>
                <OP_StaffPersonForm
                  init={{ name: c.name || "", email: c.email || "", title: c.title || "", role: x.role || "", notes: x.notes || "", gets_monthly_emails: !!c.gets_monthly_emails, can_answer: !!c.can_answer, is_main: !!c.is_main }}
                  wasMain={!!c.is_main}
                  busy={busy}
                  onSave={(f) => save(f, c.contact_id)}
                  onCancel={() => setEdit(null)}
                />
              </li>
            );
          }
          const label = OPC_sourceLabel(c);
          const meta = [c.email, c.phone, c.title || (c.role && typeof TK_ccRoleLabel === "function" ? TK_ccRoleLabel(c.role) : "")].filter(Boolean).join(" · ");
          return (
            <li key={key} className="op-people-row">
              <div className="op-people-main">
                <span>
                  <strong>{c.name || c.email || "No name"}</strong> {badges(c)}
                </span>
                {meta ? <span className="op-people-meta">{meta}</span> : null}
                <span className="op-people-meta">{label}</span>
                {!editable(c) ? <span className="op-people-meta">Ask the client to update their org profile, or add them here.</span> : null}
              </div>
              {editable(c) && !ro ? (
                <span className="op-since">
                  <button type="button" className="link-btn" disabled={busy} onClick={() => setEdit(c.contact_id)}>
                    Edit
                  </button>
                  <button type="button" className="link-btn" disabled={busy} onClick={() => retire(c)}>
                    Remove
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {edit === "new" ? (
        <OP_StaffPersonForm
          init={{ name: "", email: "", title: "", role: "", notes: "", gets_monthly_emails: true, can_answer: false, is_main: !list.some((c) => c.source === "main") }}
          wasMain={false}
          busy={busy}
          onSave={(f) => save(f, null)}
          onCancel={() => setEdit(null)}
        />
      ) : (
        <button
          type="button"
          className="link-btn"
          disabled={ro || busy}
          title={ro ? "Read-only in View as" : undefined}
          onClick={() => {
            setMsg("");
            setEdit("new");
          }}
        >
          + Add a person
        </button>
      )}
      {msg ? <p className="op-err">{msg}</p> : null}
    </div>
  );
}

function OP_StaffPersonForm({ init, wasMain, busy, onSave, onCancel }) {
  const [f, setF] = React.useState(init);
  const set = (k, v) => setF((cur) => Object.assign({}, cur, { [k]: v }));
  const emailOk = OPC_emailOk(f.email);
  const nameOk = OP_trim(f.name) !== "" && !OPC_CNTRL_RE.test(f.name) && !OPC_CNTRL_RE.test(f.title || "");
  const roles = typeof TK_CC_ROLES !== "undefined" ? TK_CC_ROLES : [];
  return (
    <form
      className="op-people-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (emailOk && nameOk) onSave(f);
      }}
    >
      <div className="op-row2">
        <div className="op-field">
          <label>Name</label>
          <input type="text" maxLength={120} required value={f.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="op-field">
          <label>Email</label>
          <input type="email" maxLength={254} required value={f.email} onChange={(e) => set("email", e.target.value)} />
          {f.email && !emailOk ? <div className="op-err">That doesn't look like an email address.</div> : null}
        </div>
      </div>
      <div className="op-row2">
        <div className="op-field">
          <label>Title (the client sees this)</label>
          <input type="text" maxLength={120} value={f.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="op-field">
          <label>Role</label>
          <select value={f.role} onChange={(e) => set("role", e.target.value)}>
            <option value="">None</option>
            {roles.map((r) => (
              <option key={r[0]} value={r[0]}>
                {r[1]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="op-field">
        <label>Notes (staff only)</label>
        <input type="text" maxLength={500} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      <div>
        <label className="op-check">
          <input type="checkbox" checked={!!f.gets_monthly_emails} onChange={(e) => set("gets_monthly_emails", e.target.checked)} />
          <span>Monthly emails</span>
        </label>
        <label className="op-check">
          <input type="checkbox" checked={!!f.can_answer} onChange={(e) => set("can_answer", e.target.checked)} />
          <span>Can answer requests</span>
        </label>
        <label className="op-check" title={wasMain ? "To change the main contact, make someone else main." : undefined}>
          <input type="checkbox" checked={!!f.is_main} disabled={wasMain} onChange={(e) => set("is_main", e.target.checked)} />
          <span>Main contact</span>
        </label>
      </div>
      <div className="op-since">
        <button type="submit" className="btn-primary btn-sm" disabled={busy || !emailOk || !nameOk}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="link-btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
