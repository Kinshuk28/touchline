import { test, expect } from '@playwright/test';

// Preseason context (season starts 2026-08-16, these tests run before that):
// `/api/live` legitimately returns an empty fixtures array, the landing page
// shows the kickoff countdown instead of a live-scores panel, and `/scores`
// renders its "No matches in progress" state. Every assertion below is
// written to hold in that state *and* to keep holding once real fixtures
// and live matches start appearing — see the per-test notes.

test('landing page renders real data', async ({ page }) => {
  await page.goto('/');
  // Header brand link: "TOUCH" + "LINE" in a child <span>, combined
  // accessible name is "TOUCHLINE". Static chrome — unaffected by season.
  await expect(page.getByRole('link', { name: /TOUCHLINE/i })).toBeVisible();
  // Static section, present regardless of live/preseason state.
  await expect(page.getByRole('heading', { name: /Fantasy — coming soon/i })).toBeVisible();
  // "Next fixtures" is the section heading over the upcoming-fixtures grid.
  // It renders even when the grid itself falls back to "Nothing scheduled.",
  // so this holds both now and once the season is under way.
  await expect(page.getByText('Next fixtures')).toBeVisible();
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
