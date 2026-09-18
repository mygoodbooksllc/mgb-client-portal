// QuickBooks Online app connection info. The Client ID is PUBLIC by design —
// it's the same kind of public identifier as a Google OAuth client ID or the
// Supabase anon key in auth-config.js. The Client Secret must NEVER go here;
// it lives only as the QBO_CLIENT_SECRET secret on the qbo-callback Edge
// Function (supabase/functions/qbo-callback), set via the Supabase dashboard
// or `supabase secrets set`, never committed to this repo.
window.QBO_CONFIG = {
  clientId: "ABeEF4Y1WOpywIPkQiJPj9GN6sVhaSxYYuMGMLaMccGBImAfJ9",
  environment: "production", // "sandbox" | "production" — must match the Edge Function's QBO_ENV secret
};
