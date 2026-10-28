# FleetCore design system — "Graphite"

A calm, modern control room that works in daylight and at night: white cards floating on a soft graphite
canvas, one confident **accent** (blue by default) for actions, selection, focus and live state, the purple brand
mark (`--mark` #801AB8: the wheel icon and the nut in the "fleetcore" wordmark, `src/components/brand.tsx`), semantic
status colours, a small set of categorical hues for icons and avatars, and tabular numerals.
Every page must look right in **both** themes.

## Principles

1. **Numbers and names first, words on demand.** A screen shows the figure, the name and the status; the
   explanation of how a number is computed, a second phone number, a plate or an "updated 5 hours ago" waits in a
   tooltip (`InfoTip`, `Tip`, `title`). Only problems earn a visible line of text (a warn/danger `Stat` hint,
   "Pickup within 24 h").
2. **Categorise, then open on click.** Long lists are grouped (alerts by kind, nav by area) and fold open with
   `Disclosure` (native `<details>`); the worst group starts open. Filters beyond a search box sit behind one
   "Filters" button (`FilterMenu`) and show as removable chips once applied. Rarely used sections (an empty chat
   thread, histories, raw details) start folded.
3. **Signal over decoration.** Status colour means something: accent = action/selected/live, green = good,
   orange = caution, red = problem, cyan = informational, violet = in progress. Categorical hues (`hue-1…6`) are
   for identity only — KPI icon tiles, alert categories, avatars — never for status.
4. **Compact.** 13 px tables, 40 px rows, 56 px top bar. Whitespace comes from alignment, not padding.
5. **Numbers are first-class.** Metrics, IDs, money and distances use `num` (tabular figures). Labels, chips and
   table headers are sentence case, never ALL CAPS.
6. **One filled button per view.** The main action is `primary` (a faint top highlight gives it depth);
   everything else is `secondary` or `ghost`.
7. **Soft shapes, a whisper of depth.** Cards `rounded-lg` (14 px) with a 1 px `line` border and `shadow-card`;
   controls 9 px; chips, badges and counts are pills. `shadow-lift` on hover for clickable tiles, `shadow-float`
   only for floating layers.
8. **Motion is quick and quiet.** Pages fade up on navigation (240 ms), menus pop in (140 ms), folds slide
   (200 ms), buttons press. All of it is off for reduced motion.
9. **Tokens only.** Never write `slate-500`, `#fff`, `bg-white`, `text-gray-*`. ESLint will not catch this —
   reviewers will.

## Tokens (Tailwind utilities)

| Role | Utility | Day | Night |
|---|---|---|---|
| Page background | `bg-canvas` | #F3F4F7 | #0B0D12 |
| Card / panel | `bg-surface` | #FFFFFF | #12151C |
| Hover row / table head | `bg-raised` | #F5F6F8 | #1A1E27 |
| Inset / segmented track | `bg-sunken` | #ECEEF2 | #0E1117 |
| Floating layer | `bg-overlay` | #FFFFFF | #171B24 |
| Hairline / strong line | `border-line` / `border-line-strong` | #E7E9EE / #D3D8E0 | #242A35 / #353D4B |
| Text, secondary, tertiary, faint | `text-fg` `-muted` `-subtle` `-faint` | #101828 … #98A2B3 | #F0F2F5 … #545D6C |
| Accent | `bg-accent` `text-accent-text` `bg-accent-soft` | follows the accent choice | |
| Status | `ok` `warn` `danger` `info` `progress` (+ `-soft`) | green, orange, red, cyan, violet | |
| Categorical hues | `bg-hue-N-soft text-hue-N` (N = 1…6) | blue, violet, teal, amber, pink, green | |

Shadows: `shadow-card` (resting), `shadow-lift` (hover), `shadow-float` (menus, drawers).
Typography: Inter by default (Geist and system optional). Page title 22/600, card title 14/600, body 13–14,
table 13, table header 12/500 `text-fg-subtle`, chips 11/500.

## Components

`src/components/ui.tsx`:

- Layout: `PageHeader` (title, short subtitle, actions; the old `eyebrow` prop is ignored — the breadcrumb says
  where you are) · `Card` (title, actions, optional `icon`, `flush`) · `cardClass` for custom panels.
- Numbers: `Stat` (icon tile on the right, hint inline only for warn/danger, else a hover tip) · `IconTile`.
- Status: `Badge` (status → tone via `STATUS_TONE`, pill) · `Chip` (quiet flag pill) · `StatusDot` · `LiveDot`
  · `ExpiryBadge`.
- Disclosure: `InfoTip` (ⓘ with tooltip) · `Tip` (tooltip on anything) · `Disclosure` (row that opens on click;
  share a `name` for accordion behaviour).
- Navigation and filters: `Tabs` (underline + count pill) · `Segmented` and `FilterPills` (track and raised thumb;
  `segmentedTrack`/`segmentedThumb` for client-side variants).
- Data: `Table` (sticky tinted head, hover rows) · `Cell` · `DL` · `Progress` · `Avatar` (initials on a hue picked
  from the name) · `EmptyState`.
- Forms and buttons: `Button`/`LinkButton` (`primary | accent | secondary | ghost | danger | success`, `sm | md`)
  · `Input`/`Select`/`Textarea`/`Field`/`Checkbox` · `Kbd`.

`src/components/filter-menu.tsx`: `FilterMenu` (button with applied count, popover, "Clear all") ·
`FilterField` · `FilterChip`.

Status → tone map lives in one place (`STATUS_TONE`). Add new statuses there, never inline.

## Shell

- **Sidebar** (240 px) on the canvas, no border. A 3 px strip in the company's colour runs along the top, and the
  **company menu** sits in the header: the company badge (coloured initials), its name, your role and account. It
  lists every signed-in account with its companies, plus New company, Add another account and Sign out. Overview,
  Drivers and Reports are plain links; Fleet, Maintenance and Settings fold open on click. The category you are in
  opens by itself; a folded category shows the sum of its counts. The active page is a white pill with an accent
  bar on the guide line. Collapses to a 64 px icon rail that expands on hover (`nav` cookie).
- **Top bar** (56 px): breadcrumb (led by the company name on a phone), search `⌘K`, appearance, alerts, user menu.
  Sticky, `bg-canvas/80` blur.
- **Command palette**: navigation + entity search (active company only) + quick actions + "Switch to …". `⌘K`,
  `↑↓`, `↵`, `esc`; `g` + letter jumps; `Alt+1…9` switches company.
- **Company colour** is identity, not status: badge and strip only, never on buttons, tables or charts.

## Theme mechanics

`<html data-theme="light|dark">` set server-side from the `theme` cookie. **Day is the default**; Night and Auto
are opt-in, and "auto" is resolved by an inline script before paint. Tailwind `dark:` = `[data-theme=dark]`.
Leaflet tiles are muted (Day) or inverted (Night) with a CSS filter. Charts read tokens at runtime.

## Copy

Sentence case everywhere. No exclamation marks in system copy. Buttons are verb-first. Empty states say what to
do next. Errors say what happened and how to fix it. If a sentence explains a number, it belongs in an `InfoTip`.

## Overview layout

The template for summary pages:

1. Greeting and one summary line, one primary action (plus Customize).
2. Six number tiles (`KpiStrip`): coloured icon tile, big number, label; a context line only when something
   needs a look, otherwise it is the hover tip (trucks available, in shop, PM due, paperwork due, driver papers,
   open work orders).
3. Two independent columns. Left: "Today in the shop" (in progress, overdue, booked today, with Start / Complete)
   over the live fleet map. Right (first on a phone): "Needs attention" grouped by kind as an accordion (worst
   first, five items each, "All N in …"), over "Coming up" (the next 30 days of expiries and PM).
4. One costs card: maintenance and fuel by month plus a short metric list (cost per km from odometer readings);
   the chart's explanation is an `InfoTip`.
5. A company with no trucks and no drivers sees a set-up checklist instead (add a truck, a trailer, a driver,
   company documents, invite a teammate).

## Personal appearance

Everyone can tune the look from the palette icon in the top bar (also on My account). Choices live in cookies
(`theme`, `accent`, `density`, `font`, `nav`), so the server renders the first paint with them: no flash.

- **Accent**: blue (default), indigo, violet, teal, green, amber, graphite (`:root[data-accent=…]` in
  `globals.css`, with a Night variant each).
- **Density**: compact (13 px root), default (14 px), roomy (15.5 px). Rem-based spacing and control heights
  scale; text sizes and corner radii stay put.
- **Font**: Inter (default), Geist, or the system UI font.
- **Overview**: "Customize" shows or hides each section (`overview` cookie); hidden sections are not queried.
