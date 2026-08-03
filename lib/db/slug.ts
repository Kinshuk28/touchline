export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `slugify(name)` suffixed with a stable numeric id -- the convention every
 * `players` row already uses (`slug` is `unique not null`) so that two
 * players who happen to share a slugified name never collide. `teams.slug`
 * carries the identical `unique not null` constraint but, until this fix,
 * `scripts/backfill.ts` and `scripts/ingest/squads.ts` wrote team slugs as
 * plain `slugify(team.name)` with no suffix at all. No collision exists
 * across the current ~110 clubs, but it is not guaranteed to stay that way
 * as promotion/relegation churn introduces new clubs over time -- and unlike
 * a one-off failure, a slug collision aborts the *entire* `upsertTeams`
 * batch (Postgres rejects the whole upsert on a unique-constraint conflict),
 * silently dropping every other team in that call too.
 *
 * Centralised here, rather than inlined as `${slugify(x)}-${y}` at each call
 * site (the pattern this replaces), so the convention is defined once and
 * is independently testable.
 */
export function slugWithFdId(name: string, fdId: number): string {
  return `${slugify(name)}-${fdId}`;
}
