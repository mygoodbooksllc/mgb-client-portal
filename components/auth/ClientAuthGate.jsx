// Phase 2 of the auth plan: real client login, gated on a magic-link email
// (clients aren't on a Workspace domain, so no Google OAuth like staff get)
// plus an active row in `client_users` (see supabase/client-auth-phase2.sql).
// Only mounted for a client whose `realAuthEnabled` flag is on in data.js —
// everyone else keeps using the mock "Preview As" flow while this rolls out
// client by client. See app.jsx's ReactDOM.createRoot call.
//
// Usage: <ClientAuthGate>{(clientUser) => <ClientApp clientUser={clientUser} />}</ClientAuthGate>
// `clientUser` is the client_users row: { email, client_id, name, role,
// access, tabs, categories, funds, premium_throttled } — the same shape
// resolveAccess() already expects from client.users mock data, so nothing
// downstream of it needs to change.
(function () {
  const { useEffect, useState } = React;

  function ClientAuthGate({ children }) {
    // "loading" -> "signed-out" -> "link-sent" -> "checking-row" -> "authorized" | "denied"
    const [status, setStatus] = useState("loading");
    const [clientUser, setClientUser] = useState(null);
    const [email, setEmail] = useState("");
    const [errorMsg, setErrorMsg] = useState("");

    const supabase = window.mgbSupabase;

    async function checkClientRow(session) {
      const sessionEmail = session.user.email;
      const { data, error } = await supabase
        .from("client_users")
        .select("email, client_id, name, role, active, access, tabs, categories, funds, premium_throttled")
        .eq("email", sessionEmail)
        .maybeSingle();

      if (error) {
        setErrorMsg("Couldn't verify your access. Try again in a moment.");
        setStatus("denied");
        return;
      }
      if (!data || !data.active) {
        setErrorMsg(`${sessionEmail} isn't set up for portal access yet. Ask your bookkeeper.`);
        setStatus("denied");
        return;
      }
      setClientUser(data);
      setStatus("authorized");
    }

    useEffect(() => {
      if (!supabase) {
        setStatus("not-configured");
        return;
      }
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) checkClientRow(data.session);
        else setStatus("signed-out");
      });
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) checkClientRow(session);
        else {
          setClientUser(null);
          setStatus("signed-out");
        }
      });
      return () => sub.subscription.unsubscribe();
    }, []);

    async function sendLink(e) {
      e.preventDefault();
      setErrorMsg("");
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setStatus("link-sent");
    }

    function signOut() {
      supabase.auth.signOut();
    }

    if (status === "loading" || status === "checking-row") {
      return (
        <div className="boot-splash" role="status" aria-live="polite">
          <div className="boot-splash-mark">MyGoodBooks</div>
          <div className="boot-splash-sub">Checking sign-in…</div>
        </div>
      );
    }

    if (status === "not-configured") {
      return (
        <div className="boot-splash" role="alert">
          <div className="boot-splash-mark">MyGoodBooks</div>
          <div className="boot-splash-sub">Client login isn't configured yet.</div>
        </div>
      );
    }

    if (status === "authorized" && clientUser) {
      return children(clientUser, signOut);
    }

    if (status === "link-sent") {
      return (
        <div className="boot-splash" role="status">
          <div className="boot-splash-mark">MyGoodBooks</div>
          <div className="boot-splash-sub">Check {email} for a sign-in link.</div>
        </div>
      );
    }

    return (
      <div className="boot-splash" role="main">
        <div className="boot-splash-mark">MyGoodBooks</div>
        <div className="boot-splash-sub">Client portal — sign in with your email.</div>
        {errorMsg && (
          <div style={{ color: "#e0664f", maxWidth: 360, textAlign: "center", margin: "12px 0" }}>{errorMsg}</div>
        )}
        <form onSubmit={sendLink} style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <input
            type="email"
            required
            placeholder="you@yourorganization.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #444", font: "inherit" }}
          />
          <button
            type="submit"
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "#c7ae86",
              color: "#1a1a1a",
              font: "inherit",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Send link
          </button>
        </form>
      </div>
    );
  }

  window.ClientAuthGate = ClientAuthGate;
})();
