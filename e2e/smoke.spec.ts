import { test, expect } from '@playwright/test';

// Preseason context (season starts 2026-08-16, these tests run before that):
// `/api/live` legitimately returns an empty fixtures array, the landing page
// shows the kickoff countdown instead of a live-scores panel, and `/scores`
// renders its "No matches in progress" state. Every assertion below is
// written to hold in that state *and* to keep holding once real fixtures
// and live matches start appearing — see the per-test notes.

// The landing page is a dashboard now, not an article
// (docs/superpowers/specs/2026-08-04-landing-dashboard-handoff.md): a
// ticker over three asymmetric columns — fixtures, table + transfers, news
// — with no hero. These assertions are written against that board's own
// structure rather than being loosened to whatever both layouts happened to
// share.
test('the landing board renders its three columns of real data', async ({ page }) => {
  await page.goto('/');
  // Header brand link: the corner-arc mark (components/Mark.tsx) is
  // aria-hidden, so the accessible name is still just "TOUCHLINE".
  await expect(page.getByRole('link', { name: /TOUCHLINE/i })).toBeVisible();

  // Panel headings (components/BoardPanel.tsx renders each as an <h2>).
  // The fixture panel's heading is derived from when its earliest fixture
  // actually is (lib/site/boardLabels.ts) — "Next up" in preseason, "This
  // weekend" or "Today" in season, "Fixtures" if nothing is scheduled — so
  // this matches the set rather than pinning one, and still proves the
  // panel rendered.
  await expect(page.getByRole('heading', { name: /^(Today|This weekend|Next up|Fixtures)$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Table', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Latest', exact: true })).toBeVisible();

  // Real rows, not just chrome: the fixture spine tags each row with its
  // fixture id, and the table panel names its competition in text (never
  // colour alone).
  await expect(page.locator('[data-fixture-id]').first()).toBeVisible();
  await expect(page.getByText('Premier League').first()).toBeVisible();

  // The Fantasy line survives the rebuild as a single strip — it is a
  // product statement, not a section (the board's argument is density). It
  // stopped saying "In development" when the picker shipped: the teaser now
  // links to it, and a teaser whose call to action is a dead end is the
  // thing this assertion exists to catch.
  await expect(page.getByRole('link', { name: /Pick your squad/i })).toBeVisible();
});

