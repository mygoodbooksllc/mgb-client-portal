// Client org profile: the client's form (spec §2, §3). Mounted by App only
// for a real client session (clientPortalUser && !isStaffSession &&
// !impersonating && !isPreviewingUser). It opens by itself once per sign-in
// while the profile is incomplete and the gate is on (OP_clientGate: the RPC's
// `eligible`, and the firm switch or the person's preview flag). "Later"
// stores sessionStorage mgb_op_later:<email>, so it returns next sign-in.
// The Needs-you item and the ? menu entry reopen it (window "mgb:op-open").
// Get-to-know answers are write-only: they are never read back.
// Styles: components/client/op.css. Element id "op-prompt" holds the client
// tour (OP_promptPending in OP_store.js).

function OP_ClientPrompt({ email }) {
  const st = OP_useMine(true);
  const gate = OP_clientGate(st);
  const [open, setOpen] = React.useState(false);
  const autoDone = React.useRef(false);

  // Auto-open once per page load: incomplete, gate on, not put off this session,
  // and not over a running tour.
  React.useEffect(() => {
    if (autoDone.current || !gate.on || gate.complete) return undefined;
    if (OP_laterOn(email)) {
      autoDone.current = true;
      return undefined;
    }
    let tries = 0;
    let t = null;
    const tryOpen = () => {
      if (document.querySelector(".tour-root") && tries++ < 300) {
        t = setTimeout(tryOpen, 1000);
        return;
      }
      autoDone.current = true;
      setOpen(true);
    };
    tryOpen();
    return () => clearTimeout(t);
  }, [gate.on, gate.complete, email]);

  React.useEffect(() => {
    const onOpen = () => {
      if (OP_clientGate(OP_mine.get()).on) setOpen(true);
    };
    window.addEventListener("mgb:op-open", onOpen);
    return () => window.removeEventListener("mgb:op-open", onOpen);
  }, []);

  if (!open || !gate.on || !gate.data) return null;
  return (
    <OP_ClientForm
      data={gate.data}
      onLater={() => {
        OP_laterSet(email);
        setOpen(false);
      }}
      onSaved={(d) => {
        OP_mine.setData(d);
        setOpen(false);
      }}
    />
  );
}

// A save error in plain words: the server names the field by its key and
// never echoes the value; swap the key for its label.
function OP_saveError(e) {
  const msg = String((e && e.message) || "");
  if (!msg) return "Please try again.";
  if (/not allowed/i.test(msg)) return "Your sign-in can't change this profile.";
  const m = /^(?:get_to_know\.)?([a-z_]+)(?::)?\s+(.*)$/.exec(msg);
  if (m && OP_FIELD_LABELS[m[1]]) return OP_FIELD_LABELS[m[1]] + ": " + m[2] + ".";
  return "Please check the form and try again.";
}

