// "Review final" email: sent once to the team member and once to the reviewer
// when a review is signed by both and locked (kind 'review_final', queued by
// exportReview). It shows the official scores (the reviewer's ratings: each
// area is the average of its two items out of 5, Overall is out of 30), the
// change from the most recent earlier locked review, and the agreed action
// steps. The numbers come from tr_final_compare (team-reviews-5-final-compare.sql),
// read at send time.
//
// Never in this email: comments, notes, coaching, disagree text, self ratings.
// Pure (no Deno, no network): node-tested in tests/edge/review_final.test.mjs.
import { esc } from "../_shared/email.ts";
import * as L from "../_shared/layout.ts";

export type QuarterScores = {
  label: string; year: number; quarter: number;
  camaraderie: number; ownership: number; healthy_hustle: number; total: number;
  consecutive?: boolean;
};
export type FinalCompare = {
  review_id?: string; staff_id?: string; reviewer_id?: string; staff_name?: string;
  current: QuarterScores;
  prior: QuarterScores | null;
  changes: Record<string, { change: number; direction: string }> | null;
  steps: { section: string | null; description: string; owner: string; due_date: string | null }[];
  steps_total?: number;
};
export type FinalEmailOpts = {
  isReviewer: boolean;
  staffName: string;
  reviewerName?: string;
  reviewLink: string;
  adminWithFile?: boolean;
  fmtDate: (d: string | null | undefined) => string;
};

export const FINAL_ROWS: { key: "camaraderie" | "ownership" | "healthy_hustle" | "total"; title: string }[] = [
  { key: "camaraderie", title: "Camaraderie" },
  { key: "ownership", title: "Ownership" },
  { key: "healthy_hustle", title: "Healthy Hustle" },
  { key: "total", title: "Overall (/30)" },
];
const STEP_CLIP = 300;
const clip = (s: unknown, n: number) => {
  const t = String(s ?? "").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

/** Category scores show one decimal (4.0, 4.5); the total is a whole number. */
export function fmtScore(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "" || !isFinite(Number(v))) return "–";
  return key === "total" ? String(Math.round(Number(v))) : Number(v).toFixed(1);
}

/** "Up 0.5", "Down 1", "No change": the words carry the meaning, not the color. */
export function changeText(change: unknown, direction?: string): string {
  if (change === null || change === undefined || change === "") return "–";
  const n = Number(change);
  if (!isFinite(n)) return "–";
  const dir = direction || (n > 0 ? "up" : n < 0 ? "down" : "flat");
  const amt = String(Number(Math.abs(n).toFixed(1)));
  if (dir === "up" && n !== 0) return `Up ${amt}`;
  if (dir === "down" && n !== 0) return `Down ${amt}`;
  return "No change";
}

/** Rows shared by the HTML table and the plain-text table. */
export function finalRows(cmp: FinalCompare): { title: string; now: string; before: string | null; change: string; direction: string }[] {
  return FINAL_ROWS.map((r) => {
    const ch = cmp.changes?.[r.key];
    const n = Number(ch?.change);
    const direction = ch?.direction || (!cmp.prior ? "" : n > 0 ? "up" : n < 0 ? "down" : "flat");
    return {
      title: r.title,
      now: fmtScore(r.key, (cmp.current as any)[r.key]),
      before: cmp.prior ? fmtScore(r.key, (cmp.prior as any)[r.key]) : null,
      change: cmp.prior ? changeText(ch?.change, ch?.direction) : "",
      direction,
    };
  });
}

/** Columns padded to line up in a plain-text email. */
export function textTable(head: string[], rows: string[][]): string[] {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] || "").length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(w[i]))).join("   ").trimEnd();
  return [line(head), line(w.map((n) => "-".repeat(n))), ...rows.map(line)];
}

export function noPriorSentence(isReviewer: boolean, staffName: string): string {
  return isReviewer
    ? `This is ${staffName}'s first locked review, so there is no earlier quarter to compare with yet.`
    : "This is your first locked review, so there is no earlier quarter to compare with yet.";
}

export function gapSentence(cmp: FinalCompare): string {
  return cmp.prior && !cmp.prior.consecutive
    ? `Compared with ${cmp.prior.label}, the most recent earlier locked review.`
    : "";
}

