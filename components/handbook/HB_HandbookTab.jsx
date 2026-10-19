// Staff Handbook: the Team › Handbook tab (spec docs/staff-handbook-spec.md).
//
//   HB_HandbookTab({ staffUser, isAdmin })   TeamPage.jsx TP_TeamHub body
//
// Routes (hash; the hub owns #/team/handbook, this file what follows it):
//   #/team/handbook                    the policy list
//   #/team/handbook/<slug>             one policy, latest version (HB_PolicyView)
//   #/team/handbook/<slug>/v<n>        an older version
// Deep link #/team/handbook?item=handbook:<slug> (Today rows, emails) opens
// that policy; this tab claims it with LK_useArrival.
//
// List view: the countersigner line (admins), the countersign queue (the
// countersigner), a search box and (admins) New policy, then the policies
// grouped (HB_groupPolicies: "Policies to sign", one group per section for
// reference policies, "Drafts" for admins), each with my status
// (bookkeepers, signing policies only), then for admins the status grid and
// the not-filed list (HB_Admin.jsx). The publish editor lives in the policy
// view (HB_PolicyView, admins, latest version); New policy swaps the list for
// HB_NewPolicy (HB_Admin.jsx).

function HB_parseRoute() {
  const h = String(window.location.hash || "").split("?")[0];
  const m = /^#\/team\/handbook(?:\/(.*))?$/.exec(h);
  const rest = m && m[1] ? m[1].split("/").filter(Boolean) : [];
  let slug = null;
  try {
    slug = rest[0] ? decodeURIComponent(rest[0]) : null;
  } catch (e) {
    slug = null;
  }
  const vm = rest[1] ? /^v(\d+)$/.exec(rest[1]) : null;
  return { slug, versionNo: vm ? Number(vm[1]) : null };
}

function HB_useRoute() {
  const [route, setRoute] = React.useState(HB_parseRoute);
  React.useEffect(() => {
    // mgb-tabchange: clicking the Handbook tab rewrites the hash to
    // #/team/handbook with replaceState (no hashchange), back to the list.
    const on = () => setRoute(HB_parseRoute());
    window.addEventListener("hashchange", on);
    window.addEventListener("mgb-tabchange", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("mgb-tabchange", on);
    };
  }, []);
  return route;
}

