// Phase 1 of the auth plan: a login screen in front of the whole app for
// staff (bookkeepers), gated on Google Workspace SSO + the `staff` table.
// Client-side auth (Phase 2, magic links) and replacing data.js with real
// Supabase tables (Phase 3) come later — this only closes the "the whole
// dashboard is a public URL with no login" hole.
//
// Usage (see app.jsx's ReactDOM.createRoot call):
//   <AuthGate>{(staffUser) => <App staffUser={staffUser} />}</AuthGate>
// `children` is a render-prop function so the rest of the app only mounts
// once a real, authorized staff session exists. `staffUser` is
// { email, name, role } from the `staff` table — this is what replaces the
// generic BOOKKEEPER_VIEW label with a real signed-in person.
(function () {
  const { useEffect, useState } = React;

  // Shared with ClientAuthGate's "Staff? Sign in with Google" button, so the
  // client-facing front door can start the staff flow directly. Returning to
  // "/" is fine: app.jsx's RootGate sends a @mygoodbooks.org session to this
  // gate, and this gate still checks the staff table either way.
  function startStaffGoogleSignIn() {
    window.mgbSupabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Nudges Google's account chooser toward the Workspace domain.
        // Real enforcement is server-side: the OAuth client is set to
        // "Internal" for mygoodbooks.org, so anyone outside the domain
        // gets rejected by Google before ever reaching this app — this
        // `staff` table check is the second, narrower gate on top of that.
        hd: "mygoodbooks.org",
        // Return to whichever host started sign-in (prod, a Vercel
        // preview, or localhost). Supabase only honors hosts on its
        // Redirect URLs allow-list and falls back to the Site URL otherwise.
        redirectTo: window.location.origin,
      },
    });
  }
  window.mgbStartStaffGoogleSignIn = startStaffGoogleSignIn;

  function AuthGate({ children }) {
    // "loading" -> "signed-out" -> "checking-staff" -> "authorized" | "denied"
    const [status, setStatus] = useState("loading");
    const [staffUser, setStaffUser] = useState(null);
    const [errorMsg, setErrorMsg] = useState("");

    const supabase = window.mgbSupabase;

    async function checkStaffRow(session) {
      const email = session.user.email;
      const { data, error } = await supabase
        .from("staff")
        .select("email, name, role, active")
        .eq("email", email)
        .maybeSingle();

      if (error) {
        // Security audit finding: a rejected session used to stay in
        // localStorage. Supabase persists it and refreshes it in the
        // background, so someone who signed in with Google whose address isn't on
        // the staff list kept a live, refreshing Supabase session on that
        // device — and that session, not this React gate, is the identity
        // every RLS policy is evaluated against. Fire and forget: the denied
        // screen renders now, the token is torn down behind it. Signing out
        // flips status to "signed-out" via onAuthStateChange, but errorMsg
        // survives, so the explanation below stays on screen.
        supabase.auth.signOut();
        setErrorMsg("Couldn't verify staff access. Try again in a moment.");
        setStatus("denied");
        return;
      }
      if (!data || !data.active) {
        supabase.auth.signOut();
        setErrorMsg(
          `${email} signed in with Google but isn't on the MyGoodBooks staff list.`,
        );
        setStatus("denied");
        return;
      }
      setStaffUser({ email: data.email, name: data.name, role: data.role });
      setStatus("authorized");
    }

    useEffect(() => {
      if (!supabase) {
        setStatus("not-configured");
        return;
      }

      supabase.auth.getSession().then(({ data }) => {
        if (data.session) checkStaffRow(data.session);
        else setStatus("signed-out");
      });

      const { data: sub } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (session) checkStaffRow(session);
          else {
            setStaffUser(null);
            setStatus("signed-out");
          }
        },
      );
      return () => sub.subscription.unsubscribe();
    }, []);

    function signIn() {
      setErrorMsg("");
      startStaffGoogleSignIn();
    }

    function signOut() {
      // So signing back in within the same tab lands on Home again too —
      // otherwise app.jsx's initialPage() would see the flag still set from
      // before and treat the new sign-in as a mid-session refresh instead.
      try {
        sessionStorage.removeItem("mygoodbooks_session_started_v1");
      } catch (e) {}
      supabase.auth.signOut();
    }

    if (status === "loading" || status === "checking-staff") {
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
            Staff login isn't configured yet — fill in auth-config.js with the
            Supabase project URL and anon key.
          </div>
        </div>
      );
    }

    if (status === "authorized" && staffUser) {
      return children(staffUser, signOut);
    }

    return (
      <main className="auth-screen">
        <div className="auth-stack">
          <div className="auth-logo">
            <img className="auth-logo-img" src="/logo.webp" alt="" width="192" height="192" />
            <span className="auth-wordmark">MyGoodBooks</span>
          </div>
          <div className="auth-card">
            <div className="auth-head">
              <h1 className="auth-title">Staff portal</h1>
              <p className="auth-sub">
                Sign in with your MyGoodBooks Google account.
              </p>
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
                Sign out and try a different account
              </button>
            )}
            <button
              type="button"
              className="auth-btn auth-btn-primary"
              onClick={signIn}
            >
              Sign in with Google
            </button>
          </div>
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

  window.AuthGate = AuthGate;
})();
