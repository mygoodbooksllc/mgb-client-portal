# Slate plus: icon sidebar (hidden preview)

Owner request 2026-10-28: turn the Slate lists sidebar (`components/tasks/TK_Sidebar.jsx`, a 220-232px text list) into an icon-only rail like Asana: a large icon with a tiny label under it, and a second panel beside the rail for the sections that hold lists.

Size: big (layout, nav, tour/tip targets). Behind the shared Slate plus gate `TKP_useOn()` / `TKP_on()` (`components/tasks/TK_slatePlus.js`; flag `mgb_slateplus_preview`, firm switch `tk_settings.slateplus_enabled`, unset, never written by code). No database change.

## 1. Where it shows

| Place | Gate off | Gate on |
| --- | --- | --- |
| Portal `#/tasks/...`, 900px and up (`TK_shellLayout` rail) | old text sidebar | icon rail |
| Slate app, Regular and Full (`TK_slateLayout` rail) | old 220/240px sidebar | icon rail |
| Slate app Compact (the List size) and the portal under 900px | Lists button, sheet with the text sidebar | unchanged: the Lists sheet keeps the full text sidebar |
| Phone (shell bottom bar) | bottom bar + Lists sheet | unchanged |
| Slate app Sliver | rail hidden | rail hidden (CSS unchanged), sliver List button and the bar's size buttons untouched (12aa69f) |
| View as | old sidebar | old sidebar (`TKP_on` is false in View as) |
| Clients | never | never (staff app only) |

Mobile choice: keep the existing Lists sheet and bottom bar. It is the least disruptive: a sheet already has room for the full lists and touch targets, and a second phone pattern would need its own tour.

## 2. The rail (64px)

Top to bottom, each an icon (20px, `TK_vIcon`) with a 10.5px label under it, like the staff rail's collapsed captions:

