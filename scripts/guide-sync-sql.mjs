// Builds a guarded staff_guide sync SQL block from docs/staff-guide/*.md.
// Usage: node scripts/guide-sync-sql.mjs <base git ref> <slug> [<slug> ...]
// For each slug: the base md5 is md5 of the article body at <base ref> (absent
// = a new article), the after md5 is the working tree's. The block refuses to
// run when a live row is at neither md5 (it changed since the base: regenerate),
// upserts title/section/audience/body_md/keywords/sort, then checks every row
// ended at the after md5. Body = text after the front matter, trimmed, plus "\n"
// (same rule as docs/staff-guide/drafts/slate-launch-patch.mjs).
import fs from "fs";
import crypto from "crypto";
import { execFileSync } from "child_process";

const [base, ...slugs] = process.argv.slice(2);
if (!base || !slugs.length) throw new Error("usage: guide-sync-sql.mjs <base ref> <slug>...");
const md5 = (s) => crypto.createHash("md5").update(s, "utf8").digest("hex");
function parse(text, slug) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(slug + ": missing front matter");
  const fm = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const kw = (fm.keywords || "[]").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  return { title: fm.title, section: fm.section, audience: fm.audience || "staff", sort: parseInt(fm.sort || "0", 10), keywords: kw, body: m[2].replace(/^\s+/, "").replace(/\s+$/, "") + "\n" };
}
const q = (s) => {
  if (s.includes("$sg$")) throw new Error("text contains $sg$");
  return "$sg$" + s + "$sg$";
};
const rows = slugs.map((slug) => {
  const path = `docs/staff-guide/${slug}.md`;
  let before = null;
  try {
    before = md5(parse(execFileSync("git", ["show", `${base}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }), slug).body);
  } catch (e) {
    before = null;
  }
  const a = parse(fs.readFileSync(path, "utf8"), slug);
  return { slug, before, after: md5(a.body), a };
});
const out = [];
out.push("do $guard$\ndeclare cur text;\nbegin");
for (const r of rows) {
  out.push(`  select md5(body_md) into cur from public.staff_guide where slug = '${r.slug}';`);
  const ok = [r.before ? `cur is distinct from '${r.before}'` : `cur is not null`, `cur is distinct from '${r.after}'`].join(" and ");
  out.push(`  if ${ok} then raise exception '${r.slug}: live row changed (md5 %), regenerate', cur; end if;`);
}
out.push("  insert into public.staff_guide as g (slug, title, section, audience, body_md, keywords, sort)\n  values");
out.push(
  rows
    .map((r) => `    (${q(r.slug)}, ${q(r.a.title)}, ${q(r.a.section)}, ${q(r.a.audience)}, ${q(r.a.body)}, array[${r.a.keywords.map(q).join(", ")}]::text[], ${r.a.sort})`)
    .join(",\n"),
);
out.push(`  on conflict (slug) do update set
    title = excluded.title, section = excluded.section, audience = excluded.audience,
    body_md = excluded.body_md, keywords = excluded.keywords, sort = excluded.sort, updated_at = now()
  where (g.title, g.section, g.audience, g.body_md, g.keywords, g.sort)
    is distinct from (excluded.title, excluded.section, excluded.audience, excluded.body_md, excluded.keywords, excluded.sort);`);
for (const r of rows) {
  out.push(`  select md5(body_md) into cur from public.staff_guide where slug = '${r.slug}';`);
  out.push(`  if cur is distinct from '${r.after}' then raise exception '${r.slug}: post-check failed (md5 %)', cur; end if;`);
}
out.push("end $guard$;");
process.stdout.write(rows.map((r) => `-- ${r.slug}: before ${r.before || "(new article)"} -> after ${r.after}`).join("\n") + "\n" + out.join("\n") + "\n");
