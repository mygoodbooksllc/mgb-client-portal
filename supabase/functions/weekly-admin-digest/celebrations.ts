// Birthdays and work anniversaries for the weekly digest's "Coming up"
// section, a month (30 days) ahead so admins have time to send a gift (owner
// request 2026-10-27). Rows come from staff_celebrations(); an occurrence
// already marked "gift sent" or dismissed on Today is left out.
//
// Same rules as components/staff/celebrationLead.js (the browser copy; keep
// the two in step). Month and day only: never a birth year or an age.
// "N years on the team" is time since the start date.

export const LEAD_DAYS = 30;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parse(iso: unknown): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

export function daysBetween(toIso: string, fromIso: string): number {
  const a = parse(toIso);
  const b = parse(fromIso);
  if (!a || !b) return NaN;
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
}

export function dateLabel(iso: string): string {
  const p = parse(iso);
  return p && p.m >= 1 && p.m <= 12 ? `${MONTHS[p.m - 1]} ${p.d}` : "";
}

export function awayText(days: number): string {
  return days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

export function tenureYears(startIso: unknown, onIso: string): number | null {
  const s = parse(startIso);
  const o = parse(onIso);
  if (!s || !o) return null;
  const n = o.y - s.y - (o.m < s.m || (o.m === s.m && o.d < s.d) ? 1 : 0);
  return n >= 1 ? n : null;
}

export type CelebrationItem = { days: number; when: string; who: string; what: string };

export function celebrationItems(rows: any[], today: string, leadDays = LEAD_DAYS): CelebrationItem[] {
  const items: CelebrationItem[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const who = r.name || r.email || "";
    const add = (iso: string | null, action: string | null, what: string) => {
      if (!iso || action) return;
      const days = daysBetween(iso, today);
      if (!(days >= 0 && days <= leadDays)) return;
      items.push({ days, when: `${dateLabel(iso)} (${awayText(days)})`, who, what });
    };
    const t = tenureYears(r.start_date, r.next_birthday);
    add(r.next_birthday, r.birthday_action, t ? `birthday · ${t} year${t === 1 ? "" : "s"} on the team` : "birthday");
    add(r.next_anniversary, r.anniversary_action, `${r.years} year${r.years === 1 ? "" : "s"} with the firm`);
  }
  items.sort((a, b) => a.days - b.days || a.who.localeCompare(b.who));
  return items;
}
