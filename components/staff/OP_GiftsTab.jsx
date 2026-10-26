// Team › Client gifts (hidden; real admins only, and only while OP_isOn()).
// Spec §5-§7: anniversaries in the next 30 days (admin_upcoming_anniversaries),
// Plan / Mark sent / Skip per row (client_gifts, admin-only RLS; a trigger
// stamps who and when), the $30-45 budget note, Past gifts, the line the
// weekly digest will show, and the one-time import DRY RUN (nothing saved).
// Nothing here emails anyone or orders a gift.
// Tour targets: data-tour="op-gifts-upcoming", "op-gifts-basis", "op-gifts-import".
// Gift basis (firm-wide, admin_gift_basis / admin_set_gift_basis): which
// anniversary the list and the digest follow, Client since (default) or the
// founding date (Client since when the founding date isn't known).
// Styles: components/client/op.css.

const OP_GIFTS_SETUP_MSG = "This needs supabase/client-org-profile.sql, which hasn't been run here.";

function OP_GiftsTab({ staffUser, clients }) {
  const on = OP_useGate();
  if (!on) return <p className="card-subtitle">Client gifts isn't available right now.</p>;
  return <OP_GiftsBody clients={clients} />;
}

function OP_giftsErr(e) {
  if (!e) return "";
  if ((typeof isMissingTableError === "function" && isMissingTableError(e)) || e.code === "PGRST202" || e.code === "42883") return OP_GIFTS_SETUP_MSG;
  if (e.code === "42501" || /not allowed|permission/i.test(e.message || "")) return "Only admins can see client gifts.";
  return "Couldn't load client gifts.";
}

