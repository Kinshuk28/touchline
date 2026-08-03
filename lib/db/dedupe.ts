/**
 * Collapses rows that share the same key, keeping the last occurrence.
 *
 * Postgres rejects a single `INSERT ... ON CONFLICT DO UPDATE` statement
 * that contains two rows mapping to the same conflict target — it fails the
 * *entire* statement with "ON CONFLICT DO UPDATE command cannot affect row
 * a second time", not just the duplicate. Every bulk upsert in the
 * repository layer is exposed to this whenever its input can legitimately
 * contain the same natural key twice — e.g. a player who appears in two
 * clubs' squads because they transferred mid-window, or a provider data
 * quirk. This surfaced live in the phase-a backfill: `upsertPlayersByFdId`
 * received the full ~2,500-row squad batch in one call, one repeated
 * `fd_id` in it, and Postgres rejected the whole batch — zero players
 * written.
 *
 * `dedupeByKey` removes that hazard once, at the point every upsert already
 * funnels through, instead of requiring every call site to know about a
 * Postgres constraint and pre-dedupe its own input.
 *
 * Last occurrence wins: callers pass rows in the order they were collected,
 * and later data is assumed to be at least as fresh as earlier data.
 */
export function dedupeByKey<T>(rows: readonly T[], keyOf: (row: T) => string | number): T[] {
  const byKey = new Map<string | number, T>();
  for (const row of rows) {
    byKey.set(keyOf(row), row);
  }
  return [...byKey.values()];
}