// The board's table panel is competition-switchable via `?table=`, the same
// query-string mechanism `/scores` uses for `?leagues=` — so the choice
// survives a reload with no client state. This asserts the server honoured
// the param: the La Liga tab comes back marked current, and the panel names
// La Liga in text.
test('the landing table panel switches competition from the query string', async ({ page }) => {
  await page.goto('/?table=PD');
  await expect(page.getByRole('link', { name: /PD — La Liga/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText(/^La Liga/).first()).toBeVisible();
});

test('the News and Transfers routes are reachable from the header nav and render', async ({ page }) => {
  // Scoped to the header's own nav landmark, not the whole page. Playwright
  // matches an accessible name by substring, so an unscoped
  // `link, name: 'Transfers'` also matches any headline containing the word
  // — which is exactly what a transfers rail full of live transfer stories
  // produces ("strict mode violation: resolved to 2 elements", CI, 2026-08-07).
  // Scoping is what the test always meant: this is about the header nav.
  const nav = page.getByRole('navigation', { name: 'Primary' });

  await page.goto('/');
  await nav.getByRole('link', { name: 'News' }).click();
  await expect(page).toHaveURL(/\/news$/);
  await expect(page.getByRole('heading', { name: 'News' })).toBeVisible();

  await page.goto('/');
  await nav.getByRole('link', { name: 'Transfers' }).click();
  await expect(page).toHaveURL(/\/transfers$/);
  await expect(page.getByRole('heading', { name: 'Transfers' })).toBeVisible();
  // Honest labelling (spec): these are aggregated reports, not confirmed deals.
  await expect(page.getByText(/not confirmed deals/i)).toBeVisible();
});

// This is the test that matters: it proves the product requirement "when a
// user hits refresh on a particular page, don't reset everything." A hard
// `page.reload()` discards all in-memory JS state, so if the selected
// league only lived in React state, the server would have no way to know
// about it and would re-render the unfiltered page. `/scores` instead
// derives `selected` from the `?leagues=` search param on the server
// (app/scores/page.tsx), so the filter is durable across a real reload.
//
// Note on what each assertion actually proves: a reload never changes the
// URL by itself, so re-asserting the URL after `page.reload()` mostly
// documents intent. The assertion that actually discriminates a
// URL-backed filter from a React-state-only one is the final one: it
// only passes if the *server*, given nothing but the reloaded URL, chose
// to mark "La Liga" as the active pill again.
test('a filter survives a hard refresh', async ({ page }) => {
  await page.goto('/scores');
  await page.getByRole('link', { name: 'La Liga' }).click();
  await expect(page).toHaveURL(/leagues=PD/);
  await page.reload();
  await expect(page).toHaveURL(/leagues=PD/);
  await expect(page.getByRole('link', { name: 'La Liga' })).toHaveAttribute('aria-current', 'true');
});

test('the calendar exports a valid ics file', async ({ request }) => {
  const res = await request.get('/api/calendar.ics');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');
  const body = await res.text();
  expect(body.startsWith('BEGIN:VCALENDAR')).toBe(true);
});

// Preseason: `fixtures` is legitimately `[]` today (zero live matches until
// 2026-08-16). This only asserts the response shape, so it keeps passing
// once real fixtures start populating the array.
test('the live endpoint answers with a fixture array', async ({ request }) => {
  const res = await request.get('/api/live');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.fixtures)).toBe(true);
});