function OP_GiftsBody({ clients }) {
  const [up, setUp] = React.useState({ status: "loading", rows: [], error: "" });
  const [past, setPast] = React.useState({ status: "loading", rows: [], error: "" });
  const [planFor, setPlanFor] = React.useState(null); // row key
  const [busy, setBusy] = React.useState(null);
  const [msg, setMsg] = React.useState("");

  const load = React.useCallback(() => {
    OP_api.upcoming(30).then((res) => {
      if (res.error) setUp({ status: "error", rows: [], error: OP_giftsErr(res.error) });
      else setUp({ status: "ready", rows: res.data || [], error: "" });
    });
    Promise.resolve(OP_api.gifts()).then(
      (res) => {
        if (res.error) setPast({ status: "error", rows: [], error: OP_giftsErr(res.error) });
        else setPast({ status: "ready", rows: res.data || [], error: "" });
      },
      (e) => setPast({ status: "error", rows: [], error: OP_giftsErr(e) }),
    );
  }, []);
  React.useEffect(() => load(), [load]);

  const keyOf = (r) => r.client_id + "|" + r.occasion + "|" + r.occasion_date;
  const nameOf = (id) => {
    const c = (clients || []).find((x) => x && x.id === id);
    return (c && c.name) || id;
  };

  // Plan (insert as planned, or update an existing gift), Mark sent, Skip.
  const write = async (r, patch) => {
    setBusy(keyOf(r));
    setMsg("");
    const res = r.gift_id
      ? await OP_api.updateGift(r.gift_id, patch)
      : await OP_api.addGift(Object.assign({ client_id: r.client_id, occasion: r.occasion, occasion_date: r.occasion_date }, patch));
    setBusy(null);
    if (res.error) {
      setMsg(res.error.code === "23505" ? "A gift for that anniversary is already on record. Reloaded." : "Couldn't save that gift. " + OP_giftsErr(res.error));
      load();
      return false;
    }
    setPlanFor(null);
    load();
    return true;
  };

  const today = OP_isoDate(new Date());
  const pastRows = (past.rows || []).filter((g) => g.status !== "planned" || g.occasion_date < today);

  return (
    <div className="op-gifts">
      <OP_GiftBasis onSaved={load} />

      <div className="card" data-tour="op-gifts-upcoming" style={{ marginTop: 16 }}>
        <h3 className="card-title">Anniversaries in the next 30 days</h3>
        <p className="op-digest">
          {up.status === "ready" ? "This week's digest line: " + OP_digestLine(up.rows) : ""}
          {up.status === "ready" ? " (sent only while the firm switch is on)." : ""}
        </p>
        <p className="op-hint" style={{ marginTop: 0 }}>
          Gift budget: ${OP_BUDGET_MIN}-{OP_BUDGET_MAX}. Client since comes from the client's launch date unless staff set it on the client's Overview. Nothing here emails anyone or orders anything.
        </p>
        {msg && (
          <p className="op-err" role="alert">
            {msg}
          </p>
        )}
        {up.status === "loading" && <p className="card-subtitle">Loading…</p>}
        {up.status === "error" && <p className="card-subtitle">{up.error}</p>}
        {up.status === "ready" && up.rows.length === 0 && <p className="card-subtitle">No anniversaries in the next 30 days.</p>}
        {up.status === "ready" && up.rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Occasion</th>
                <th>Date</th>
                <th>Years</th>
                <th>Gift</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {up.rows.map((r) => {
                const k = keyOf(r);
                const s = OP_giftStatus(r);
                const tone = s.key === "sent" ? "good" : s.key === "planned" ? "warm" : "neutral";
                return (
                  <tr key={k}>
                    <td>
                      <a href={"#/client/" + encodeURIComponent(r.client_id) + "/overview"}>{r.client_name || nameOf(r.client_id)}</a>
                      <div className="op-hint">
                        {r.profile_complete ? "Profile complete" : "Profile incomplete"}
                        {r.has_get_to_know ? " · get-to-know answers in" : ""}
                      </div>
                    </td>
                    <td>{OP_occasionLabel(r.occasion)}</td>
                    <td>{OP_fmtDate(r.occasion_date)}</td>
                    <td>{OP_yearsLabel(r.years)}</td>
                    <td>
                      <span className={"pill " + tone}>{s.label}</span>
                      {r.gift_item ? <div className="op-hint">{r.gift_item + (r.gift_amount != null ? " · $" + Number(r.gift_amount).toFixed(2) : "")}</div> : null}
                      {planFor === k && <OP_PlanForm row={r} busy={busy === k} onCancel={() => setPlanFor(null)} onSave={(v) => write(r, Object.assign({ status: "planned" }, v))} />}
                    </td>
                    <td>
                      <div className="op-row-actions">
                        {s.key !== "sent" && planFor !== k && (
                          <button type="button" className="btn-secondary btn-sm" disabled={busy === k} onClick={() => setPlanFor(k)}>
                            {s.key === "planned" ? "Edit plan" : "Plan"}
                          </button>
                        )}
                        {s.key !== "sent" && (
                          <button type="button" className="btn-secondary btn-sm" disabled={busy === k} onClick={() => write(r, { status: "sent" })}>
                            Mark sent
                          </button>
                        )}
                        {s.key !== "sent" && s.key !== "skipped" && (
                          <button type="button" className="link-btn" disabled={busy === k} onClick={() => write(r, { status: "skipped" })}>
                            Skip
                          </button>
                        )}
                        {s.key === "skipped" && (
                          <button type="button" className="link-btn" disabled={busy === k} onClick={() => write(r, { status: "planned" })}>
                            Undo skip
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 className="card-title">Past gifts</h3>
        {past.status === "loading" && <p className="card-subtitle">Loading…</p>}
        {past.status === "error" && <p className="card-subtitle">{past.error}</p>}
        {past.status === "ready" && pastRows.length === 0 && <p className="card-subtitle">No gifts on record yet.</p>}
        {past.status === "ready" && pastRows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Occasion</th>
                <th>Date</th>
                <th>Status</th>
                <th>Gift</th>
              </tr>
            </thead>
            <tbody>
              {pastRows.map((g) => (
                <tr key={g.id}>
                  <td>{nameOf(g.client_id)}</td>
                  <td>{OP_occasionLabel(g.occasion)}</td>
                  <td>{OP_fmtDate(g.occasion_date)}</td>
                  <td>
                    <span className={"pill " + (g.status === "sent" ? "good" : g.status === "planned" ? "warm" : "neutral")}>{OP_giftStatus({ gift_status: g.status }).label}</span>
                    {g.status === "sent" && g.sent_at ? <div className="op-hint">{OP_fmtStamp(g.sent_at) + (g.sent_by ? " by " + g.sent_by : "")}</div> : null}
                  </td>
                  <td>
                    {[g.item, g.amount != null ? "$" + Number(g.amount).toFixed(2) : ""].filter(Boolean).join(" · ")}
                    {g.notes ? <div className="op-hint">{g.notes}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <OP_ImportDryRun clients={clients} />
    </div>
  );
}

// Firm-wide choice of which anniversary to follow. Admin only (the RPCs
// refuse anyone else); every change is audited in tk_settings_audit.
function OP_GiftBasis({ onSaved }) {
  const [st, setSt] = React.useState({ status: "loading", value: "client_since", error: "" });
  const [saving, setSaving] = React.useState(false);
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    let live = true;
    OP_api.giftBasis().then((res) => {
      if (!live) return;
      if (res.error) setSt({ status: "error", value: "client_since", error: OP_giftsErr(res.error) });
      else setSt({ status: "ready", value: OP_giftBasisNorm(res.data), error: "" });
    });
    return () => {
      live = false;
    };
  }, []);
  const pick = async (v) => {
    if (!OP_giftBasisValid(v) || v === st.value || saving) return;
    setSaving(true);
    setNote("");
    const res = await OP_api.setGiftBasis(v);
    setSaving(false);
    if (res.error) {
      setNote("Couldn't save that. " + OP_giftsErr(res.error));
      return;
    }
    setSt({ status: "ready", value: OP_giftBasisNorm(res.data), error: "" });
    setNote("Saved. The list and the weekly digest now follow " + OP_giftBasisLabel(res.data) + ".");
    if (onSaved) onSaved();
  };
  return (
    <div className="card" data-tour="op-gifts-basis">
      <h3 className="card-title">Anniversary to follow</h3>
      <p className="op-hint" style={{ marginTop: 0 }}>
        One choice for the whole firm. It changes which date shows below and what the weekly digest counts.
      </p>
      {st.status === "loading" && <p className="card-subtitle">Loading…</p>}
      {st.status === "error" && <p className="card-subtitle">{st.error}</p>}
      {st.status === "ready" && (
        <div role="radiogroup" aria-label="Anniversary to follow">
          {OP_GIFT_BASES.map((b) => (
            <label key={b.value} style={{ display: "block", margin: "6px 0", cursor: saving ? "default" : "pointer" }}>
              <input type="radio" name="op-gift-basis" value={b.value} checked={st.value === b.value} disabled={saving} onChange={() => pick(b.value)} />{" "}
              <strong>{b.label}</strong> <span className="op-hint">{b.hint}</span>
            </label>
          ))}
        </div>
      )}
      {note && (
        <p className={/Couldn't/.test(note) ? "op-err" : "op-hint"} role="status">
          {note}
        </p>
      )}
    </div>
  );
}

function OP_PlanForm({ row, busy, onCancel, onSave }) {
  const [item, setItem] = React.useState(row.gift_item || "");
  const [amount, setAmount] = React.useState(row.gift_amount != null ? String(row.gift_amount) : String(OP_DEFAULT_AMOUNT));
  const [notes, setNotes] = React.useState("");
  const warn = OP_budgetWarning(amount);
  const bad = warn && /must be|Enter an amount/.test(warn);
  return (
    <div>
      <div className="op-plan">
        <input type="text" aria-label="Gift item" placeholder="Item (e.g. cookie tin)" maxLength={200} value={item} onChange={(e) => setItem(e.target.value)} />
        <input type="number" aria-label="Amount in dollars" min="0" max="500" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <textarea aria-label="Notes" placeholder="Notes (optional)" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {warn && <p className={bad ? "op-err" : "op-hint"}>{warn}</p>}
      <div className="op-row-actions" style={{ marginTop: 6 }}>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={busy || bad}
          onClick={() => {
            const patch = { item: item.trim() || null, amount: amount === "" ? null : Number(amount) };
            if (notes.trim()) patch.notes = notes.trim();
            onSave(patch);
          }}
        >
          {busy ? "Saving…" : "Save plan"}
        </button>
        <button type="button" className="link-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// One-time import, DRY RUN only (spec §7). Paste the sheet as CSV and see how
// it would match. There is no write button: the real import waits for owner
// approval. Nothing typed here is stored anywhere.
const OP_IMPORT_BUCKETS = [
  ["matched", "Matched"],
  ["unmatched", "No matching client"],
  ["ambiguousName", "More than one possible client"],
  ["badDates", "Bad or missing dates"],
  ["ambiguousDates", "Unsure or partial dates"],
  ["incompleteAddress", "Address missing a city or ZIP"],
  ["poBox", "PO boxes (couriers can't deliver)"],
];

function OP_ImportDryRun({ clients }) {
  const [text, setText] = React.useState("");
  const [res, setRes] = React.useState(null);
  const run = () => {
    const list = (clients || []).filter((c) => c && c.id && c.name && !c.test_only && !c.is_internal).map((c) => ({ id: c.id, name: c.name }));
    setRes(OPI_dryRun(text, list, { today: OP_isoDate(new Date()) }));
  };
  const dateText = (d) => {
    if (!d) return "";
    if (d.status === "empty") return "no date";
    if (d.status === "bad") return "unreadable date (" + (d.reason || "bad") + ")";
    const when = d.iso ? OP_fmtDate(d.iso) : d.month ? OP_MONTHS[d.month - 1] + " " + d.year : d.year ? String(d.year) : "";
    return [when, d.status === "ambiguous" ? "hedged" : d.status === "partial" ? d.reason : "", d.hint].filter(Boolean).join(", ");
  };
  return (
    <details className="card op-import" style={{ marginTop: 16 }} data-tour="op-gifts-import">
      <summary className="card-title" style={{ cursor: "pointer" }}>
        Import dry run (anniversary sheet)
      </summary>
      <p className="op-note">Nothing is saved. The real import waits for owner approval.</p>
      <p className="op-hint">
        Export the sheet as CSV with the columns Customer Name, Email, Anniversary and Address, and paste it below. It stays in this browser tab.
      </p>
      <textarea aria-label="CSV to check" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="op-row-actions" style={{ marginTop: 8 }}>
        <button type="button" className="btn-secondary btn-sm" disabled={!text.trim()} onClick={run}>
          Check matches
        </button>
        {res && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setText("");
              setRes(null);
            }}
          >
            Clear
          </button>
        )}
      </div>
      {res && (
        <div>
          <p className="op-hint">
            {res.total} rows.{" "}
            {!res.columns.name || !res.columns.anniversary || !res.columns.address
              ? "Missing columns: " +
                [!res.columns.name && "Customer Name", !res.columns.anniversary && "Anniversary", !res.columns.address && "Address"].filter(Boolean).join(", ") +
                "."
              : ""}
            {res.counts.duplicateClients ? " " + res.counts.duplicateClients + " clients match more than one row." : ""}
          </p>
          <div className="op-counts">
            {OP_IMPORT_BUCKETS.map(([k, label]) => (
              <span key={k} className={"pill " + (k === "matched" ? "good" : res.counts[k] ? "warm" : "neutral")}>
                {label}: {res.counts[k]}
              </span>
            ))}
          </div>
          {OP_IMPORT_BUCKETS.filter(([k]) => res.counts[k]).map(([k, label]) => (
            <div key={k}>
              <strong style={{ fontSize: 13 }}>{label}</strong>
              <ul>
                {res.buckets[k].slice(0, 200).map((e) => (
                  <li key={k + e.row}>
                    Row {e.row}: {e.name || "(no name)"}
                    {e.client ? " → " + e.client.name + (e.fuzzy ? " (close match)" : "") + (e.duplicate ? " (also on another row)" : "") : ""}
                    {e.candidates && !e.client ? " → " + e.candidates.map((c) => c.name).join(" or ") + "?" : ""}
                    {k === "badDates" || k === "ambiguousDates" ? " · " + dateText(e.date) : ""}
                    {k === "incompleteAddress" ? " · " + (e.address.empty ? "no address" : [e.address.noCity && "no city", e.address.noZip && "no ZIP"].filter(Boolean).join(", ")) : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
