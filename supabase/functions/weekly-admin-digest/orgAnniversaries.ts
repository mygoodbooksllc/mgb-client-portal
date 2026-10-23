// Client anniversaries line for the weekly digest's "Coming up" section
// (docs/client-org-profile-spec.md section 6). The count comes from
// org_anniversaries_digest_count(p_today) in supabase/client-org-profile.sql,
// which returns null while tk_settings.org_profile_enabled is off. Anything
// that is not a positive whole number (null, an error, a string) means no
// line, so the email stays exactly as it was. No email or notification is
// sent by this feature beyond this one line.

export function orgAnniversaryCount(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

export function orgAnniversaryText(n: number | null): string | null {
  if (n === null) return null;
  return `Anniversaries coming up: ${n} ${n === 1 ? "client" : "clients"}`;
}
