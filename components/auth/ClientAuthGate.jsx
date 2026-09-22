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
      // §171: the column is premium_throttled, but resolveAccess() (and the
      // mock client.users shape it was written against) reads
      // `premiumThrottled`. Until this was normalized here, a real client
      // row whose premium throttle was set still got the full Pro
      // experience — the only field of the row whose snake_case name didn't
      // happen to match. Both spellings are kept so nothing reading the raw
      // row breaks.
      setClientUser({ ...data, premiumThrottled: data.premium_throttled });
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

    // Shared frame for the signed-out and link-sent views: logo, card,
    // footer. Styles live in styles.css (.auth-*) so dark tokens apply.
    function frame(card) {
      return (
        <main className="auth-screen">
          <div className="auth-stack">
            <div className="auth-logo">
              <img className="auth-logo-img" src="/logo.webp" alt="MyGoodBooks" width="96" height="96" />
            </div>
            {card}
            <nav className="auth-footer" aria-label="Legal and support">
              <a href="/privacy" target="_blank" rel="noopener noreferrer">
                Privacy
              </a>
              <span aria-hidden="true">·</span>
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                Terms
              </a>
              <span aria-hidden="true">·</span>
              <a href="mailto:holden@mygoodbooks.org?subject=MyGoodBooks%20Support">
                Contact
              </a>
            </nav>
          </div>
        </main>
      );
    }

    if (status === "link-sent") {
      return frame(
        <div className="auth-card" role="status">
          <div className="auth-head">
            <h1 className="auth-title">Client portal</h1>
            <p className="auth-sub">Check {email} for a sign-in link.</p>
          </div>
        </div>,
      );
    }

    return frame(
      <div className="auth-card">
        <div className="auth-head">
          <h1 className="auth-title">Client portal</h1>
          <p className="auth-sub">Sign in with your email.</p>
        </div>
        {errorMsg && (
          <p className="auth-error" role="alert">
            {errorMsg}
          </p>
        )}
        {errorMsg && (
          <button
            type="button"
            className="auth-btn auth-btn-secondary"
            onClick={signOut}
          >
            Sign out and use a different address
          </button>
        )}
        <form className="auth-form" onSubmit={sendLink}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="client-login-email">
              Email address
            </label>
            <input
              id="client-login-email"
              className="auth-input"
              type="email"
              required
              autoComplete="email"
              placeholder="you@yourorganization.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="auth-btn auth-btn-primary">
            Email me a sign-in link
          </button>
        </form>
        <div className="auth-divider">or</div>
        {/* Not a new auth path: "/" is where the staff AuthGate already
            lives (app.jsx routes only /login here), and its own Google
            button runs the domain-restricted OAuth flow. */}
        <a className="auth-btn auth-btn-secondary" href="/">
          <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
            />
          </svg>
          Staff? Sign in with Google
        </a>
      </div>,
    );
  }

  window.ClientAuthGate = ClientAuthGate;
})();
