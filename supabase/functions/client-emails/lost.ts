// Lost clients: a client is lost once lost_at (a YYYY-MM-DD date) is today or earlier.
// Lost clients get no automatic emails (doc chaser, monthly value report).
export function isLostClient(lostAt: string | null | undefined, today: string): boolean {
  if (!lostAt) return false;
  return String(lostAt).slice(0, 10) <= today;
}

// Today's date in Chicago (America/Chicago), the same clock the database uses for
// lost_at (tk_close_lost_client_tasks, tk__generate). Used for lost checks only;
// the rest of client-emails keeps its own timezone.
export function chicagoToday(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
