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
        .select(
          "email, client_id, name, role, active, access, tabs, categories, funds, premium_throttled",
        )
        .eq("email", sessionEmail)
        .maybeSingle();

      if (error) {
        // Security audit finding: a rejected session used to stay in
        // localStorage. Supabase persists it and refreshes it in the
        // background, so someone who followed a sign-in link whose address isn't on
        // the client_users list kept a live, refreshing Supabase session on that
        // device — and that session, not this React gate, is the identity
        // every RLS policy is evaluated against. Fire and forget: the denied
        // screen renders now, the token is torn down behind it. Signing out
        // flips status to "signed-out" via onAuthStateChange, but errorMsg
        // survives, so the explanation below stays on screen.
        supabase.auth.signOut();
        setErrorMsg("Couldn't verify your access. Try again in a moment.");
        setStatus("denied");
        return;
      }
      if (!data || !data.active) {
        supabase.auth.signOut();
        setErrorMsg(
          `${sessionEmail} isn't set up for portal access yet. Ask your bookkeeper.`,
        );
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
      const { data: sub } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (session) checkClientRow(session);
          else {
            setClientUser(null);
            setStatus("signed-out");
          }
        },
      );
      return () => sub.subscription.unsubscribe();
    }, []);

    async function sendLink(e) {
      e.preventDefault();
      setErrorMsg("");
      // Without emailRedirectTo, Supabase sends the confirmed session back to
      // the bare site URL, dropping ?client-login=1 — which then falls
      // through to the staff AuthGate instead of back here. Security audit
      // finding H4 (M6 sub-point): pin this to origin + /login instead of
      // the full current URL (which could carry an attacker-influenced
      // querystring/hash) and pass shouldCreateUser: false so this magic-link
      // form can't silently create a new auth.users row (and send a branded
      // email) for an arbitrary address — only emails already provisioned in
      // client_users can sign in this way.
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin + "/login",
          shouldCreateUser: false,
        },
      });
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
          <div className="boot-splash-sub">
            Client login isn't configured yet.
          </div>
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
          <div className="boot-splash-sub">
            Check {email} for a sign-in link.
          </div>
        </div>
      );
    }

    return (
      <div className="boot-splash" role="main">
        <div className="boot-splash-mark">MyGoodBooks</div>
        <div className="boot-splash-sub">
          Client portal — sign in with your email.
        </div>
        {errorMsg && (
          <div
            style={{
              color: "#e0664f",
              maxWidth: 360,
              textAlign: "center",
              margin: "12px 0",
            }}
          >
            {errorMsg}
          </div>
        )}
        {errorMsg && (
          <button
            onClick={signOut}
            style={{
              marginTop: 4,
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #555",
              background: "transparent",
              color: "inherit",
              font: "inherit",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Sign out and use a different address
          </button>
        )}
        <form
          onSubmit={sendLink}
          style={{ marginTop: 16, display: "flex", gap: 8 }}
        >
          <input
            type="email"
            required
            placeholder="you@yourorganization.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #444",
              font: "inherit",
            }}
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
        <div style={{ marginTop: 24, fontSize: 13, color: "#888" }}>
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit" }}
          >
            Privacy Policy
          </a>
          {" · "}
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit" }}
          >
            Terms of Service
          </a>
          {" · "}
          <a
            href="mailto:holden@mygoodbooks.org?subject=MyGoodBooks%20Support"
            style={{ color: "inherit" }}
          >
            Contact support
          </a>
        </div>
      </div>
    );
  }

  window.ClientAuthGate = ClientAuthGate;
})();
