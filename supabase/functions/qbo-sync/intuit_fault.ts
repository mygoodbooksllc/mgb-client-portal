// Safe summary of an Intuit error reply, for logs and last_error.
//
// qbo-sync never logs Intuit response bodies (a QBO payload is customer
// financial data). An error reply is a Fault, not financial data, but its
// Message/Detail text can still echo request values, so only three fixed
// tokens are kept: the Fault type, the numeric error code, and the name of
// the parameter Intuit objected to. Each is whitelisted by shape; anything
// else is dropped. Pure, so tests/edge/qbo_sync_fault.test.mjs can run it.
//
// Example kept summary: "ValidationFault 2020 start_date".

export function faultSummary(bodyText: string | null | undefined): string {
  if (!bodyText) return "";
  let j: any;
  try {
    j = JSON.parse(String(bodyText).slice(0, 20000));
  } catch (_e) {
    return "";
  }
  return faultSummaryOf(j);
}

// Same summary from an already-parsed reply (the Fault-in-200 case below).
export function faultSummaryOf(j: any): string {
  const fault = j?.Fault ?? j?.fault;
  if (!fault || typeof fault !== "object") return "";
  const errs = Array.isArray(fault.Error) ? fault.Error : Array.isArray(fault.error) ? fault.error : [];
  const first = errs[0] || {};
  const parts: string[] = [];
  const type = String(fault.type ?? "");
  if (/^[A-Za-z]{1,40}$/.test(type)) parts.push(type);
  const code = String(first.code ?? "");
  if (/^\d{1,6}$/.test(code)) parts.push(code);
  const element = String(first.element ?? "");
  if (/^[A-Za-z_.]{1,40}$/.test(element)) parts.push(element);
  return parts.join(" ");
}

// A 400 on a report is Intuit refusing the request itself (bad parameter,
// unsupported report for this company, report too large). Retrying the same
// call every 5 minutes cannot succeed, so the caller treats it as "skip this
// report and keep the stored rows". 401 (token) and 5xx/429 (transient) keep
// their existing handling.
//
// A 200 whose body is a Fault (see isFaultBody) is the same refusal sent with
// a success code, so it is treated the same way as a 400.
export function isHopelessReportStatus(status: number): boolean {
  return status === 400 || status === FAULT_IN_200_STATUS;
}

// Intuit sometimes answers a report request it refuses with HTTP 200 and a
// body that is only { Fault, time } (seen 2026-10-31 on TransactionList with
// `columns`). Treating that as data walks an empty report and stores nothing
// as if it were fresh. A reply counts as a Fault only when it has a top-level
// Fault object carrying a non-empty Error array or a string type, and none of
// the payload keys a real answer has (QueryResponse, Report rows, CDC,
// Header). Only the shape is checked here; what is kept for logs is still
// faultSummaryOf's whitelist.
export const FAULT_IN_200_STATUS = 200;

export function isFaultBody(j: any): boolean {
  if (!j || typeof j !== "object" || Array.isArray(j)) return false;
  const fault = j.Fault ?? j.fault;
  if (!fault || typeof fault !== "object" || Array.isArray(fault)) return false;
  const errs = Array.isArray(fault.Error) ? fault.Error : Array.isArray(fault.error) ? fault.error : null;
  const hasErr = !!errs && errs.length > 0;
  const hasType = typeof fault.type === "string" && fault.type.length > 0;
  if (!hasErr && !hasType) return false;
  for (const k of ["QueryResponse", "CDCResponse", "Rows", "Columns", "Header", "BatchItemResponse"]) {
    if (k in j) return false;
  }
  return true;
}
