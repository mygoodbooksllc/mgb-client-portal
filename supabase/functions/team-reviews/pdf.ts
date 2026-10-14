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

// ---------------------------------------------------------------------------
// Signed Staff Handbook policy (supabase/staff-handbook.sql). Built once on the
// server after the countersignature and filed in Drive (export_handbook).
// doc = public.hb_signature_doc: { signature_id, policy {id, slug, title},
//   version {version_no, body_md, body_sha256, published_at}, effective_date
//   (YYYY-MM-DD, America/Chicago), signer / countersigner {email, name,
//   typed_name, ack_text, signed_at, ip, user_agent} }
// ---------------------------------------------------------------------------

/** "October 14, 2026": a timestamp's calendar date in America/Chicago. */
export function fmtLongDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(String(iso)).toLocaleDateString("en-US", { timeZone: TZ, month: "long", day: "numeric", year: "numeric" });
}
/** "2026-10-14": a timestamp's calendar date in America/Chicago. */
export function isoDateCT(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(String(iso)));
}

/** Fills {{effective_date}} and {{employee_name}} (spaces inside the braces allowed). */
export function fillPlaceholders(md: string, vals: { effective_date: string; employee_name: string }): string {
  return String(md ?? "").replace(/\{\{\s*(effective_date|employee_name)\s*\}\}/g, (_m, k: string) => (vals as any)[k] ?? "");
}

/** Pre-clean for the cp1252 fonts: common symbols become words, emoji and joiners are dropped. */
export function handbookText(s: unknown): string {
  return String(s ?? "")
    .replace(/[✓✔✅]/g, "[x]")
    .replace(/[☐⬜]/g, "[ ]")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/≠/g, "!=")
    .replace(/≈/g, "~")
    .replace(/[‐‑‒]/g, "-")
    .replace(/[●◦▪■▸►]/g, "•")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[︎️‍⃣]/g, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu, "");
}

type Run = { t: string; b: boolean };
/** Inline markdown to bold/regular runs. Links keep their text, code and italics lose their markers. */
export function inlineRuns(src: string, allBold = false): Run[] {
  const s = String(src)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, t: string, u: string) => (u.startsWith("#") || t === u ? t : `${t} (${u})`))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "");
  const runs: Run[] = [];
  const parts = s.split(/(\*\*[^*]+?\*\*|__[^_]+?__)/g);
  for (const part of parts) {
    if (!part) continue;
    const bold = /^(\*\*|__)[\s\S]+\1$/.test(part);
    let t = bold ? part.slice(2, -2) : part;
    t = t
      .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
      .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, "$1$2")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, "$1");
    runs.push({ t, b: allBold || bold });
  }
  return runs;
}

/** Wraps runs into lines of {t, b} pieces that fit `width`. */
function wrapRuns(w: Writer, runs: Run[], size: number, width: number): Run[][] {
  const words: Run[] = [];
  for (const r of runs) {
    const pieces = winAnsi(handbookText(r.t)).replace(/\n/g, " ").split(/( +)/);
    for (const p of pieces) {
      if (!p) continue;
      if (/^ +$/.test(p)) words.push({ t: " ", b: r.b });
      else words.push({ t: p, b: r.b });
    }
  }
  const font = (b: boolean) => (b ? w.bold : w.reg);
  const lines: Run[][] = [];
  let cur: Run[] = [];
  let curW = 0;
  const push = () => {
    while (cur.length && cur[cur.length - 1].t === " ") cur.pop();
    if (cur.length) lines.push(cur);
    cur = [];
    curW = 0;
  };
  for (const word of words) {
    if (word.t === " ") {
      if (cur.length) { cur.push(word); curW += font(word.b).widthOfTextAtSize(" ", size); }
      continue;
    }
    let ww = font(word.b).widthOfTextAtSize(word.t, size);
    if (curW + ww <= width) { cur.push(word); curW += ww; continue; }
    push();
    let t = word.t;
    while (ww > width && t.length > 1) {
      let k = t.length - 1;
      while (k > 1 && font(word.b).widthOfTextAtSize(t.slice(0, k), size) > width) k--;
      lines.push([{ t: t.slice(0, k), b: word.b }]);
      t = t.slice(k);
      ww = font(word.b).widthOfTextAtSize(t, size);
    }
    cur = [{ t, b: word.b }];
    curW = ww;
  }
  push();
  return lines;
}

