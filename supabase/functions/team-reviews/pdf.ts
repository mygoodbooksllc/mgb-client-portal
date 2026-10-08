// Team Reviews PDFs (signed quarterly review, confirmed year-end summary).
// Pure: takes the pdf-lib module as `lib` so it can be unit-tested in node
// (index.ts passes npm:pdf-lib). Uses the standard Helvetica fonts, so every
// string goes through winAnsi() first.

export const SECTIONS = [
  { key: "camaraderie", title: "Camaraderie", comment: "comment_camaraderie" },
  { key: "ownership", title: "Ownership", comment: "comment_ownership" },
  { key: "healthy_hustle", title: "Healthy Hustle", comment: "comment_healthy_hustle" },
];
export const ITEMS = [
  { key: "cam_behavior", section: "camaraderie", kind: "Behavior", title: "Support, encourage, and challenge our team" },
  { key: "cam_success", section: "camaraderie", kind: "Success", title: "Invest expertise and personal care in our clients" },
  { key: "own_behavior", section: "ownership", kind: "Behavior", title: "We own our tools, deadlines, and clients" },
  { key: "own_success", section: "ownership", kind: "Success", title: "Maintaining and encouraging efficiency with our clients, team, and self" },
  { key: "hh_behavior", section: "healthy_hustle", kind: "Behavior", title: "Disciplined work-life balance" },
  { key: "hh_success", section: "healthy_hustle", kind: "Success", title: "Managing our “allowable hours per client” well" },
];
export const SCALE = [
  "1 Not meeting expectations",
  "2 Partly meeting",
  "3 Meeting",
  "4 Often exceeding",
  "5 Consistently exceeding",
];
const TZ = "America/Chicago";

// Characters the WinAnsi (cp1252) standard fonts can draw.
const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function winAnsi(s: unknown): string {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[→⟶]/g, "->")
    .replace(/←/g, "<-")
    .replace(/↑/g, "^")
    .replace(/↓/g, "v")
    .replace(/[−]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[^\n]/gu, (ch) => {
      const c = ch.codePointAt(0)!;
      if (c >= 0x20 && c <= 0x7e) return ch;
      if (c >= 0xa0 && c <= 0xff) return ch;
      if (CP1252_EXTRA.includes(ch)) return ch;
      return "?";
    });
}

export function total(s: any): number | null {
  if (!s) return null;
  let t = 0;
  for (const it of ITEMS) {
    const v = s[it.key];
    if (typeof v !== "number") return null;
    t += v;
  }
  return t;
}

export function compareResult(a: number, b: number): string {
  if (a < 3 || b < 3) return "Action step required";
  const gap = Math.abs(a - b);
  if (gap >= 2) return `Discuss - ${gap}-pt gap`;
  return "Aligned";
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }) + " CT";
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? new Date(`${iso}T12:00:00Z`) : new Date(String(iso));
  return d.toLocaleDateString("en-US", { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? "UTC" : TZ, month: "short", day: "numeric", year: "numeric" });
}

const first = (n: unknown) => String(n || "").trim().split(/\s+/)[0] || "";

