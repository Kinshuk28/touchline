# Touchline — Visual Redesign

**Date:** 2026-08-04
**Scope:** Landing page, `/scores`, `/calendar`, shared components, design tokens
**Not in scope:** the data layer. No query, ingestion or schema changes.

---

## Why

The shipped site is functionally correct and visually undifferentiated. Concretely, from the deployed build:

1. The landing hero row leaves ~180px of dead space — a short lead card sharing an equal-height grid row with a tall countdown panel.
2. `news_items.image_url` is populated on every item and never rendered. A football site with no photography reads as unfinished.
3. Lead story, fixture card and filler headline all use the same surface, border, radius and weight. No hierarchy.
4. All six landing fixtures are La Liga with no competition label, so correct data reads as a bug.
5. Crests at 18px are too small to identify, and lazy-load with visible pop-in.
6. `/scores` is twenty rows in one flat list with a large dead gutter between team names and kickoff time.
7. The lime accent appears only on small date labels.

References the owner asked for: **OneFootball** (competition rails, following), **Goal.com** (image-led news grid), **Transfermarkt** (information density).

---

## Direction

The approved "Broadcast" direction stands: dark-first, high contrast, matchday register, lime accent. What changes is execution — density, hierarchy, imagery and typography.

**The organising idea:** football's native form is the *results page* — a time-ordered column of `15:00 ARS 2–1 CHE`. Build from that, not from generic sports cards.

---

## Tokens

Existing tokens are unchanged. Additions:

```css
--surface-2: #1B2027;   /* elevated card, hover state */
--scrim:     rgba(11,14,17,.86);  /* image overlay so text stays AA */
```

**Competition colours** — chosen to read on `#0B0E11`, and deliberately distinct from `--accent` (lime) and `--live` (red), which carry other meanings:

```css
--comp-pl:  #C4A7E7;   /* Premier League */
--comp-pd:  #FF6B6B;   /* La Liga */
--comp-sa:  #4DA3FF;   /* Serie A */
--comp-bl1: #FF9F45;   /* Bundesliga */
--comp-fl1: #7DE2D1;   /* Ligue 1 */
```

Each must be exposed as a Tailwind colour and mapped from `leagues.fd_code`. A league with no mapping falls back to `--muted` — never an invented colour.

Light-theme equivalents must be darkened to hold AA against `#FFFFFF`; state the ratios you land on.

## Type

Three roles, replacing Inter-only:

| Role | Face | Use |
|---|---|---|
| Display | **Archivo** 700/800, tracking `-0.02em` | Headlines, section labels, the wordmark |
| Body | **IBM Plex Sans** 400/500/600 | Prose, UI, team names |
| Data | **IBM Plex Mono** 500/600 | **Every** time, score, league position, countdown |

All three via `next/font/google` with `display: 'swap'`, mapped in the `@theme inline` block so `font-display` / `font-sans` / `font-mono` resolve. The previous build downloaded Inter and never applied it — verify in the built CSS that each face actually resolves.

Mono for data is the deliberate risk: it is authentic to the subject (stadium clocks, teletext results, Transfermarkt tables) and makes numbers scannable. Do not use it for prose.

Scale: `11 / 13 / 15 / 18 / 24 / 32 / 44`. Headlines sit at 32–44 and are the only thing at that size — that is what creates hierarchy.

---

## The signature: the matchday spine

A time-ordered rail, used on the landing page and `/calendar`. It is the one memorable element; everything else stays quiet.

```
┌────┬──────────────────────────────────────────┐
│    │ ▌17:30  [c] Alavés        —  Getafe  [c] │   ▌ = competition colour bar
│ 15 │ ▌19:30  [c] Sevilla       —  Rayo    [c] │
│AUG │ ▌21:00  [c] Betis         —  Sociedad[c] │
├────┼──────────────────────────────────────────┤
│ 16 │ ▌15:00  [c] Racing        —  Villarreal  │
│AUG │ ▌17:00  [c] Espanyol      —  Levante     │
└────┴──────────────────────────────────────────┘
```

- Left rail: day number in Archivo 800 at 24px, month in 11px uppercase muted. Sticky within its group on `/calendar`.
- Each row: a 3px competition colour bar, kickoff time in mono, crest + team either side of an em dash.
- In season the dash is replaced by the score in mono, and a live row gets the red dot plus the word "Live".
- Rows are 44px tall — denser than the current 56px.

## Hero

Replaces the current dead-space row.

- Full-bleed lead story image (`news_items.image_url`) at 16:9, headline overlaid on a bottom-anchored scrim so text holds AA.
- Above it, a single-line **ticker strip**: in preseason, each league and its countdown in mono; in season, live scores. Horizontally scrollable on narrow screens, never wrapping.
- Category pill (Transfer / Injury) sits on the image, not above it.
- If the lead item has no image, fall back to a type-only hero on `--surface-2` — do not render an empty frame or a placeholder graphic.

## News grid

- Every card gets its image at 16:9 with the headline beneath. Cards without an image use a type-only variant at the same footprint, so the grid never gaps.
- Four columns at desktop, two at tablet, one at mobile.
- Source and age in mono at 11px.

## Transfers rail

We have 18 transfer-tagged items and no dedicated surface for them. Add a dense Transfermarkt-style block: one line per story, competition colour dot, headline, source, age. No images — the density is the point, and it contrasts with the image grid above it.

## `/scores`

- Group by competition, each with a coloured header bar and crest count.
- Use the same 44px row as the spine; teams either side of the score/time, no dead gutter.
- Crests at 28px, `loading="eager"` for the first screenful so they do not pop in.
- The preseason empty state names the next fixture and its countdown — it is the primary view until 2026-08-16, not a fallback.

## `/calendar`

- Day-grouped using the spine, with a sticky day rail.
- Competition colour bars carry the league identity, so the redundant right-hand league name column goes.

---

## Following (cookie)

`localStorage` cannot be read server-side, so a followed-leagues **cookie** lets the server render the user's preference on first paint with no flash. That is the whole reason for using a cookie here.

- Cookie `touchline-following`, value a comma-separated list of league codes, `SameSite=Lax`, `Path=/`, 1 year, **not** `HttpOnly` (the client toggles it).
- Set only by explicit user action — a "Follow" toggle on each competition.
- When set and no `?leagues=` is present, the landing ticker and `/scores` default to those competitions. An explicit `?leagues=` in the URL always wins, so shared links stay predictable.
- **Strictly a functional preference.** No tracking, no identifiers, no third-party cookies, no analytics. Therefore no consent banner — and it must stay that way.
- Following nothing is the default and must behave exactly like today.

---

## Quality floor

- Responsive to 360px. The spine collapses its rail to a single date line on mobile.
- All text AA in both themes, including over the hero scrim — state measured ratios.
- Visible keyboard focus on every control; the Follow toggle is a real `<button>` with `aria-pressed`.
- `prefers-reduced-motion` respected; motion is limited to hover transitions and one hero image scale — no scroll-jacking, no parallax, no entrance animations on every card.
- Competition colour is never the *only* carrier of meaning — the league name is always present as text somewhere in the group.
- No new dependencies. No UI library, icon pack, animation library or CSS framework beyond Tailwind v4.

## Out of scope

Data-layer changes of any kind. `/team/[slug]` and other B2 routes. The `/status` page.
