# Workbench Hub spec: self-critique (2026-10-16)

This reviews the first draft of `docs/workbench-hub-spec.md` against the code at `0479da2` and the live database (read-only). Every finding below is already fixed in the spec.

| # | Finding in draft 1 | Evidence | Fix in the spec |
|---|---|---|---|
| C1 | My tasks grouping called `TK_groupBySection(..., {by:"due"})`. That function groups by **section**, not by due date. | `TK_viewLogic.js:187`; My Tasks uses `TK_groupMyTasks` + `TK_myGroupsView` (`TK_MyTasks.jsx:273-281`) | §3.2 calls the same two functions as My Tasks. |
| C2 | The hub reused the `"mine"` list key. `TK_sync` refetches a key with its **first** registered loader (`st.loaders[key][0]`), and My Tasks' loader changes with Show older. The two surfaces would reload each other with the wrong options. | `TK_sync.js:165-175`, `TK_MyTasks.jsx:210-214` | Own key `wb:mine`. New R4. A test toggles Show older with the hub open. |
| C3 | Claimed `q` keeps working inside the hub. `TK_QuickAdd` stands down when any `[aria-modal='true']` exists, and the hub panel is one. | `TK_QuickAdd.jsx:547` | §5 says `q` is inert in the hub. **+ Task** is the path, and the P4 file is not edited. New R10. |
| C4 | `t` inside the hub was not considered. Its host checks only `.modal-overlay`, so the client drawer (z 1840) stacks over the hub, and the hub's Esc would have closed the hub under it. | `TK_ClientDrawer.jsx:762`, `tk-client.css:12` | `.tk-cd-layer` added to `WB_layerAbove()`. H1 test added. |
| C5 | Inbox chip id `file`. The real id is `doc`. | `WB_logic.js:29-35` | State model uses the `WB_DRAWER_TABS` ids. |
| C6 | H2 (reply) planned a possible `StaffInbox.jsx` edit to forward `initialEmail`. `SI_ChatDrawer({ onClose, ...inboxProps })` already spreads it. | `StaffInbox.jsx:1880` | SI removed from the reply slice. No hub slice edits SI except optional H3b. |
| C7 | The Search button assumed an opener event on ⌘K. `TB_Search` opens only on its own keydown and focus. | `TopBar.jsx:462-464, 730-732` | New `tb:open-search` listener. The Search button moved to H6 (the TopBar slice), so H5 touches no shared files. |
| C8 | The private-task risk in `tk_waiting_on_client` was listed as "verify". Verified: neither branch filters `visibility`. 1 live private task today. This is an **existing leak** on `#/tasks/waiting`, not only a hub risk. | `pg_proc` source (1,717 chars, no `visibility` or `private`) | New slice **H0** (Opus, server) goes first, and H4 is gated on it. |
| C9 | Slice order put reply before My tasks. The owner's words were "including tasks". | owner quote | My tasks moved to H2, right after the shell. |
| C10 | The Esc ordering between two document handlers was unspecified. Risk: one key press closes two layers. | `WB_Drawer.jsx:48-88`, `TK_Drawer.jsx:1600` | §2.3: the layer check runs at keydown time. The closing layer is still in the DOM for that event, so one Esc closes one layer. |
| C11 | "No new RPCs" stood next to a privacy fix to an RPC. | §4 | §4 says the hub adds none, and H0 tightens one existing RPC. |

## Checked and kept

- **Ask client with no task works as-is.**
  - `TK_AskClientModal` sends `taskId: p.taskId || null` (`TK_AskClientModal.jsx:148`).
  - `tk_ask_client(p_task_id uuid null)` accepts it.
  - Task-less requests already exist (Documents tab).
- **Quick add from the strip works while the hub is open.** The `tk:quick-add` event path is not gated (`TK_QuickAdd.jsx:523-567`). Its ModalShell (z 2000+) sits above the hub.
- **Z order.** WB bar 1380 < SI 1800 (lifted to 1830 while the hub is open) / hub 1820 < client drawer 1840 < task drawer 1850 < modals 2000+.
- **Mount condition.** It already excludes View as, preview, the tk shell and missing staff (`app.jsx:29912`), so the hub inherits it.
- **`client_messages` / `client_files` columns** used in §3.3 exist (live `information_schema`). RLS is staff + `can_access_client`.
- **`tk_waiting_on_client`** is limited to 500 rows and gated by `is_active_staff()` + `can_access_client()` (apart from C8).

## Remaining judgment calls (owner decisions D1-D5 in the spec)

- **Overlay vs side by side (D1).** The biggest product question. The default keeps today's overlay, because a side-by-side dock at up to 78vh leaves too little page to be useful.
- **The `t` drawer vs the Client tab (D5).** These are two client surfaces. The shared body keeps the code single. The merge decision waits for P4-5.