export function finalEmail(
  cmp: FinalCompare | null | undefined,
  o: FinalEmailOpts,
): { subject: string; lines: string[]; cta: string; href: string; html: string; textLines: string[] } | null {
  if (!cmp || !cmp.current) return null;
  const cur = cmp.current;
  const prior = cmp.prior || null;
  const who = o.staffName || cmp.staff_name || "the team member";
  const rows = finalRows(cmp);

  const subject = o.isReviewer
    ? `${who}'s ${cur.label} review final: scores${prior ? " and quarter-over-quarter change" : ""}`
    : `${cur.label} review final: scores${prior ? " and quarter-over-quarter change" : ""}`;
  const intro = o.isReviewer
    ? `${who}'s ${cur.label} review is signed by both of you and locked. Here are their final scores${prior ? " and how they changed" : ""}.`
    : `Your ${cur.label} review is signed by both of you and locked. Here are your final scores${prior ? " and how they changed" : ""}.`;
  const basis = "Scores are the reviewer's ratings. Each area is the average of its two items, out of 5; Overall is all six items, out of 30.";
  const pdf = o.isReviewer
    ? (o.adminWithFile ? "The signed PDF is saved in the Staff Reviews Shared Drive." : "The signed PDF will be saved to Drive; you can download it from the portal any time.")
    : "You can download the signed PDF from Reviews in the portal any time.";

  // Table: with a prior, four columns; without one, this quarter only plus a sentence.
  const lastHead = prior ? (prior.consecutive ? `Last quarter (${prior.label})` : `Earlier review (${prior.label})`) : "";
  const head = prior ? ["Category", `This quarter (${cur.label})`, lastHead, "Change"] : ["Category", `This quarter (${cur.label})`];
  const toneFor = (d: string) => (d === "up" ? "good" : d === "down" ? "bad" : "muted") as "good" | "bad" | "muted";
  const htmlRows = rows.map((r) => {
    const title = r.title === "Overall (/30)" ? `<strong>${esc(r.title)}</strong>` : esc(r.title);
    return prior ? [title, esc(r.now), esc(r.before), L.tone(esc(r.change), toneFor(r.direction))] : [title, esc(r.now)];
  });
  const textRows = rows.map((r) => (prior ? [r.title, r.now, r.before || "", r.change] : [r.title, r.now]));

  // Agreed action steps (already capped at 10 by the RPC; clipped again here).
  const steps = (cmp.steps || []).slice(0, 10);
  const owner = (s: { owner: string }) =>
    s.owner === "reviewer"
      ? (o.isReviewer ? "You" : (o.reviewerName || "Your reviewer"))
      : (o.isReviewer ? who : "You");
  const stepText = steps.map((s) => {
    const due = s.due_date ? `, due ${o.fmtDate(s.due_date)}` : "";
    return { desc: clip(s.description, STEP_CLIP), meta: `Owner: ${owner(s)}${due}` };
  });
  const more = Math.max(0, (cmp.steps_total ?? steps.length) - steps.length);
  const moreLine = more ? `And ${more} more in the portal.` : "";

  const gap = gapSentence(cmp);
  const html = [
    gap ? L.p(esc(gap), { tone: "muted", size: 14 }) : "",
    L.dataTable(head, htmlRows, prior ? [1, 2, 3] : [1]),
    L.p(esc(basis), { tone: "muted", size: 13, margin: "0 0 16px 0" }),
    prior ? "" : L.p(esc(noPriorSentence(o.isReviewer, who))),
    stepText.length
      ? L.label("Agreed action steps") +
        L.bullets(stepText.map((s) => `${esc(s.desc)}<br>${L.tone(esc(s.meta), "muted")}`)) +
        (moreLine ? L.p(esc(moreLine), { tone: "muted", size: 14 }) : "")
      : "",
    L.p(esc(pdf)),
  ].join("");

  const textLines = [
    "",
    ...(gap ? [gap, ""] : []),
    ...textTable(head, textRows),
    "",
    basis,
    ...(prior ? [] : ["", noPriorSentence(o.isReviewer, who)]),
    ...(stepText.length ? ["", "Agreed action steps:", ...stepText.map((s) => `- ${s.desc} (${s.meta})`), ...(moreLine ? [moreLine] : [])] : []),
    "",
    pdf,
  ];

  return { subject, lines: [intro], cta: "Open the review", href: o.reviewLink, html, textLines };
}
