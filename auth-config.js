// Supabase project connection info for the staff login gate (Phase 1 of the
// auth plan — see HANDOFF6.md's follow-up conversation). Both values are
// PUBLIC by design: the anon key only grants what Supabase Row Level Security
// policies allow, same as a public API key. Do not put a service_role key
// here or anywhere that ships to the browser.
//
// Fill these in after creating the Supabase project (step 1 of the two setup
// steps) and the app will start enforcing the login gate automatically.
window.SUPABASE_CONFIG = {
  url: "https://xumsqmhccgfjnlmieqyu.supabase.co",
  anonKey: "sb_publishable_frBaZegL3vNfI4ey250m1A_ejMq4uxB",
};