| Item | Icon | Label | Kind | data-tour |
| --- | --- | --- | --- | --- |
| Slate | home | Slate | link `#/tasks/my` | |
| Review | check | Review | link, count badge (admins) | `tk-review-nav` |
| Waiting on client | hourglass | Waiting | link, count badge | `tk-waiting-nav` |
| Recurring | repeat | Recurring | link | `tk-recurring-nav` |
| Search | search | Search | link `#/tasks/search`; a plain click opens the unified search box (`TKS_openBox`), falls back to the Search view | |
| People | people | People | opens the panel | |
| Projects | folder | Projects | opens the panel | `tk-manage-nav` while the panel is closed (admins) |
| Clients | ClientRosterIcon (staff rail's Clients icon) | Clients | opens the panel | `tk-no-team` while the panel is closed and No team yet has clients (admins) |
| Pin panel (bottom) | dock | Pin / Unpin | toggle | |

The whole `<nav>` keeps `data-tour="tk-sidebar"` and `aria-label="Task lists"`.

- Links are real `<a href>` (TK_formatRoute) so Cmd/Ctrl/Shift/middle click opens a new tab; a plain click navigates (TK_vPlainClick).
- Active: the current view's item gets `is-active` and `aria-current="page"`; People/Projects/Clients are active when the route is a profile or person list / a project or Manage / a client.
- Every item has `aria-label` with the full name (and the count: "Review, 3 waiting") and a `title` tooltip with the full name. Badges are `aria-hidden` (the count is in the label).
- Keyboard: Tab moves through the rail; Up/Down arrows move between rail items, Home/End jump to the ends.

## 3. The panel (248px)

Opened by People, Projects or Clients. Two states, remembered per person:

- **Unpinned (default):** the panel floats over the list beside the rail. It closes on Escape (focus returns to its rail button), a click outside, picking an item, or pressing the same rail button again.
- **Pinned:** the panel stays open beside the rail and pushes the list over; the rail buttons switch its section. Escape moves focus back to the rail button.

Opening by keyboard moves focus to the first item in the panel. The panel is `role="region"` labelled by its heading, and the rail button has `aria-expanded` and `aria-controls`.

Remembered in `localStorage` `mgb_tkrail_v1:<person key>` (TKP_personKey, a hash, never the email), JSON `{ pinned, section }`, every read and write in try/catch; a bad or blocked value falls back to unpinned. Reset local state clears it (mgb_ prefix).

Contents (reuse `TK_vNavItem`, `tk-nav-*` classes so the look, links and tip parts match the old sidebar):

- **People:** My profile (`TKP_peopleRowRoute(me)`), then for admins Everyone (the same active staff as the old People list, each a profile link per 0ac557e). Non-admins get "Find anyone with Search (Ctrl or Cmd+K)."
- **Projects:** Pinned (my own `pinned_project_ids` from `TK_api.profilePrefs.get()`, only projects in the visible list), All projects (as the old list, onboarding last with its tag), New project (the same modal), Manage projects (admins with the admin role, `tk-manage-nav`).
- **Clients:** No team yet (admins, `tk-no-team`, same rows), Pinned (my `pinned_client_ids`, only clients I can see), Find a client box (more than 8), all clients (CF_usePicked/CF_sort as before).

Pins reload when the profile saves pins (event `tkp2:pins` from TK_ProfileEdit.jsx).

## 4. Layout and theme

- `.tk-app` gets `has-tkr` (and `tkr-pinned` while the panel is pinned and open); `--tkr-w` is 64px, or 320px (rail + 8px gap + panel) while pinned. Portal and Regular use it as the rail width; Full uses it as the first grid column.
- Colors from tokens only: the rail is a rounded card in `--topbar-bg` with a `--topbar-border` outline (the surface bar color in light, the sidebar color in dark), gold accent (`--gold`, `--accent-soft`) for active and focus. No new grid backgrounds.
- The rail sticks under the portal's sticky staff top bar (64px) or the Slate app bar (`--tk-sticky-top`), and is at most the viewport tall (`--tkr-maxh`), so it never makes a short page scroll.
- The floating panel sits under the Slate app bar (z-index below `.tk-sbar`'s 30), so the size buttons and the way back are never covered.

## 5. Tours and tips (both layouts)

Same `data-tour` names on the rail, so `tk-review-nav`, `tk-waiting-nav`, `tk-recurring-nav`, `tk-sidebar` land without change. `tk-manage-nav` and `tk-no-team` fall back to the Projects and Clients rail buttons while the panel is closed (TOUR_find takes the first visible match). Tip `part` lists gain rail selectors after (tk-no-team) or before (tk-sidebar, `.tkr-item-projects` is never in the old sidebar) the old ones, so the old sidebar resolves exactly as today. The tour's Lists step and the No team yet tip read differently only while the rail is on.

## 6. Gate off

`TK_Sidebar` computes the same data and returns the old JSX untouched; the rail is a separate component in a new file (`TK_SlateRail.jsx`, `TKR_` names, new `.tkr-*` CSS only). `TK_App` passes `variant="icons"` only when the rail layout and the gate are both on; otherwise its markup and classes are the same strings as before.

## 7. Self-critique

- **Hidden lists:** Projects and Clients are a click further away. Mitigated by the pin toggle (one click to keep the panel open, remembered) and by search.
- **Tour spotlight on a closed panel:** Manage projects is inside the panel; the step points at the Projects button and its text still reads right ("Manage projects lists every project"). The tasks-manage admin step opens `#/tasks/manage` first, where the heading target wins.
- **Pins source:** `profilePrefs.get()` reads my own row (RLS own row only). A failed read just hides Pinned. Pins are ids; anything I can't see (no longer assigned, archived) is dropped client side.
- **Overflow:** the old rail scrolled as one block (`overflow-y: auto`). The new host is `overflow: visible` so the floating panel is not clipped; the rail and panel scroll on their own.
- **Full mode width:** the grid's 240px first column becomes `--tkr-w`; the list's min-width calc uses the same var so the three columns never overflow.
- **Rollback:** untick the preview (or never flip the switch). Code rollback: revert the commit; no data to undo.

## 8. Drafts (not published)

Guide (task-lists-and-projects, "Finding your lists"): "Slate's sidebar is a slim row of icons: Slate, Review, Waiting, Recurring, Search, People, Projects and Clients. Hover an icon for its full name. People, Projects and Clients open a panel beside the icons with the lists, your pinned clients and projects first. Click Pin at the bottom to keep the panel open; Slate remembers your choice. In a narrow window or on a phone, the Lists button still opens every list."

What's new: "Slate's sidebar is now a slim icon rail. People, Projects and Clients open a panel with your lists and pins; Pin keeps it open."

Notice (`slateplus-sidebar`, at launch): title "Slate's new sidebar", body "Icons down the left, lists in a panel beside them. Your pinned clients and projects come first.", button "Show me" (tour below).

Tour (3 stops; every stop is on the rail itself, never inside a floating panel, since a click outside the sidebar closes it): `tk-sidebar` "Icons for every place in Slate. Hover one for its name; the numbers are what's waiting." / the Clients button (`.tkr-item-clients`) "People, Projects and Clients open a panel with the lists. Your pins come first." / the Pin button (`.tkr-pin`) "Pin keeps the panel open beside the icons. Slate remembers it for you."
