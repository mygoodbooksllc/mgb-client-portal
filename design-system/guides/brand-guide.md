<!-- Brand guide for the MyGoodBooks design system. Copied from the "MyGoodBooks"
Design System artifact (claude.ai/artifact/ARYpfcrCbFgFxJnbm1xqLx) on 2026-09-27;
that artifact is the source of truth for this text. -->

# MyGoodBooks

MyGoodBooks is bookkeeping for churches and small nonprofits. The people reading this product are not accountants — they are a treasurer, an executive pastor, a board member who was handed the finance folder. The design has one job: make a set of numbers they are anxious about feel legible and calm.

That is where the whole visual language comes from. Deep navy and warm gold on a cream ground, a serif for headings and a humanist sans for figures — the register of a well-kept ledger, not a fintech dashboard. Surfaces are flat and opaque, separated by a hairline border, over a ground ruled like ledger paper. The warmth is doing real work: it is what keeps a page of variance figures from reading as a bill.

**This is the product after the calm redesign.** An earlier version of this interface floated frosted-glass cards over a mesh of slowly drifting colour blobs, lifted them on hover and swept a shimmer across them. All of that is retired. What is written below is the current system; where a retired treatment left a token or a class behind, it is marked.

## Principles

**Warm, not corporate.** The ground is cream, not white; the neutrals are warm-biased all the way down. If a screen starts looking grey and institutional, the warm tokens have been swapped for plain neutrals somewhere.

**Calm about money.** Green and red exist, but they are muted — `#3f6b52` and `#a4442c`, not alarm colours. A budget overrun is information, not a siren. Never escalate a financial state with motion, size or saturation beyond what the pills and rings already do.

**Colour is never the only signal.** Every trend carries an arrow, every ring carries a status word, every donut segment carries a legend row with its own amount. A reader who cannot tell the green from the red loses nothing.

**Say when the number is not real.** Sample, prototype or projected figures get a MockBanner. In a product about someone's actual ledger, an unlabeled fake number is a correctness bug.

**Serif heads, sans figures.** Bitter carries headings and status words; IBM Plex Sans carries body copy *and* large numbers; IBM Plex Mono carries anything that has to line up in a column. The KPI value being sans, not serif, is deliberate — figures read cleaner in the body face.

## Foundations

### Colour

The palette has three layers, and mixing them up is the fastest way to break a screen.

- **Chrome** — `navy`, `navy-deep`, `sidebar-bg`. Dark furniture: the sidebar, primary buttons, toasts. White ink sits on it in both themes, so chrome does not flip. Light-mode `navy` is a near-black `#05080d`, not the mid navy the brand started on: `#243746` was the original mygoodbooks.org value and was darkened on 2026-09-15. That older hue is still in the product on purpose — as `chart-income`, and inside the `shadow` and `tint-on-surface` alphas — but it is no longer `navy`.
- **Ink** — `ink-strong`, `text`, `text-muted`. `ink-strong` exists because navy plays two opposite roles: dark chrome and dark ink on a light surface. Only the ink role may flip in dark mode. **Use `ink-strong` for headings; never `navy`.**
- **Signal** — `good`/`good-soft`, `bad`/`bad-soft`, `warm-*`, and the two chart series. Each is a soft ground plus an ink that clears 4.5:1 on it in both themes.

`accent` aliases `gold` — reach for `accent` in product code so a rebrand moves one value. Gold itself is the one colour identical in both themes.

Dark mode is a genuine re-pitch, not an inversion: the navy shifts green (`#1f2a24`), the ground goes near-black (`#0f1512`), shadows drop their tint for long black spreads, and `chart-income` becomes a light blue because a navy series is invisible on a dark card. Two tokens change meaning rather than value — `selected-outline` rings in gold instead of near-white, and the referral panel tints *lighter* than the page instead of darker. Both are noted in their `usage`.

The ground is flat `bg` with one thing on it: a faint spreadsheet ruling, `grid-line`, on a `grid-cell-w` x `grid-cell-h` cell (92x30px). Wider than tall on purpose — square cells read as a table someone might try to click into, ledger proportions read as paper. It is texture, not furniture, and dark mode needs a warm *light* line rather than the same alpha, since a dark line at 3% is invisible on a near-black ground.

The three mesh blob tokens are **gone**, along with `opacity-mesh`. Two other tokens survive as aliases only: `glass-bg` now resolves to `surface` and `glass-border` to `border`, so any call site still asking for glass renders as an ordinary opaque panel. Don't reach for either in new work.

The one ink pair the calm pass added is `on-gold` / `on-gold-deep` — for text sitting *on* a solid gold fill, which is the one case where neither `ink-strong` nor `text` is right.

### Type

Bitter for display, IBM Plex Sans for everything else, IBM Plex Mono for tabular figures — all three from Google Fonts, so there are no font files to ship. Page titles run 32px/800 at −0.02em tracking; the italic serif subtitle beneath them is the house voice and should survive any redesign. Muted ink has a floor of 12.5px.

### Space, radius, elevation

Spacing is a loose 4px scale; **20px is the card padding and the step you reach for by default**. Radius is effectively binary: 12px for cards and panels, `999px` for everything interactive or status-bearing. Every button, pill, badge and bar in the product is a pill — a square corner on a control is off-system.

**Elevation is all but gone.** `shadow` is a hairline in light mode and `none` in dark; `shadow-hover` is identical to it and exists only so old call sites resolve. Surfaces are separated by their border, not by depth. If something is hard to pick out, fix the border — do not reintroduce a shadow. The coloured drop that used to sit under a primary button is gone too.

### Surfaces

Cards are opaque `surface` panels with a 1px `border`. Two rules:

1. Never nest cards — two borders a few pixels apart read as a mistake, not as hierarchy.
2. Anything layered over content — a donut hole, a popover over a table — also uses `surface`. There is no second, translucent surface treatment any more.

### Motion

Almost none, and that is the point. What is left: 200ms colour transitions on buttons, a 1px lift on a secondary button's hover, and a 200ms toast rise. The card hover lift, the card shimmer and the mesh drift were all removed. Figures are set in tabular numerals so a column of them does not shift as values update. Anything still animated is disabled under `prefers-reduced-motion`.

### Iconography

Thirty-one line icons, in the **Icons** asset group. They were drawn for this product rather than adopted from a set, which is why they cover things a general library does not — a client roster, stacked bills, a gift heart for restricted giving, a flask for the prototype advisory.

All of them are 24x24, `fill="none"`, round caps and joins, stroke weight 1.8 (a few at 1.6 where the shape is dense). That shared weight and corner treatment is what makes them read as one family despite having been drawn one at a time. **Render at 16px**; a few dense rows use 15. Never scale one past 24 — the 1.8 stroke starts to look drawn-on.

In product code each icon is inline SVG with `stroke="currentColor"`, so it takes `--text-muted` by default or the signal colour of its context. The files in the asset group are baked to `#7a7369` instead, because a shipped `.svg` renders through `<img>` where `currentColor` resolves to black and would vanish on the dark theme; that mid-tone was picked to hold up on both grounds. Inline them and give the stroke back to `currentColor`. The group's README covers this.

An icon is never the sole carrier of a state — pair it with a word, a pill or a number.

Alongside them the product still draws its own one-off shapes in SVG (the runway ring, the bar chart, the donut) and uses a couple of emoji inline (🧪 in the advisory banner).
