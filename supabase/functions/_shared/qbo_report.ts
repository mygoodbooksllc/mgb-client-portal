// ----------------------------------------------------------------------------
// Pure QuickBooks report helpers (no Deno, no network), lifted from
// qbo-sync/index.ts (num, reportColumn, walkDataRows) so they can be shared
// and unit-tested with plain node (tests/edge/*.test.mjs, Node's built-in
// TypeScript type stripping: erasable syntax only, `.ts` import extensions).
// _shared/qbo.ts re-exports them; qbo-sync still has its own copies until it
// is migrated (spec 3.2, "phase 1 copies, not rewrites").
// ----------------------------------------------------------------------------

// "1,234.50" -> 1234.5, "(1,234.50)" -> -1234.5, blank / junk -> 0.
export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let t = String(v ?? "").trim();
  const paren = /^\(.*\)$/.test(t);
  if (paren) t = t.slice(1, -1);
  const n = parseFloat(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  return paren ? -Math.abs(n) : n;
}

// Column index by MetaData ColKey (stable), falling back to a title match.
// Never by position. -1 when the report has no such column.
export function reportColumn(report: any, key: string, ...titles: string[]): number {
  const cols = report?.Columns?.Column || [];
  for (let i = 0; i < cols.length; i++) {
    for (const m of cols[i]?.MetaData || []) {
      if (m?.Name === "ColKey" && m?.Value === key) return i;
    }
  }
  for (let i = 0; i < cols.length; i++) {
    const t = String(cols[i]?.ColTitle || "").trim().toLowerCase();
    if (titles.includes(t)) return i;
  }
  return -1;
}

// Calls fn(ColData, sectionHeaderCell) for every Data row, depth first. The
// section header cell is the innermost Section's Header.ColData[0] (for the
// GeneralLedger: the account, with its `id`).
export function walkDataRows(rows: any[], fn: (cd: any[], section: any | null) => void, section: any = null): void {
  for (const row of rows || []) {
    if (row?.Rows?.Row) {
      walkDataRows(row.Rows.Row, fn, row?.Header?.ColData?.[0] ? row.Header.ColData[0] : section);
      continue;
    }
    if (row?.ColData?.length) fn(row.ColData, section);
  }
}
