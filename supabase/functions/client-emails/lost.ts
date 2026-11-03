// Lost clients: a client is lost once lost_at (a YYYY-MM-DD date) is today or earlier.
// Lost clients get no automatic emails (doc chaser, monthly value report).
export function isLostClient(lostAt: string | null | undefined, today: string): boolean {
  if (!lostAt) return false;
  return String(lostAt).slice(0, 10) <= today;
}
