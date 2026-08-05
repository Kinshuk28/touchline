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
  // product statement, not a section (the board's argument is density).
  await expect(page.getByText(/In development/i)).toBeVisible();
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
  await page.goto('/');
  await page.getByRole('link', { name: 'News' }).click();
  await expect(page).toHaveURL(/\/news$/);
  await expect(page.getByRole('heading', { name: 'News' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: 'Transfers' }).click();
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
  await page.getByRole('link', { name: 'Clubs', exact: true }).click();
  await expect(page).toHaveURL(/\/clubs$/);
  await expect(page.getByRole('heading', { name: 'Clubs', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Premier League' })).toBeVisible();
  // The 14 clubs no longer in a current top-five competition get their own
  // clearly-labelled group rather than being silently dropped or folded
  // into their old league's group (Direction Two spec: "honest handling").
  await expect(page.getByRole('heading', { name: /Not in a top-five league this season/i })).toBeVisible();
  // Cards must not link anywhere — `/team/[slug]` doesn't exist yet, and a
  // club crest/name pair rendered as an <a> here would be a guaranteed
  // dead link, the exact bug this route's spec calls out by name.
  await expect(page.getByRole('link', { name: /Real Madrid|Manchester City|Bayern/i })).toHaveCount(0);
});

test('the theme toggle persists across a reload', async ({ page }) => {
  await page.goto('/');
  // ThemeToggle renders '·' until its mount effect resolves the theme
  // (from localStorage or matchMedia) into React state; wait past that so
  // "before" reflects the resolved theme rather than the placeholder.
  // This matters because that effect only ever sets component state — it
  // never itself writes `document.documentElement.dataset.theme` (only the
  // pre-hydration bootstrap script in app/layout.tsx and the toggle's own
  // click handler do), so there is no DOM race here to guard against, but
  // waiting for a resolved label keeps the test asserting on the real
  // post-hydration theme rather than an incidental mount-order artifact.
  const toggle = page.getByRole('button', { name: /Switch to/ });
  await expect(toggle).not.toHaveText('·');
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? 'unset');
  await toggle.click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
});
