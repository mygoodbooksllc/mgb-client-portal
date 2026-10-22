#!/usr/bin/env node
// Slate app launch: the staff guide edits that go live when the owner flips
// tk_settings.slate_app_enabled. Nothing here runs by itself, and nothing in this
// folder is synced (docs/staff-guide/sync.mjs reads only the top-level .md files).
//
//   node docs/staff-guide/drafts/slate-launch-patch.mjs --sql            prints the upsert SQL
//        (supabase/staff-guide-slate-launch.sql is this output; the What's new date is
//        filled in by the database on the day it runs)
//   node docs/staff-guide/drafts/slate-launch-patch.mjs --write YYYY-MM-DD   edits the repo .md files to
//        the launched text (run it in the launch follow-up commit, with the flip date, so the repo
//        matches the table and a later sync does not undo anything)
//   node docs/staff-guide/drafts/slate-launch-patch.mjs --check           confirms every edit still applies
//
// Articles touched (upserts only, no deletes): tasks-own-window (replaced by
// drafts/staff-guide-slate-app.md, same slug), whats-new, tips, workbench, get-the-app,
// admin-insight, client-tasks-drawer.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DRAFTS = dirname(fileURLToPath(import.meta.url));
const DIR = join(DRAFTS, "..");
const DATE_TOKEN = "@@LAUNCH_DATE@@";