// ---------------------------------------------------------------------------
// Tiny flowing-text writer on top of pdf-lib.
// ---------------------------------------------------------------------------
class Writer {
  lib: any; pdf: any; reg: any; bold: any; page: any; y = 0;
  W = 612; H = 792; M = 54;
  ink: any; muted: any; line: any;
  constructor(lib: any, pdf: any, reg: any, bold: any) {
    this.lib = lib; this.pdf = pdf; this.reg = reg; this.bold = bold;
    this.ink = lib.rgb(0.1, 0.12, 0.16);
    this.muted = lib.rgb(0.42, 0.44, 0.48);
    this.line = lib.rgb(0.85, 0.85, 0.85);
    this.newPage();
  }
  newPage() {
    this.page = this.pdf.addPage([this.W, this.H]);
    this.y = this.H - this.M;
  }
  ensure(h: number) {
    if (this.y - h < this.M + 24) this.newPage();
  }
  wrap(text: string, font: any, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of winAnsi(text).split("\n")) {
      if (!para.trim()) { out.push(""); continue; }
      let cur = "";
      for (const word of para.split(/ +/)) {
        const tryLine = cur ? cur + " " + word : word;
        if (font.widthOfTextAtSize(tryLine, size) <= width) { cur = tryLine; continue; }
        if (cur) out.push(cur);
        // break very long words
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let k = w.length - 1;
          while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
          out.push(w.slice(0, k));
          w = w.slice(k);
        }
        cur = w;
      }
      out.push(cur);
    }
    return out;
  }
  text(s: string, o: { size?: number; bold?: boolean; muted?: boolean; indent?: number; after?: number; width?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.bold : this.reg;
    const x = this.M + (o.indent ?? 0);
    const width = o.width ?? this.W - this.M - x;
    const lh = size * 1.35;
    for (const ln of this.wrap(s, font, size, width)) {
      this.ensure(lh);
      if (ln) this.page.drawText(ln, { x, y: this.y - size, size, font, color: o.muted ? this.muted : this.ink });
      this.y -= lh;
    }
    this.y -= o.after ?? 4;
  }
  heading(s: string) {
    this.ensure(40);
    this.y -= 8;
    this.text(s, { size: 13, bold: true, after: 2 });
    this.rule();
  }
  rule() {
    this.page.drawLine({ start: { x: this.M, y: this.y }, end: { x: this.W - this.M, y: this.y }, thickness: 0.6, color: this.line });
    this.y -= 8;
  }
  labeled(label: string, value: string | null | undefined) {
    if (!value || !String(value).trim()) return;
    this.text(label, { size: 9, bold: true, muted: true, after: 1 });
    this.text(String(value), { size: 10, after: 8 });
  }
  footer(left: string) {
    const pages = this.pdf.getPages();
    pages.forEach((pg: any, i: number) => {
      const size = 8;
      pg.drawText(winAnsi(left), { x: this.M, y: 30, size, font: this.reg, color: this.muted });
      const r = `Page ${i + 1} of ${pages.length}`;
      pg.drawText(r, { x: this.W - this.M - this.reg.widthOfTextAtSize(r, size), y: 30, size, font: this.reg, color: this.muted });
    });
  }
}

