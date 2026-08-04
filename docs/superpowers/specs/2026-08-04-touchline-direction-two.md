# Touchline — Direction Two

**Date:** 2026-08-04
**Supersedes:** the "Broadcast" direction for all visual decisions. Data layer unchanged.

---

## Why change

The owner's verdict on the deployed site: *"looking like AI slop."* That is a fair reading, and it is diagnosable rather than vague.

**Near-black background + one bright acid accent is a default, not a choice.** It is among the most common looks in AI-generated design, and it arrives regardless of subject. Ours was picked from a mockup, but nothing about it is specific to football — swap the words and it could be a crypto dashboard or a dev tool.

The second failure: we are sitting on football-specific data and rendering none of it.

| Data | Rows | Currently rendered |
|---|---|---|
| `teams.club_colors` — "Claret / Sky Blue", "Red / Black" | 96 / 110 | **nowhere** |
| `teams.venue` — "Estadio Santiago Bernabéu" | 96 / 110 | **nowhere** |
| `standings` — full league tables | 192 | **nowhere** |
| `teams` — 110 clubs with crests | 110 | no club pages |

A football site with no league table is not a football site.

---

## The direction

**Ground the palette in the game's own materials, and let club colour be the only chroma.**

- **Turf, not void.** The ground is a deep, desaturated pitch green-black, not neutral #0B0E11. Football at night under floodlights, not a generic dark theme.
- **Chalk, not white.** Text and rules are a slightly warm off-white, the colour of pitch markings.
- **No house accent colour.** This is the important move. Delete the single lime accent. **Club colours, drawn from `club_colors`, are the accent system** — every fixture, club and table row carries its own team's real colours. That is impossible to mistake for a template, because it is generated from the subject's own data.
- **Line work as structure.** Hairline chalk rules, and the geometry of pitch markings — the penalty arc, the centre circle, the halfway line — used as structural devices at low contrast, never as decoration.

### Tokens

```css
--turf:      #0C1512;   /* ground */
--turf-2:    #121C18;   /* raised surface */
--turf-3:    #18241F;   /* hover / elevated */
--chalk:     #EEF2ED;   /* primary text */
--chalk-dim: #93A099;   /* secondary text */
--line:      #23322B;   /* hairline rules */
--live:      #FF4438;   /* live only — never decorative */
```

Light theme is **paper**: a warm off-white ground (#F7F5F0), ink #121A16, the same club-colour accents. Matchday programme rather than inverted dark mode.

Competition colours stay for league identity, retuned for the new ground.

### Club colour

`club_colors` is free text: `"Claret / Sky Blue"`, `"Red / White"`, `"Royal Blue / White"`. Parse it into one or two hex values via a named-colour lookup. Rules:

- An unparseable or missing value falls back to `--chalk-dim`. **Never invent a club's colours.**
- Two colours render as a two-stop bar or stripe — the kit reference is the point.
- Contrast is enforced at render: if a parsed colour fails AA against the ground, use it only as a bar or fill, never as text.

Report how many of the 110 clubs parse successfully.

---

## Structure: more sections, less on each

The landing page is doing too much. Split it.

| Route | Contents | Status |
|---|---|---|
| `/` | Lead story, ticker, 8 selected fixtures, 4 headlines, 6 transfer lines — **and nothing else** | trim |
| `/scores` | Live and upcoming by competition | exists |
| `/calendar` | Fixture calendar, .ics | exists |
| `/news` | Full feed | exists |
| `/transfers` | Transfer-tagged feed | exists |
| **`/tables`** | **League tables — new.** 192 rows already ingested | **build** |
| **`/clubs`** | **All 110 clubs — new.** Crest, colours, venue, competition | **build** |

**`/tables`:** one table per competition, tabbed or stacked. Season 2026 exists but is all zeros at matchday 1, so **show the completed 2025-26 table by default, clearly labelled as last season**, with the current table available and honestly marked as not yet played. Position in mono; club colour bar on each row; promotion/relegation boundaries marked with rules, not colour alone.

**`/clubs`:** grouped by competition. Each club shows crest, name, its parsed colours, and venue. Cards link nowhere for now — `/team/[slug]` is a later phase — so do not render dead links.

---

## Dynamic imagery and backgrounds

- **Hero:** the lead story's image, with a wash derived from the story's competition (or neutral if unknown) rather than a flat scrim.
- **Fixture rows:** a two-stop gradient bar from the two clubs' colours, at low opacity, running the row's left edge. Real data, per match, different every time.
- **Club cards:** the club's own colours as a background wash behind the crest.
- **Ambient pitch geometry:** a single, very low-contrast pitch-marking motif behind the hero and the tables header. One place each, not everywhere.

Every image keeps its monogram fallback. No generated imagery, no stock photography, no gradient meshes.

---

## Football vernacular

Use the game's own language and data, not generic app copy:

- **Venue names** on fixture rows and club cards — we have them for 96 clubs.
- **"Matchday 1"** rather than "Round 1" where `matchday` exists.
- **Kickoff times** stay mono. **"FT"**, **"HT"**, **"Postp."** as status labels.
- Table columns use the real abbreviations: **P W D L GF GA GD Pts**.
- **Form** as a W/D/L strip where `standings.form` exists.

---

## Quality floor

- Responsive to 360px; visible keyboard focus; `prefers-reduced-motion` respected.
- All text AA in both themes — state measured ratios.
- Club colour is **never** the sole carrier of meaning; the club name is always present as text.
- No new dependencies. No UI library, icon pack, animation library, or CSS framework beyond Tailwind v4.
- **Never invent data.** Unparseable colours, missing venues and null stats are omitted, never faked.

## Out of scope

Data-layer changes. `/team/[slug]` and `/player/[slug]`. The `/status` page.
