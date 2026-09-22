# Handoff: apply the "calm" redesign (for an Opus session)

Written 2026-09-22 by the Fable session that ran the audit, Phase 0 (security), Phase 1 (real QuickBooks data), and produced the design mockup. Memory files in
`~/.claude/projects/-Users-holdengray-Desktop-Mygoodbooks-app-code/memory/` load automatically; read `project-infra-map.md` and `project-roadmap-status.md` first. HANDOFF7.md §170–§171 has the Phase 1 detail.

## Working style (owner's standing rules)
- Terse replies, "only need to know". No detail dumps. Owner is not a developer.
- Delegate multi-file reads/edits to agents (Sonnet mechanical, Opus judgment). Keep main context small; remind owner to `/compact` at ~25%.
- Owner pushes via GitHub Desktop. Sandbox has no git credentials, no `gh`. Commit locally, then say "push".
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (use the current model's name).
- Never handle secrets or the Supabase service_role key. Repo is publicly served (Vercel static, no build) — nothing sensitive in files.

## Repo facts
- Folder: `~/Desktop/Mygoodbooks-app-code/client-dashboard` (`git fetch` first; it goes stale). Local `main` at 2eb101b, 1 commit ahead of origin — owner must push it.
- No bundler. `index.html` fetches `window.__SOURCE_ORDER` files and compiles with @babel/standalone in-browser; all files share global scope. `app.jsx` is ~18k lines. Stylesheet is `styles.css` (~6,200 lines); DailyClose has its own `components/daily-close/DailyClose.css`.
- Theme: dark is the product default; `data-theme` on `<html>` overrides; light tokens in `:root`, dark under `@media (prefers-color-scheme: dark)` guarded by `:not([data-theme="light"])` and again under `[data-theme="dark"]`. Tokens live at the top of `styles.css` (`--navy`, `--gold`, `--gold-deep`, `--bg`, `--surface`, `--border`, `--text`, `--text-muted`, plus `--glass-*`, `--mesh-*`, `--grid-line` for the current animated/glass look).
- Local preview: `preview_start` name `client-dashboard` (node server on port 8420, config in the parent folder's `.claude/launch.json`). Verify in the built-in browser, light and dark, desktop and phone.
- Deploy: GitHub `mygoodbooksllc/mgb-client-portal` `main` → Vercel `mgb-client-portal` → app.mygoodbooks.org. Every branch gets a Vercel preview URL.

## The design (approved mockup)
Artifact: https://claude.ai/artifact/8htnKzRNxoqScxMY3Vxk7S (4 artboards: Dashboard light, Dashboard dark, Login, Phone). Read it with the Artifact tool for exact spacing/typography.

Direction: calm, static, opaque. Concretely:
1. Remove the animated mesh background and glass/blur cards; static `--bg`, opaque `--surface` cards, 1px `--border`.
2. Gold is a static accent only (active nav marker, one primary button, small pills). No gold gradients, glows, or animated shimmer.
3. Fix light-mode contrast: muted text `#6b655c` (was `#7a7369`), gold-deep `#8a6d34` for gold-on-light text.
4. Numbers: `font-variant-numeric: tabular-nums`; body text floor 14px.
5. Sidebar: two groups, plain-language labels, quieter muted color; active item = gold left marker + navy text.
6. Header: compress; search becomes an icon button; keep Live/Sample pill and theme toggle.
7. Login: branded card on `--bg`, logo, one magic-link field + Google button for staff; dark-safe logo.
Tokens — light: navy #05080d, gold #c7ae86, gold-deep #8a6d34, bg #faf9f6, surface #ffffff, border #e8e2d6, text #26343d, muted #6b655c, good #3f6b52, bad #a4442c. Dark: bg #0f1512, surface #161d1a, border #293530, text #e9ece6, muted #9aa59c, gold-deep #d8c39f.

## Plan and safety net (agreed with owner)
- Work on branch `design/calm` off `main`. Tag `main` first (`pre-calm-design`). Do not touch `main`.
- Order: (1) tokens + static surfaces (CSS only), (2) sidebar, (3) header, (4) login. Commit after each step so any step can be reverted alone.
- Owner reviews at the Vercel preview URL for the branch; merge to `main` only on their yes. After merge, rollback = `git revert` of the merge or Vercel "promote previous deployment".
- Keep logic untouched. Do not rename tabs or restructure nav data (that is Phase 3); only styling and markup needed for the new layout.
- Run `components/qbo/mapQboToClient.test.js` and click through Dashboard, Client details, Live Report, Manage access in both themes before asking for review.

## Not this session
Phase 2 (client value), Phase 3 (simplify nav/labels), Phase 4 (Vite), and the one pending Phase 1 item are listed in memory `project-roadmap-status.md`. Tomorrow's real client: Client Roster → add org → Connect QuickBooks (production) → Manage access → Invite.