function split(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error("missing frontmatter");
  return { fm: m[1], body: m[2].replace(/^\s+/, "").replace(/\s+$/, "") + "\n" };
}
const fmGet = (fm, k) => new RegExp(`^${k}\\s*:\\s*(.*)$`, "m").exec(fm)[1].trim().replace(/^["']|["']$/g, "");
function addKeywords(fm, words) {
  return fm.replace(/^(keywords\s*:\s*\[)(.*)(\])\s*$/m, (_, a, b, c) => {
    const have = b.split(",").map((s) => s.trim());
    return a + b + words.filter((w) => !have.includes(w)).map((w) => ", " + w).join("") + c;
  });
}
function once(body, from, to, slug) {
  const n = body.split(from).length - 1;
  if (n !== 1) throw new Error(`${slug}: expected one match, found ${n}, for: ${from.slice(0, 70)}`);
  return body.replace(from, () => to);
}

const draftArticle = () => {
  const t = readFileSync(join(DRAFTS, "staff-guide-slate-app.md"), "utf8");
  const a = t.indexOf("--- tasks-own-window.md (replacement) ---");
  const b = t.indexOf("--- WORKBENCH LINE");
  return t.slice(a + "--- tasks-own-window.md (replacement) ---".length, b).trim() + "\n";
};
const draftWhatsNew = () => {
  const t = readFileSync(join(DRAFTS, "whats-new-slate-app.txt"), "utf8");
  const a = t.indexOf("--- whats-new.md entry ---");
  const b = t.indexOf("--- next-visit notice");
  return t.slice(a + "--- whats-new.md entry ---".length, b).trim().replace("### DATE:", `### ${DATE_TOKEN}:`) + "\n";
};

// slug -> (file text) => new file text
const EDITS = {
  "tasks-own-window": () => {
    let { fm, body } = split(draftArticle());
    fm = addKeywords(fm, ["classic tasks page", "mgb_slate_classic", "old window"]);
    body = once(
      body,
      "- **I don't see Open Slate app.** Use a computer. Until the owner turns the app on for the team, only people with the preview switch see it.",
      "- **I don't see Open Slate app.** Use a computer; on a phone or tablet, use Slate inside the portal. If you still see **Open in own window**, an admin has put your browser on **Classic tasks page**.\n- **I'd rather use the old window.** Ask an admin to tick **Classic tasks page** on your computer, in Settings › Firm settings › Developer tools › Feature flags. It is per browser, and the Slate page in the portal is the same either way.",
      "tasks-own-window",
    );
    body = once(
      body,
      "Each list remembers whether you left it as a list or a board.",
      "Each list remembers whether you left it as a list or a board. The Done column shows only the done tasks Slate has already loaded.",
      "tasks-own-window",
    );
    return `---\n${fm}\n---\n${body}`;
  },
  "whats-new": (text) => {
    let { fm, body } = split(text);
    fm = addKeywords(fm, ["slate app", "open slate app", "install slate app", "sliver", "slate sizes", "saved views", "manual order", "board view", "classic tasks page"]);
    body = once(body, "### 2026-10-21: The Desk, a left sidebar and a new look", draftWhatsNew() + "\n### 2026-10-21: The Desk, a left sidebar and a new look", "whats-new");
    return `---\n${fm}\n---\n${body}`;
  },
  tips: (text) => {
    const { fm, body } = split(text);
    return `---\n${fm}\n---\n${once(
      body,
      "| Slate (not on a touch screen) | Open in own window keeps Slate in a slim window beside your work. Dock in portal brings it back. | [Can I keep Slate in its own window?](#/help/tasks-own-window) |",
      "| Slate (not on a touch screen) | Open Slate app opens Slate as its own app beside your work. Links you click there open in this portal window. | [How do I use the Slate app?](#/help/tasks-own-window) |",
      "tips",
    )}`;
  },
  workbench: (text) => {
    const { fm, body } = split(text);
    return `---\n${fm}\n---\n${once(
      body,
      "use Slate's own window instead: see [Can I keep Slate in its own window?](#/help/tasks-own-window).",
      "use the Slate app instead: see [How do I use the Slate app?](#/help/tasks-own-window). Bulk edits, saved views, manual order and boards are in the Slate app too.",
      "workbench",
    )}`;
  },
  "get-the-app": (text) => {
    let { fm, body } = split(text);
    fm = addKeywords(fm, ["slate app", "install slate app", "mgb slate"]);
    body = once(
      body,
      "### Troubleshooting\n\n- **I don't see the install icon.**",
      "### Install the Slate app\n\nSlate can be installed as a second app next to MyGoodBooks, with its own icon, so you can open it from the Dock or Start menu without opening the portal first. In Chrome or Edge on a computer, click **Install Slate app** next to **Open Slate app** on the Slate page and confirm. To remove it, open the **⋮** (Chrome) or **…** (Edge) menu in the Slate window and choose **Uninstall MGB Slate**. See [How do I use the Slate app?](#/help/tasks-own-window).\n\n### Troubleshooting\n\n- **I don't see the install icon.**",
      "get-the-app",
    );
    return `---\n${fm}\n---\n${body}`;
  },
  "admin-insight": (text) => {
    let { fm, body } = split(text);
    fm = addKeywords(fm, ["classic tasks page", "mgb_slate_classic"]);
    body = once(
      body,
      "**Slate app preview** (Slate as its own app for you only while its firm switch is off; for now the owner's testing switch)",
      "**Slate app preview** (Slate as its own app for you only while its firm switch is off), **Classic tasks page** (the old Slate window for you only once the Slate app is on)",
      "admin-insight",
    );
    return `---\n${fm}\n---\n${body}`;
  },
  "client-tasks-drawer": (text) => {
    const { fm, body } = split(text);
    return `---\n${fm}\n---\n${once(
      body,
      "In the Slate window (see [Can I keep Slate in its own window?](#/help/tasks-own-window))",
      "In the Slate app (see [How do I use the Slate app?](#/help/tasks-own-window))",
      "client-tasks-drawer",
    )}`;
  },
};

function build() {
  return Object.keys(EDITS).map((slug) => {
    const file = join(DIR, slug + ".md");
    const before = readFileSync(file, "utf8");
    const after = EDITS[slug](before);
    const { fm, body } = split(after);
    const kw = fmGet(fm, "keywords").replace(/^\[/, "").replace(/\]$/, "").split(",").map((s) => s.trim()).filter(Boolean);
    return { slug, file, after, title: fmGet(fm, "title"), section: fmGet(fm, "section"), audience: fmGet(fm, "audience"), sort: Number(fmGet(fm, "sort")), keywords: kw, body };
  });
}

function dq(s) {
  let tag = "sg";
  let n = 0;
  while (s.includes(`$${tag}$`)) tag = `sg${++n}`;
  return `$${tag}$${s}$${tag}$`;
}
const textArray = (arr) => `array[${arr.map(dq).join(", ")}]::text[]`;
// The What's new date is filled in by the database, so the file needs no editing on the day.
const bodyExpr = (a) =>
  a.body.includes(DATE_TOKEN)
    ? `replace(${dq(a.body)}, ${dq(DATE_TOKEN)}, to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD'))`
    : dq(a.body);

function sql(rows) {
  const values = rows.map((a) => `  (${dq(a.slug)}, ${dq(a.title)}, ${dq(a.section)}, ${dq(a.audience)}, ${bodyExpr(a)}, ${textArray(a.keywords)}, ${a.sort})`);
  return `-- Slate app launch: staff guide text. NOT APPLIED. Apply at flip time, right after the owner sets
-- tk_settings.slate_app_enabled to true (see the owner SQL in the launch report / commit message).
-- Seven articles, upserts only, no deletes. Idempotent: a row whose content is unchanged keeps its updated_at.
--   tasks-own-window  -> "How do I use the Slate app?" (same slug, so every link and tip keeps working)
--   whats-new         -> new entry "Slate is now its own app" (dated by the database, US Eastern, the day it runs)
--   tips              -> the Slate pop-out tip row now says Open Slate app
--   workbench, get-the-app, client-tasks-drawer, admin-insight -> Slate app wording, Classic tasks page
-- Generated by: node docs/staff-guide/drafts/slate-launch-patch.mjs --sql
-- Before running, confirm the live rows still match what this was built on (no one edited them since):
--   select slug, md5(body_md) from staff_guide where slug in (${rows.map((a) => `'${a.slug}'`).join(", ")}) order by slug;
--   built on: see the "-- base md5" lines below.
-- After running, in a follow-up commit: node docs/staff-guide/drafts/slate-launch-patch.mjs --write YYYY-MM-DD
-- (the same day), then node docs/staff-guide/sync.mjs --check. Then verify the old wording is gone:
--   select slug from staff_guide where body_md ilike '%Can I keep Slate in its own window%' (should return no rows).
${rows.map((a) => `-- base md5 ${a.slug}: ${a.baseMd5}`).join("\n")}
begin;

insert into public.staff_guide as g (slug, title, section, audience, body_md, keywords, sort)
values
${values.join(",\n")}
on conflict (slug) do update set
  title      = excluded.title,
  section    = excluded.section,
  audience   = excluded.audience,
  body_md    = excluded.body_md,
  keywords   = excluded.keywords,
  sort       = excluded.sort,
  updated_at = now()
where (g.title, g.section, g.audience, g.body_md, g.keywords, g.sort)
  is distinct from
  (excluded.title, excluded.section, excluded.audience, excluded.body_md, excluded.keywords, excluded.sort);

commit;
`;
}

import { createHash } from "node:crypto";
const mode = process.argv[2];
const rows = build();
rows.forEach((r) => {
  r.baseMd5 = createHash("md5").update(split(readFileSync(r.file, "utf8")).body).digest("hex");
});
if (mode === "--check") {
  console.log(`OK: ${rows.length} edits apply (${rows.map((r) => r.slug).join(", ")}).`);
} else if (mode === "--sql") {
  process.stdout.write(sql(rows));
} else if (mode === "--write") {
  const date = process.argv[3];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("--write needs the launch date, YYYY-MM-DD");
  rows.forEach((r) => writeFileSync(r.file, r.after.split(DATE_TOKEN).join(date)));
  console.log(`Wrote ${rows.length} files with launch date ${date}. Run: node docs/staff-guide/sync.mjs --check`);
} else {
  console.error("usage: --sql | --write YYYY-MM-DD | --check");
  process.exit(1);
}
