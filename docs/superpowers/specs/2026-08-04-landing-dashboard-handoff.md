# Touchline — Landing Page Dashboard Rebuild (handoff)

**Date:** 2026-08-04
**Status:** built. `app/page.tsx` implements the ticker/fixtures/table/transfers/news board this spec describes.
**Scope:** `app/page.tsx` and supporting components. No data-layer changes.

---

## Start here

Repo: `~/Desktop/Claude/football-app`, GitHub `Kinshuk28/touchline`, deployed at `football-touchline.netlify.app` via Netlify auto-deploy from `main`.

State: `main` = `1c6aa61`, clean, **428 tests passing / 8 skipped**, typecheck + build + 7/7 Playwright all green. That commit is what is live.

Read first:
- `docs/superpowers/specs/2026-08-04-touchline-direction-two.md` — palette, club-colour system, football vernacular. **Still applies.** This rebuild changes composition, not the colour system.
- `.superpowers/sdd/progress.md` — full execution ledger, every defect found and fixed across both phases. Gitignored but present locally.

---

## Why this rebuild

The owner has said three times that the design isn't good. Two rounds of palette and typography work did not fix it, and the diagnosis is now clear:

**The problem is structure, not surface.** The landing page is the generic content-site skeleton — header, full-width hero image, section label, list, section label, card grid. That shape reads as templated regardless of how it is coloured. Palette work cannot fix composition.

Agreed with the owner: **kill the hero, make the front page a dense scannable board of the weekend.** Information-first, closer to FlashScore or Transfermarkt than to a blog. Someone checking in for ten seconds should see fixtures, standings and headlines at once, without scrolling.

---

## Target structure

```
┌ ticker: PL 16d 10h · PD 10d 9h · SA 17d 8h · BL1 23d · FL1 16d ┐
├──────────────────────────┬──────────────────┬──────────────────┤
│ THIS WEEKEND             │ TABLE            │ LATEST           │
│ matchday spine, dense,   │ compact standings│ narrow rail:     │
│ ~12 fixtures             │ top 6 + link     │ headline, source,│
│                          ├──────────────────┤ small thumbnail  │
│                          │ TRANSFERS        │ ~8 items         │
│                          │ dense one-liners │                  │
└──────────────────────────┴──────────────────┴──────────────────┘
```

- **No hero image. No full-bleed anything.** Density is the point.
- Asymmetric widths — fixtures widest, table/transfers middle, news narrowest. Not three equal columns.
- Two columns at tablet, one at mobile, reading order fixtures → table → news.
- **Everything meaningful above the fold at 1440×900.** That is the acceptance test.

Reuse `MatchdaySpine`, `StandingsTable` (a compact variant is fine), `TransfersRail`. Build a new compact news rail — `NewsCard` is too large for this.

---

## Four defects to fix in the same pass

**1. News relevance — the worst content bug.** The deployed hero currently leads with *"Vozinha granted shirt name exemption by Chile FA"*. The feeds are global football; the site is top-five-leagues only. Nothing filters for relevance.

Fix: a headline is relevant if it mentions one of the 110 stored clubs (`teams.name`, `short_name`, `tla`). **Word-boundary matching, never substring** — this project has shipped that bug twice ("nice" inside "Hornicek", "acl" inside "spectacle"). Prefer relevant items wherever news appears; fall back to recency when nothing is relevant, never an empty rail. Pure function, unit-tested.

**2. Fixture rows have large horizontal voids** at 1440px — content clustered centre, emptiness either side. May resolve inside a narrower dashboard column; verify at the real width.

**3. The turf green reads as grey-black.** The concept did not survive the screen. Either push saturation until it genuinely reads as turf, or abandon it and pick a defensible ground. State which and why.

**4. No identity mark.** The wordmark is plain text. Add one small restrained mark from football's own geometry — a corner arc, centre circle, goal frame — in CSS or inline SVG. No emoji, no icon library.

---

## Constraints

- No new dependencies. Tailwind v4 only; keep the three fonts (Archivo / IBM Plex Sans / IBM Plex Mono).
- **Never invent data.** Nulls omitted, never faked. No placeholder imagery.
- Club colour is never the sole carrier of meaning; club names always present as text.
- All text AA in both themes.
- Responsive to 360px; visible keyboard focus; `prefers-reduced-motion` respected.
- The other six routes keep working. The league filter stays in the query string; `?leagues=XYZ` matches nothing.
- `lib/site/` and `app/` must not import from `lib/db/` or `lib/ingest/`.
- Node 24, ESM, TypeScript strict with `noUncheckedIndexedAccess`.
- Never read, print or commit anything from `.env.local`.

## Working advice, learned the hard way this session

- **Commit after each discrete piece.** Three agents died mid-task here and one lost ~180k tokens of work by not committing.
- **Look at the result.** Every design problem in this project was found by screenshotting the built site, never by reading code.
- Some E2E specs assert on the old landing structure — update them to match the new one rather than weakening what they prove.
- Run long jobs in the foreground of your own shell. Backgrounding and handing back gets the shell reaped.

---

## Outstanding elsewhere (not this task)

- `ingest-players` has a fix on `main` for the Nottingham Forest orphaning (FPL says `Nott'm Forest`, we store `Nottingham Forest FC`). **Needs one manual re-run** from the Actions tab to clear ~23 orphaned players.
- The live path has never run against a real match. **Season opens 2026-08-16.** First-matchday risks are listed in `.superpowers/sdd/progress.md`.
- Phase B2 remains: `/team/[slug]`, `/player/[slug]`, `/search`, `/status`, and populating `news_items.league_id` / `team_ids` so news can filter by club.
