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
        setErrorMsg("Couldn't verify staff access. Try again in a moment.");
        setStatus("denied");
        return;
      }
      if (!data || !data.active) {
        setErrorMsg(
          `${email} signed in with Google but isn't on the MyGoodBooks staff list.`
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

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) checkStaffRow(session);
        else {
          setStaffUser(null);
          setStatus("signed-out");
        }
      });
      return () => sub.subscription.unsubscribe();
    }, []);

    function signIn() {
      setErrorMsg("");
      supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // Nudges Google's account chooser toward the Workspace domain.
          // Real enforcement is server-side: the OAuth client is set to
          // "Internal" for mygoodbooks.org, so anyone outside the domain
          // gets rejected by Google before ever reaching this app — this
          // `staff` table check is the second, narrower gate on top of that.
          hd: "mygoodbooks.org",
        },
      });
    }

    function signOut() {
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
      <div className="boot-splash" role="main">
        <div className="boot-splash-mark">MyGoodBooks</div>
        <div className="boot-splash-sub">Staff portal — sign in with your MyGoodBooks Google account.</div>
        {errorMsg && (
          <div style={{ color: "#e0664f", maxWidth: 360, textAlign: "center", margin: "12px 0" }}>
            {errorMsg}
          </div>
        )}
        <button
          onClick={signIn}
          style={{
            marginTop: 16,
            padding: "10px 20px",
            borderRadius: 8,
            border: "none",
            background: "#4285F4",
            color: "#fff",
            font: "inherit",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  window.AuthGate = AuthGate;
})();