async function start(lib: any, title: string) {
  const pdf = await lib.PDFDocument.create();
  pdf.setTitle(winAnsi(title));
  pdf.setAuthor("MyGoodBooks");
  pdf.setCreator("MyGoodBooks Client Portal");
  const reg = await pdf.embedFont(lib.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(lib.StandardFonts.HelveticaBold);
  return new Writer(lib, pdf, reg, bold);
}

// ---------------------------------------------------------------------------
// Signed quarterly review (doc = public.tr_review_doc)
// ---------------------------------------------------------------------------
export async function buildReviewPdf(lib: any, doc: any): Promise<Uint8Array> {
  const staff = doc.staff?.name || "Team member";
  const rev = doc.reviewer?.name || "Reviewer";
  const rFirst = first(rev);
  const label = doc.cycle?.label || "";
  const w = await start(lib, `${staff} - ${label} Review`);
  const self = doc.self || {};
  const mgr = doc.manager || {};

  w.text("MyGoodBooks", { size: 9, bold: true, muted: true, after: 2 });
  w.text(`${label} Quarterly Review`, { size: 18, bold: true, after: 2 });
  w.text(staff, { size: 12, after: 6 });
  w.text(
    [
      `Reviewer: ${rev}`,
      doc.cycle?.due_at ? `Due: ${fmtDate(doc.cycle.due_at)}` : "",
      self.submitted_at ? `Self-review submitted: ${fmtDate(self.submitted_at)}` : "",
      mgr.submitted_at ? `Reviewer submitted: ${fmtDate(mgr.submitted_at)}` : "",
      doc.locked_at ? `Signed and locked: ${fmtDateTime(doc.locked_at)}` : "",
    ].filter(Boolean).join("   |   "),
    { size: 9, muted: true, after: 6 },
  );
  w.text("Rating scale: " + SCALE.join("  |  "), { size: 8.5, muted: true, after: 4 });

  // Scores
  w.heading("Scores");
  const cols = { item: w.M, self: w.M + 290, mgr: w.M + 332, gap: w.M + 378, res: w.M + 410 };
  const head = (y: number) => {
    const o = { size: 8.5, font: w.bold, color: w.muted };
    w.page.drawText("ITEM", { x: cols.item, y, ...o });
    w.page.drawText("SELF", { x: cols.self, y, ...o });
    w.page.drawText(winAnsi(rFirst.toUpperCase()).slice(0, 8), { x: cols.mgr, y, ...o });
    w.page.drawText("GAP", { x: cols.gap, y, ...o });
    w.page.drawText("RESULT", { x: cols.res, y, ...o });
  };
  w.ensure(20);
  head(w.y - 9);
  w.y -= 16;
  for (const it of ITEMS) {
    const sec = SECTIONS.find((s) => s.key === it.section)!.title;
    const lines = w.wrap(it.title, w.bold, 9.5, 275);
    const h = 11 + lines.length * 12 + 6;
    if (w.y - h < w.M + 24) { w.newPage(); head(w.y - 9); w.y -= 16; }
    const top = w.y;
    w.page.drawText(winAnsi(`${sec} - ${it.kind}`), { x: cols.item, y: top - 8, size: 8, font: w.reg, color: w.muted });
    lines.forEach((ln, i) => w.page.drawText(ln, { x: cols.item, y: top - 20 - i * 12, size: 9.5, font: w.bold, color: w.ink }));
    const a = self[it.key], b = mgr[it.key];
    const mid = top - 20;
    w.page.drawText(String(a ?? "-"), { x: cols.self + 6, y: mid, size: 10, font: w.reg, color: w.ink });
    w.page.drawText(String(b ?? "-"), { x: cols.mgr + 6, y: mid, size: 10, font: w.reg, color: w.ink });
    if (typeof a === "number" && typeof b === "number") {
      const gap = Math.abs(a - b);
      w.page.drawText(gap ? String(gap) : "-", { x: cols.gap + 6, y: mid, size: 10, font: w.reg, color: w.ink });
      w.page.drawText(winAnsi(compareResult(a, b)), { x: cols.res, y: mid, size: 9, font: w.bold, color: w.ink });
    }
    w.y = top - h;
    w.page.drawLine({ start: { x: w.M, y: w.y + 3 }, end: { x: w.W - w.M, y: w.y + 3 }, thickness: 0.4, color: w.line });
  }
  w.y -= 6;
  const st = total(self), mt = total(mgr);
  w.text(`Self total: ${st ?? "-"} / 30   |   ${rFirst}'s total: ${mt ?? "-"} / 30`, { size: 11, bold: true, after: 2 });
  w.text("A rating below 3, or a total below 18, requires an action step.", { size: 8.5, muted: true, after: 6 });

  // Comments
  w.heading("Section comments");
  for (const s of SECTIONS) {
    if (!self[s.comment] && !mgr[s.comment]) continue;
    w.text(s.title, { size: 10.5, bold: true, after: 3 });
    w.labeled("Self", self[s.comment]);
    w.labeled(rFirst, mgr[s.comment]);
  }
  if (self.action_steps || mgr.action_steps) {
    w.text("Action steps (from the forms)", { size: 10.5, bold: true, after: 3 });
    w.labeled("Self", self.action_steps);
    w.labeled(rFirst, mgr.action_steps);
  }

  // Agreed action steps
  w.heading("Agreed action steps");
  const steps = doc.steps || [];
  if (!steps.length) w.text("None.", { size: 10, muted: true });
  const STEP = { open: "Open", in_progress: "In progress", done: "Done", carried: "Carried forward" } as Record<string, string>;
  for (const s of steps) {
    w.text("- " + s.description, { size: 10, after: 1 });
    const meta = [
      s.from_label ? `From ${s.from_label}` : "",
      s.section ? SECTIONS.find((x) => x.key === s.section)?.title || "" : "",
      `Owner: ${s.owner === "reviewer" ? rev : staff}`,
      s.due_date ? `Due ${fmtDate(s.due_date)}` : "",
      STEP[s.status] || s.status,
    ].filter(Boolean).join("  |  ");
    w.text(meta, { size: 8.5, muted: true, indent: 10, after: 6 });
  }

  // Reviewer feedback / note
  if (mgr.appreciation || mgr.coaching || mgr.evaluation) {
    w.heading(`${rFirst}'s feedback`);
    w.labeled("Appreciation", mgr.appreciation);
    w.labeled("Coaching", mgr.coaching);
    w.labeled("Evaluation", mgr.evaluation);
  }
  if (self.note_to_reviewer) {
    w.heading(`Note to ${rFirst}`);
    w.text(self.note_to_reviewer, { size: 10 });
  }
  if (doc.recipient_comments) {
    w.heading("Recipient comments");
    w.text(doc.recipient_comments, { size: 10 });
  }

  // Signatures
  w.heading("Signatures");
  for (const g of doc.signatures || []) {
    w.ensure(90);
    w.text(`${g.signer_role === "staff" ? "Team member" : "Reviewer"}: ${g.typed_name}`, { size: 11, bold: true, after: 2 });
    w.text(`${g.email}  |  Signed ${fmtDateTime(g.signed_at)}  (${new Date(g.signed_at).toISOString()})`, { size: 8.5, muted: true, after: 2 });
    w.text(`"${g.acknowledgment}"`, { size: 9.5, after: 2 });
    if (g.disagree) {
      w.text("I disagree with parts of this review", { size: 9.5, bold: true, after: 1 });
      w.text(g.disagree_comment || "", { size: 9.5, indent: 10, after: 2 });
    }
    w.text(`IP ${g.ip || "not recorded"}  |  ${g.user_agent || "user agent not recorded"}`, { size: 7.5, muted: true, after: 10 });
  }

  if ((doc.addenda || []).length) {
    w.heading("Addenda");
    w.text("Added after the review locked. The signed review above is unchanged.", { size: 8.5, muted: true, after: 6 });
    for (const a of doc.addenda) {
      w.text(`${a.author_name || "Admin"} - ${fmtDateTime(a.created_at)}`, { size: 9, bold: true, after: 1 });
      w.text(a.body, { size: 10, after: 8 });
    }
  }

  w.footer(`${staff} - ${label} Review - Confidential`);
  return await w.pdf.save();
}

// ---------------------------------------------------------------------------
// Confirmed year-end summary (doc = public.tr_year_doc)
// ---------------------------------------------------------------------------
export async function buildYearPdf(lib: any, doc: any): Promise<Uint8Array> {
  const staff = doc.staff?.name || "Team member";
  const w = await start(lib, `${staff} - ${doc.year} Year-End Summary`);
  w.text("MyGoodBooks", { size: 9, bold: true, muted: true, after: 2 });
  w.text(`${doc.year} Year-End Summary`, { size: 18, bold: true, after: 2 });
  w.text(staff, { size: 12, after: 6 });
  w.text(`Confirmed by ${doc.confirmed_by || "an admin"} on ${fmtDateTime(doc.confirmed_at)}`, { size: 9, muted: true, after: 6 });

  w.heading("Total score by quarter (out of 30)");
  const qs = doc.quarters || [];
  if (!qs.length) w.text("No reviews this year.", { size: 10, muted: true });
  for (const q of qs) {
    const st = q.status === "closed_unsigned" ? " (closed unsigned)" : q.status === "signed" ? "" : ` (${q.status})`;
    w.text(`${q.label}${st}:  Self ${q.self_total ?? "-"}   |   Reviewer ${q.manager_total ?? "-"}`, { size: 10, after: 3 });
  }
  w.text("Rating scale: " + SCALE.join("  |  "), { size: 8.5, muted: true, after: 4 });

  w.heading("Strongest");
  w.text(doc.strongest || "-", { size: 10.5 });
  w.heading("Focus area");
  w.text(doc.focus || "-", { size: 10.5 });
  w.heading("Alignment");
  w.text(doc.alignment || "-", { size: 10.5 });

  w.footer(`${staff} - ${doc.year} Year-End Summary - Confidential`);
  return await w.pdf.save();
}