/** Draws inline-formatted text with an optional hanging marker ("-", "1."). */
function rich(w: Writer, src: string, o: { size?: number; indent?: number; marker?: string; after?: number; muted?: boolean; allBold?: boolean } = {}) {
  const size = o.size ?? 10;
  const x0 = w.M + (o.indent ?? 0);
  const markerW = o.marker ? Math.max(12, w.reg.widthOfTextAtSize(winAnsi(o.marker), size) + 5) : 0;
  const x = x0 + markerW;
  const width = w.W - w.M - x;
  const lh = size * 1.4;
  const color = o.muted ? w.muted : w.ink;
  const lines = wrapRuns(w, inlineRuns(src, o.allBold), size, width);
  lines.forEach((line, i) => {
    w.ensure(lh);
    if (i === 0 && o.marker) w.page.drawText(winAnsi(o.marker), { x: x0, y: w.y - size, size, font: w.reg, color });
    let cx = x;
    for (const piece of line) {
      const font = piece.b ? w.bold : w.reg;
      if (piece.t !== " ") w.page.drawText(piece.t, { x: cx, y: w.y - size, size, font, color });
      cx += font.widthOfTextAtSize(piece.t, size);
    }
    w.y -= lh;
  });
  w.y -= o.after ?? 4;
}

const tableCells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const isTableSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Renders the markdown subset the policies use: headings, paragraphs, bold, lists, quotes, rules, tables (as text). */
function renderMarkdown(w: Writer, md: string) {
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  // Ordered lists number 1, 2, 3 per list and depth, like the portal's <ol>.
  let olCount: number[] = [];
  const flush = () => {
    if (para.length) rich(w, para.join(" "), { size: 10, after: 6 });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flush(); olCount = []; continue; }
    if (!/^(\s*)([-*+]|\d{1,3}[.)])\s+/.test(line)) olCount = [];

    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      const text = h[2];
      if (level === 1) { w.ensure(40); w.y -= 6; rich(w, text, { size: 15, allBold: true, after: 4 }); }
      else if (level === 2) { w.ensure(40); w.y -= 8; rich(w, text, { size: 12.5, allBold: true, after: 2 }); w.rule(); }
      else if (level === 3) { w.ensure(30); w.y -= 4; rich(w, text, { size: 11, allBold: true, after: 3 }); }
      else { w.ensure(24); rich(w, text, { size: 10.5, allBold: true, after: 2 }); }
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); w.y -= 2; w.rule(); continue; }

    // Table (same detection as the portal's HLP_Markdown: a run of lines starting with "|";
    // separator rows skipped, the first row is the header). Printed as text, one block per row.
    if (/^\s*\|/.test(line)) {
      flush();
      const rows: string[][] = [];
      i -= 1;
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) {
        i += 1;
        if (!isTableSep(lines[i])) rows.push(tableCells(lines[i]));
      }
      const [head = [], ...body] = rows;
      for (const cells of body.length ? body : [head]) {
        w.ensure(30);
        rich(w, cells[0] || "", { size: 10, allBold: true, marker: "•", indent: 6, after: 1 });
        for (let c = 1; c < cells.length; c++) {
          if (!cells[c]) continue;
          rich(w, body.length && head[c] ? `**${head[c]}:** ${cells[c]}` : cells[c], { size: 9.5, indent: 24, after: 1 });
        }
        w.y -= 4;
      }
      w.y -= 2;
      continue;
    }

    const li = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const depth = Math.min(3, Math.floor(li[1].replace(/\t/g, "    ").length / 2));
      let text = li[3];
      // continuation lines (indented, not a new item)
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*+]|\d{1,3}[.)])\s+/.test(lines[i + 1])) {
        i += 1;
        text += " " + lines[i].trim();
      }
      const ordered = /\d/.test(li[2]);
      olCount = olCount.slice(0, depth + 1);
      olCount[depth] = ordered ? (olCount[depth] || 0) + 1 : 0;
      const marker = ordered ? `${olCount[depth]}.` : depth % 2 ? "-" : "•";
      rich(w, text.replace(/^\[( |x|X)\]\s+/, (_m, c: string) => (c.trim() ? "[x] " : "[ ] ")), { size: 10, indent: 6 + depth * 14, marker, after: 2 });
      if (!(i + 1 < lines.length && /^\s*([-*+]|\d{1,3}[.)])\s+/.test(lines[i + 1]))) w.y -= 3;
      continue;
    }

    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      flush();
      let text = q[1];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) { i += 1; text += " " + lines[i].replace(/^\s*>\s?/, ""); }
      rich(w, text, { size: 10, indent: 14, muted: true, after: 6 });
      continue;
    }
    para.push(line.trim());
  }
  flush();
}