// Version history for one policy, newest first. Used by HB_PolicyView.
function HB_VersionHistory({ slug, versions, current, latest, mySigs, kind }) {
  if (!versions || !versions.length) return null;
  const signed = new Set((mySigs || []).map((s) => s.version_no));
  return (
    <section className="card hb-history" aria-labelledby="hb-history-title">
      <h3 className="card-title" id="hb-history-title">
        Version history
      </h3>
      <ul className="hb-list">
        {versions.map((x) => {
          const isCur = x.version_no === current;
          return (
            <li key={x.id} className={"hb-list-row" + (isCur ? " is-current" : "")}>
              <div className="hb-list-main">
                <strong>
                  Version {x.version_no}
                  {x.version_no === latest ? " (current)" : ""}
                </strong>
                <span className="hb-muted">
                  {HB_fmtDate(x.published_at)}
                  {x.requires_resign ? " · Needs signing" : kind === "reference" ? "" : " · Minor edit"}
                  {signed.has(x.version_no) ? " · Signed by you" : ""}
                </span>
                {x.change_note && <span className="hb-note">{x.change_note}</span>}
              </div>
              {isCur ? (
                <span className="hb-muted">Showing</span>
              ) : (
                <button type="button" className="link-btn" onClick={() => HB_goPolicy(slug, x.version_no === latest ? null : x.version_no)}>
                  View
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Admins: who countersigns, or a warning when nobody active is set. The
// picker is a plain select of active staff; hb_set_countersigner checks admin.
function HB_CountersignerLine({ status }) {
  const toast = HB_useToastSafe();
  const [editing, setEditing] = React.useState(false);
  const [staff, setStaff] = React.useState(null);
  const [pick, setPick] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!editing || staff) return undefined;
    let live = true;
    const sb = window.mgbSupabase;
    if (!sb) return undefined;
    sb.from("staff")
      .select("email, name, active")
      .eq("active", true)
      .order("name")
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) setError(HB_errText(e));
        else setStaff(data || []);
      });
    return () => {
      live = false;
    };
  }, [editing]);

  const cs = status.countersigner;
  const save = async () => {
    if (!pick) return;
    setBusy(true);
    setError("");
    try {
      await HB_api.setCountersigner(pick);
      toast("Countersigner updated.");
      setEditing(false);
      HB_changed();
    } catch (e) {
      setError(HB_errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={"hb-banner" + (status.countersigner_missing ? " warm" : "")} role="status">
      <div className="hb-cs-line">
        <span>
          {status.countersigner_missing ? (
            <strong>No active countersigner set.</strong>
          ) : (
            <>
              Countersigner: <strong>{cs && cs.name}</strong>
            </>
          )}
          {Number(status.pending_countersign_count) > 0 && (
            <span className="hb-muted"> · {status.pending_countersign_count} waiting to be countersigned</span>
          )}
          {Number(status.unfiled_count) > 0 && <span className="hb-muted"> · {status.unfiled_count} not filed to Drive yet</span>}
        </span>
        {!editing && (
          <button type="button" className="link-btn" onClick={() => setEditing(true)}>
            {status.countersigner_missing ? "Set countersigner" : "Change"}
          </button>
        )}
      </div>
      {editing && (
        <div className="hb-cs-pick">
          <label className="hb-sr" htmlFor="hb-cs-select">
            Countersigner
          </label>
          <select id="hb-cs-select" className="hb-sel" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!staff}>
            <option value="">{staff ? "Choose a staff member" : "Loading…"}</option>
            {(staff || []).map((s) => (
              <option key={s.email} value={s.email}>
                {s.name || s.email}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" disabled={!pick || busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      )}
      <HB_Error text={error} />
    </div>
  );
}

function HB_PolicyRow({ p, isSigner }) {
  const signing = HB_isSigning(p);
  const my = signing ? p.my : null;
  const pill = HB_isDraft(p) ? ["Draft", "neutral"] : isSigner && signing ? HB_statePill(my) : null;
  const due =
    isSigner && my && (my.state === "not_signed" || my.state === "overdue") && my.due_date
      ? my.overdue
        ? "Overdue (was due " + HB_fmtDay(my.due_date) + ")"
        : "Due " + HB_fmtDay(my.due_date)
      : "";
  return (
    <li className="hb-list-row hb-policy" data-lk={"handbook:" + p.slug}>
      <button type="button" className="hb-policy-btn" onClick={() => HB_goPolicy(p.slug)}>
        <span className="hb-list-main">
          <strong>{p.title}</strong>
          <span className="hb-muted">
            {HB_isDraft(p) ? (HB_kindOf(p) === "signed" ? "To sign · " : "Reference · ") : ""}
            Version {p.latest_version_no}
            {due ? " · " + due : ""}
            {my && my.state === "signed" && my.version_no ? " · You signed v" + my.version_no : ""}
          </span>
        </span>
        {pill && <HB_Pill tone={pill[1]}>{pill[0]}</HB_Pill>}
      </button>
    </li>
  );
}

function HB_HandbookTab({ staffUser, isAdmin }) {
  const { data, error } = HB_useStatus();
  const route = HB_useRoute();
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  // Opening a policy, or clicking the Handbook tab again, closes the New
  // policy form (HB_useRoute hands back a new route object each time).
  React.useEffect(() => setCreating(false), [route]);

  // Deep link: #/team/handbook?item=handbook:<slug>.
  LK_useArrival({ place: "team", tab: "handbook", staff: true, kinds: ["handbook"] }, !!data, (a) => {
    const hit = ((data && data.policies) || []).find((p) => p.slug === a.id);
    if (hit) {
      HB_goPolicy(hit.slug);
    } else {
      const el = LK_find("handbook:" + a.id);
      if (el) LK_reveal(el, { row: true });
      else LK_toast(LK_COPY.policyMissing || "That policy isn't in the handbook anymore.");
    }
  });

  if (route.slug)
    return <HB_PolicyView slug={route.slug} versionNo={route.versionNo} status={data} onBack={() => HB_goPolicy(null)} />;

  if (error && !data) return <HB_Error text={error} />;
  if (!data) return <p className="hb-muted">Loading…</p>;

  const me = data.me || {};
  const policies = data.policies || [];
  const queue = data.to_countersign || [];
  const canCreate = !!me.is_admin && typeof HB_NewPolicy === "function";

  if (creating && canCreate)
    return (
      <HB_NewPolicy
        policies={policies}
        bookkeeperCount={(data.bookkeepers || []).length}
        onCancel={() => setCreating(false)}
        onCreated={(slug) => {
          setCreating(false);
          HB_goPolicy(slug);
        }}
      />
    );

  const shown = HB_searchPolicies(policies, query);
  const groups = HB_groupPolicies(shown);

  return (
    <div className="hb-tab">
      {me.is_admin && <HB_CountersignerLine status={data} />}

      {me.is_countersigner && queue.length > 0 && (
        <section className="card hb-queue" aria-labelledby="hb-queue-title">
          <h3 className="card-title" id="hb-queue-title">
            To countersign
          </h3>
          <ul className="hb-list">
            {queue.map((q) => (
              <li key={q.signature_id} className="hb-list-row">
                <button type="button" className="hb-policy-btn" onClick={() => HB_goPolicy(q.policy_slug)}>
                  <span className="hb-list-main">
                    <strong>
                      {q.signer_name || "Bookkeeper"}, {q.policy_title} v{q.version_no}
                    </strong>
                    <span className="hb-muted">Signed {HB_fmtDate(q.signed_at)}</span>
                  </span>
                  <HB_Pill tone="warm">Countersign</HB_Pill>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card hb-policies" aria-labelledby="hb-policies-title">
        <div className="hb-row-head">
          <h3 className="card-title" id="hb-policies-title">
            Policies
          </h3>
          {canCreate && (
            <button type="button" className="btn-secondary" onClick={() => setCreating(true)}>
              New policy
            </button>
          )}
        </div>
        <p className="hb-muted">
          {me.is_signer
            ? "Read each policy to sign and sign it at the end. When one changes and needs signing again, it shows here and on Today. The rest are for reference: read them any time."
            : "Bookkeepers sign the policies to sign. The rest are for reference. Anyone on the team can read them here."}
        </p>
        {policies.length > 0 && (
          <div className="hb-search">
            <label className="hb-sr" htmlFor="hb-search">
              Search policies
            </label>
            <input
              id="hb-search"
              type="search"
              className="hb-inp"
              value={query}
              placeholder="Search policies"
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
        {!policies.length ? (
          <p className="hb-muted">No policies yet.</p>
        ) : !groups.length ? (
          <p className="hb-muted">No policies match "{query.trim()}".</p>
        ) : (
          groups.map((g) => (
            <div key={g.key} className={"hb-group" + (g.key === "sign" ? " is-sign" : g.key === "drafts" ? " is-drafts" : "")}>
              <h4 className="hb-group-title">
                {g.label}
                {g.key === "drafts" && <span className="hb-muted"> · Only admins see drafts</span>}
              </h4>
              <ul className="hb-list">
                {g.items.map((p) => (
                  <HB_PolicyRow key={p.id} p={p} isSigner={!!me.is_signer} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {me.is_admin && typeof HB_UnfiledCard === "function" && <HB_UnfiledCard status={data} />}
      {me.is_admin && typeof HB_StatusGrid === "function" && <HB_StatusGrid status={data} />}
    </div>
  );
}
