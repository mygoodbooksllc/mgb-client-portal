// Bookkeeper sign-off for emails the portal sends to clients.
//
// The text comes from Settings › Email signature (user_settings.settings
// .signature). When the staffer also turned on settings.signature_photo, their
// Profile photo (staff_profiles.photo_path in the private staff-avatars bucket)
// is shown beside it through a long-lived signed URL, so the file itself stays
// private and the picture keeps working in old emails. Callers pass the
// service-role client. Drafts the app opens in the staffer's own mail client
// stay text-only (app.jsx uses ST_signatureForDrafts).
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { esc } from "./email.ts";
import * as L from "./layout.ts";

export type Signoff = { text: string | null; photoUrl: string | null };

const PHOTO_BUCKET = "staff-avatars";
const PHOTO_URL_SECONDS = 60 * 60 * 24 * 365 * 5; // five years
const PHOTO_PX = 56;

/** Sign-offs keyed by lower-cased staff email. Staff without a signature get no entry. */
export async function loadSignoffs(db: SupabaseClient, emails: string[]): Promise<Map<string, Signoff>> {
  const map = new Map<string, Signoff>();
  const list = [...new Set(emails.map((e) => String(e || "").toLowerCase()).filter(Boolean))];
  if (!list.length) return map;
  const { data: rows } = await db.from("user_settings").select("user_email, settings").in("user_email", list);
  const wantPhoto: string[] = [];
  for (const r of rows || []) {
    const email = String(r.user_email).toLowerCase();
    const settings = r.settings || {};
    const text = String(settings.signature || "").trim() || null;
    if (!text) continue;
    map.set(email, { text, photoUrl: null });
    if (settings.signature_photo === true) wantPhoto.push(email);
  }
  if (!wantPhoto.length) return map;
  const { data: profiles } = await db.from("staff_profiles").select("email, photo_path").in("email", wantPhoto);
  for (const pr of profiles || []) {
    const s = map.get(String(pr.email).toLowerCase());
    if (!s || !pr.photo_path) continue;
    try {
      const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrl(pr.photo_path, PHOTO_URL_SECONDS);
      if (data?.signedUrl) s.photoUrl = data.signedUrl;
    } catch (_e) {
      // The photo is a nicety; the signature still goes out as text.
    }
  }
  return map;
}

/** HTML sign-off: the signature (with photo when set), else "Thank you, <name>, MyGoodBooks". */
export function signoffHtml(s: Signoff | null | undefined, name: string | null, size = 15): string {
  if (!s?.text) return L.p(`Thank you,<br>${name ? `${esc(name)}<br>` : ""}${L.tone("MyGoodBooks", "muted")}`, { size });
  const text = esc(s.text).replace(/\n/g, "<br>");
  if (!s.photoUrl) return L.p(text, { size });
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 16px 0;"><tr>` +
    `<td valign="top" style="padding:2px 14px 0 0;"><img src="${esc(s.photoUrl)}" width="${PHOTO_PX}" height="${PHOTO_PX}" alt="" ` +
    `style="display:block;width:${PHOTO_PX}px;height:${PHOTO_PX}px;border-radius:${PHOTO_PX / 2}px;border:0;"></td>` +
    `<td valign="top">${L.p(text, { size, margin: "0" })}</td>` +
    `</tr></table>`
  );
}

/** Plain-text sign-off lines for the text part of the email. */
export function signoffText(s: Signoff | null | undefined, name: string | null): string[] {
  if (s?.text) return [s.text];
  return ["Thank you,", ...(name ? [name] : []), "MyGoodBooks"];
}