export async function buildHandbookPdf(lib: any, doc: any): Promise<Uint8Array> {
  const pol = doc.policy || {};
  const ver = doc.version || {};
  const sg = doc.signer || {};
  const cs = doc.countersigner || {};
  const title = pol.title || "Staff policy";
  const vno = ver.version_no ?? "?";
  const typed = sg.typed_name || sg.name || "Team member";
  const person = sg.name || typed;
  const effective = /^\d{4}-\d{2}-\d{2}$/.test(String(doc.effective_date || ""))
    ? new Date(`${doc.effective_date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })
    : fmtLongDate(sg.signed_at);
  const w = await start(lib, handbookText(`${title} v${vno} - ${person}`));
  // Fixed dates so the same record always renders to the same bytes.
  const stamp = new Date(cs.signed_at || sg.signed_at || Date.now());
  w.pdf.setCreationDate(stamp);
  w.pdf.setModificationDate(stamp);
  w.pdf.setSubject(winAnsi(`Signed staff policy, version ${vno}`));

  w.text("MyGoodBooks Staff Handbook", { size: 9, bold: true, muted: true, after: 2 });
  w.text(handbookText(title), { size: 18, bold: true, after: 2 });
  w.text(handbookText(person), { size: 12, after: 6 });
  w.text(
    [`Version ${vno}`, `Effective Date: ${effective}`, ver.published_at ? `Published ${fmtDate(ver.published_at)}` : ""].filter(Boolean).join("   |   "),
    { size: 9, muted: true, after: 10 },
  );
  w.rule();

  renderMarkdown(w, fillPlaceholders(ver.body_md || "", { effective_date: effective, employee_name: typed }));

  // Signature block (kept on one page)
  w.ensure(330);
  w.heading("Signatures");
  w.text(`Policy: ${handbookText(title)}   |   Version ${vno}   |   Effective Date: ${effective}`, { size: 9.5, after: 8 });
  const block = (label: string, g: any) => {
    const at = g.signed_at ? new Date(g.signed_at).toISOString() : "";
    w.ensure(90);
    w.text(`${label}: ${handbookText(g.typed_name || g.name || "")}`, { size: 11, bold: true, after: 2 });
    w.text(`${g.email ? g.email + "  |  " : ""}Signed ${fmtDateTime(g.signed_at)}  (${at || "time not recorded"})`, { size: 8.5, muted: true, after: 2 });
    if (g.ack_text) w.text(`"${handbookText(g.ack_text)}"`, { size: 9.5, after: 2 });
    w.text(`IP ${g.ip || "not recorded"}  |  ${handbookText(g.user_agent) || "browser not recorded"}`, { size: 7.5, muted: true, after: 10 });
  };
  block("Employee", sg);
  block("Countersigned by", cs);

  w.heading("Record");
  w.labeled("Signature ID", String(doc.signature_id || ""));
  w.labeled(`SHA-256 of policy source v${vno}`, String(sg.body_sha256 || ver.body_sha256 || "not recorded"));
  w.text("The fingerprint covers the policy text as published, before the Effective Date and name were filled in.", { size: 8, muted: true });

  w.footer(`${handbookText(title)} v${vno} - ${handbookText(person)} - Signed copy`);
  return await w.pdf.save();
}