test('the Clubs route is reachable from the header nav and groups clubs by competition', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Clubs' }).click();
  await expect(page).toHaveURL(/\/clubs$/);
  await expect(page.getByRole('heading', { name: 'Clubs', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Premier League' })).toBeVisible();
  // The 14 clubs no longer in a current top-five competition get their own
  // clearly-labelled group rather than being silently dropped or folded
  // into their old league's group (Direction Two spec: "honest handling").
  await expect(page.getByRole('heading', { name: /Not in a top-five league this season/i })).toBeVisible();
  // Cards link to the club page now that `/team/[slug]` exists — the
  // inverse of what this asserted while it didn't, and the reason that
  // assertion was written in the first place (no dead links).
  await expect(page.getByRole('link', { name: /Manchester City/i }).first()).toBeVisible();
});

// `/team/[slug]` — the route every crest on the site now points at.
test('a club page renders that club\'s own fixtures, squad and identity', async ({ page }) => {
  await page.goto('/clubs');
  await page.getByRole('link', { name: /Manchester City/i }).first().click();
  await expect(page).toHaveURL(/\/team\/[a-z0-9-]+$/);

  await expect(page.getByRole('heading', { level: 1, name: /Manchester City/i })).toBeVisible();
  // Panels the page always renders, whatever the season state.
  await expect(page.getByRole('heading', { name: 'Next up', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
  // Real rows, not just chrome: every fixture the spine draws is tagged
  // with its id, and this club has fixtures in the stored data.
  await expect(page.locator('[data-fixture-id]').first()).toBeVisible();
});

test('an unknown club slug is a 404, not a crash', async ({ page }) => {
  const res = await page.goto('/team/not-a-real-club');
  expect(res?.status()).toBe(404);
});

// `/player/[slug]` — reached from a club's squad list, which rendered as
// plain text until this route existed.
test('a squad name opens that player\'s page', async ({ page }) => {
  await page.goto('/clubs');
  await page.getByRole('link', { name: /Manchester City/i }).first().click();
  const squadPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Squad', exact: true }) });
  const firstPlayer = squadPanel.getByRole('link').first();
  const playerName = (await firstPlayer.textContent())?.trim() ?? '';
  await firstPlayer.click();

  await expect(page).toHaveURL(/\/player\/[a-z0-9-]+$/);
  await expect(page.getByRole('heading', { level: 1, name: playerName })).toBeVisible();
  // The club is named and links back — a player page that doesn't say who
  // they play for is a dead end of a different kind.
  await expect(page.getByRole('link', { name: /Manchester City/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Season stats', exact: true })).toBeVisible();
});

test('an unknown player slug is a 404, not a crash', async ({ page }) => {
  const res = await page.goto('/player/not-a-real-player');
  expect(res?.status()).toBe(404);
});

// `/search` is a plain GET form: the results page is a URL, so it survives
// a reload and can be shared — the same property `?leagues=` gives /scores.
test('search finds a club by name and the result URL is shareable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/search$/);

  await page.getByRole('searchbox').fill('manchester');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/search\?q=manchester/);
  await expect(page.getByRole('heading', { name: 'Clubs', exact: true })).toBeVisible();

  // Straight to the club page from a result.
  await page.getByRole('link', { name: /Manchester City/i }).first().click();
  await expect(page).toHaveURL(/\/team\/[a-z0-9-]+$/);
});

test('search says so when nothing matches, rather than rendering an empty page', async ({ page }) => {
  await page.goto('/search?q=zzzznotaclub');
  await expect(page.getByText(/Nothing matches/i)).toBeVisible();
  // And a query too short to be useful is refused with a reason.
  await page.goto('/search?q=a');
  await expect(page.getByText(/at least 2 characters/i)).toBeVisible();
});

// `/status` is the page that answers "is the data still arriving?" — the
// one question no other route can answer, since stale data still renders.
test('the status page reports ingest health and data freshness', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'Status', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ingest jobs', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Data freshness', exact: true })).toBeVisible();
  // The freshness panel names each table *and* the timestamp column it
  // read. That pairing is the assertion, not decoration: the columns
  // genuinely differ — news_items is written once and never revised, so it
  // has created_at and no updated_at — and reading the wrong one is a hard
  // Postgres error that took the whole build down (CI, 2026-08-07).
  await expect(page.getByText('news_items')).toBeVisible();
  await expect(page.getByText('created_at')).toBeVisible();
  await expect(page.getByText('updated_at').first()).toBeVisible();
});

// The fantasy game is the site's first signed-in surface. Everything below
// the sign-in page needs a session, which an anonymous smoke run does not
// have — so what is asserted here is exactly the part that must work for
// someone arriving with no account: the route exists, it does not leak a
// squad, and it offers a way in.
test('the Fantasy route sends a signed-out visitor to sign in', async ({ page }) => {
  await page.goto('/fantasy');
  await expect(page).toHaveURL(/\/fantasy\/sign-in$/);

  // One email field and no password field anywhere — magic links are the
  // whole account surface, and a password box appearing here would mean
  // something had been added that stores one.
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Email me a link/i })).toBeVisible();
});

test('the Fantasy route is reachable from the header nav', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('link', { name: 'Fantasy' }).click();
  await expect(page).toHaveURL(/\/fantasy(\/sign-in)?$/);
});

// Leagues sit behind the same sign-in wall as the squad. An anonymous smoke
// run can assert exactly that, and it is worth asserting: a leagues page that
// rendered anything at all to a signed-out visitor would be leaking one
// person's league membership to everyone.
test('the Leagues route sends a signed-out visitor to sign in', async ({ page }) => {
  await page.goto('/fantasy/leagues');
  await expect(page).toHaveURL(/\/fantasy\/sign-in$/);
});

test('an individual league is not readable signed out', async ({ page }) => {
  await page.goto('/fantasy/leagues/00000000-0000-0000-0000-000000000000');
  await expect(page).toHaveURL(/\/fantasy\/sign-in$/);
});