function OP_ClientForm({ data, onLater, onSaved }) {
  const pre = data.prefill || {};
  const orgAddress = OP_trim(pre.org_address);
  const [form, setForm] = React.useState(() => OP_initialForm(data));
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [tried, setTried] = React.useState(false);
  const check = OP_checkForm(form, { orgAddress });
  const set = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
  const setGtk = (k, v) => setForm((f) => Object.assign({}, f, { gtk: Object.assign({}, f.gtk, { [k]: v }) }));
  const fieldErr = (k) => (check.errors[k] ? <div className="op-err">{check.errors[k]}</div> : null);
  const missing = (k) => tried && check.missing.includes(k);
  const req = <span className="op-req"> (required)</span>;

  const save = async () => {
    setTried(true);
    setErr("");
    if (Object.keys(check.errors).length) return;
    setSaving(true);
    const res = await OP_api.save(check.payload);
    setSaving(false);
    if (res.error) {
      setErr("We couldn't save that. " + OP_saveError(res.error));
      return;
    }
    onSaved(res.data);
  };

  const input = (k, label, type, opts) => (
    <div className="op-field">
      <label htmlFor={"op-" + k}>
        {label}
        {opts && opts.required ? req : null}
      </label>
      <input
        id={"op-" + k}
        type={type || "text"}
        value={form[k] || ""}
        maxLength={OP_LIMITS[k] || undefined}
        aria-invalid={check.errors[k] || missing(k) ? "true" : undefined}
        onChange={(e) => set(k, e.target.value)}
        autoComplete={(opts && opts.autoComplete) || "off"}
      />
      {fieldErr(k)}
      {opts && opts.hint ? <p className="op-hint">{opts.hint}</p> : null}
    </div>
  );

  // Month and day are picked separately; the form value is "MM-DD" only when both are set.
  const fyeInit = /^\d{2}-\d{2}$/.test(form.fiscal_year_end || "") ? form.fiscal_year_end.split("-") : ["", ""];
  const [fyeMonth, setFyeMonth] = React.useState(fyeInit[0]);
  const [fyeDay, setFyeDay] = React.useState(fyeInit[1]);
  const setFye = (m, d) => {
    setFyeMonth(m);
    setFyeDay(d);
    set("fiscal_year_end", m && d ? m + "-" + d : "");
  };
  const pad = (n) => (n < 10 ? "0" : "") + n;

  return (
    <ModalShell onClose={onLater} labelledBy="op-prompt-title" className="op-panel">
      <div id="op-prompt">
        <div className="modal-header">
          <h3 id="op-prompt-title">Finish your organization profile</h3>
          <button type="button" className="modal-close" onClick={onLater} aria-label="Later">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="card-subtitle" style={{ marginTop: 0 }}>
            A few details so we address things to you correctly and can mark your milestones with you. About two minutes.
          </p>
          <div className="op-form">
            {input("card_name", "Name for cards and gifts", "text", { required: true })}
            {input("org_type", "Organization type", "text", { required: true, hint: "For example: church, school, nonprofit, ministry." })}
            <div className="op-field">
              <label htmlFor="op-established_date">
                Established date{req}
              </label>
              <input
                id="op-established_date"
                type="date"
                value={form.established_unknown ? "" : form.established_date || ""}
                disabled={form.established_unknown}
                min="1800-01-01"
                max={OP_isoDate(new Date())}
                onChange={(e) => set("established_date", e.target.value)}
              />
              <label className="op-check">
                <input type="checkbox" checked={!!form.established_unknown} onChange={(e) => set("established_unknown", e.target.checked)} />
                <span>Not sure</span>
              </label>
              {fieldErr("established_date")}
            </div>
            <div className="op-field">
              <label htmlFor="op-gift_address">
                Gift mailing address{req}
              </label>
              <textarea
                id="op-gift_address"
                value={form.gift_same_as_org ? orgAddress : form.gift_address || ""}
                disabled={form.gift_same_as_org}
                maxLength={OP_LIMITS.gift_address}
                onChange={(e) => set("gift_address", e.target.value)}
              />
              <label className="op-check" title={orgAddress ? "" : "We don't have an organization address on file."}>
                <input
                  type="checkbox"
                  checked={!!form.gift_same_as_org}
                  disabled={!orgAddress}
                  onChange={(e) => set("gift_same_as_org", e.target.checked)}
                />
                <span>Same as organization address</span>
              </label>
              {fieldErr("gift_address")}
            </div>
            <div className="op-row2">
              {input("receiver_name", "Who receives deliveries", "text", { required: true })}
              {input("courier_phone", "Phone for couriers", "tel", { required: true, autoComplete: "tel" })}
            </div>
            <h4>Main contact</h4>
            {input("contact_name", "Name", "text", { required: true, autoComplete: "name" })}
            <div className="op-row2">
              {input("contact_email", "Email", "email", { autoComplete: "email" })}
              {input("contact_phone", "Phone", "tel", { autoComplete: "tel" })}
            </div>
            <p className="op-hint" style={{ marginTop: -8 }}>
              An email or a phone number is enough.
            </p>
            <div className="op-field">
              <span className="op-label" id="op-fye-label">
                Fiscal year end{req}
              </span>
              <div className="op-row2" role="group" aria-labelledby="op-fye-label">
                <select aria-label="Month" value={fyeMonth} onChange={(e) => setFye(e.target.value, fyeDay)}>
                  <option value="">Month</option>
                  {OP_MONTHS.map((m, i) => (
                    <option key={m} value={pad(i + 1)}>
                      {m}
                    </option>
                  ))}
                </select>
                <select aria-label="Day" value={fyeDay} onChange={(e) => setFye(fyeMonth, e.target.value)}>
                  <option value="">Day</option>
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i} value={pad(i + 1)}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </div>
              {fieldErr("fiscal_year_end")}
            </div>

            <h4>Get to know you (optional)</h4>
            {data.has_get_to_know ? (
              <p className="op-note">Thanks, we have your answers. Sending new ones replaces them.</p>
            ) : (
              <p className="op-hint" style={{ marginTop: 0 }}>
                Only our team sees these. Skip any you like.
              </p>
            )}
            {OP_GTK_FIELDS.map((f) => (
              <div className="op-field" key={f.key}>
                <label htmlFor={"op-gtk-" + f.key}>{f.label}</label>
                <input
                  id={"op-gtk-" + f.key}
                  type="text"
                  value={form.gtk[f.key] || ""}
                  maxLength={OP_LIMITS.gtk}
                  onChange={(e) => setGtk(f.key, e.target.value)}
                  autoComplete="off"
                />
                {check.errors["gtk." + f.key] ? <div className="op-err">{check.errors["gtk." + f.key]}</div> : null}
              </div>
            ))}
          </div>
          {tried && check.missing.length > 0 && !Object.keys(check.errors).length ? (
            <p className="op-hint">
              Still to fill in: {check.missing.map((k) => OP_FIELD_LABELS[k]).join(", ")}. You can save now and finish later.
            </p>
          ) : null}
          {err ? (
            <p className="op-err" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <div className="modal-footer">
          <span className="op-hint">{check.complete ? "Everything required is filled in." : ""}</span>
          <div className="op-actions">
            <button type="button" className="btn-secondary" onClick={onLater} disabled={saving}>
              Later
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
