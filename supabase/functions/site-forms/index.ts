import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { emailConfigured, sendEmail } from "../_shared/email.ts";
import { DEFAULT_SALT, handle, type Store } from "./logic.ts";

// Public intake for forms on the marketing site (mygoodbooks.org). The site's
// js/forms.js posts {form, page, fields} as JSON; schema and policies in
// supabase/site-forms.sql, owner notes in docs/site-forms.md.
//
// PUBLIC: deploy with --no-verify-jwt. Anonymous visitors call it, so these
// checks are the gate (all in logic.ts handle()):
//   OPTIONS preflight; POST only (405); a browser Origin must be one of
//   ALLOWED_ORIGINS (403; CORS echoes only those); JSON only (415); body
//   <= 10 KB (413); form in FORMS, fields an object of <= 20 string values
//   (each cut to 2000 chars), a plausible name and a valid email (400); a
//   filled "website" honeypot gets 200 and nothing is stored; 5 per hour and
//   20 per day per hashed IP, counted from the table itself (429).
// Then the row is inserted with the service role (500 if that fails) and the
// notification goes to every active site_form_recipients address (fallback
// holden@mygoodbooks.org), reply-to the visitor. Once the row is saved the
// answer is always 200 {ok:true}; a failed or unconfigured email is kept in
// email_error. Errors never carry internal detail, and logs carry no
// addresses or field values.
//
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (built in), RESEND_API_KEY
// and DIGEST_FROM (../_shared/email.ts), SITE_FORMS_SALT (optional; the IP
// hash salt, falls back to a fixed string).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SALT = Deno.env.get("SITE_FORMS_SALT") || DEFAULT_SALT;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const store: Store = {
  async recentTimes(ipHash, sinceIso) {
    const { data, error } = await admin
      .from("site_form_submissions")
      .select("created_at")
      .eq("ip_hash", ipHash)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data || []).map((r) => r.created_at as string);
  },
  async insert(row) {
    const { data, error } = await admin.from("site_form_submissions").insert(row).select("id, created_at").single();
    if (error || !data) throw new Error(error?.message || "no row");
    return { id: data.id as string, created_at: data.created_at as string };
  },
  async recipients() {
    const { data, error } = await admin.from("site_form_recipients").select("email").eq("active", true);
    if (error) throw new Error(error.message);
    return (data || []).map((r) => String(r.email || ""));
  },
  async markEmail(id, sent, err) {
    const { error } = await admin.from("site_form_submissions").update({ email_sent: sent, email_error: err }).eq("id", id);
    if (error) throw new Error(error.message);
  },
};

Deno.serve((req) => handle(req, { store, sendEmail, emailConfigured, salt: SALT }));
