import { getLeagues } from '@/lib/site/queries/leagues';
import { getLiveAndRecent, getUpcoming } from '@/lib/site/queries/fixtures';
import { parseLeagueCodes, resolveLeagueIds } from '@/lib/site/leagueFilter';
import { LeagueFilter } from '@/components/LeagueFilter';
import { ScoreRow } from '@/components/ScoreRow';
import { LiveScores } from '@/components/LiveScores';
import { formatKickoffTime } from '@/lib/site/format';
import { scoreCellText } from '@/lib/site/scoreDisplay';

// Inert today: reading `searchParams` below forces this whole route to
// dynamic rendering, so Next.js never applies a segment-level `revalidate`
// to it (confirmed in .superpowers/sdd/task-6-report.md — the route still
// renders `ƒ` dynamic under `next build` with zero DB credentials, meaning
// the page body never runs at build time). Left in as documented intent: if
// `searchParams` usage is ever removed and the page becomes ISR-eligible,
// 60s is already a sane cap, comfortably below the 5-minute ingest cadence.
export const revalidate = 60;

export default async function ScoresPage({
  searchParams,
}: { searchParams: Promise<{ leagues?: string }> }) {
  const { leagues: raw } = await searchParams;
  const selected = parseLeagueCodes(raw);

  const now = new Date();
  const leagues = await getLeagues();

  // Resolved once, up front — `getUpcoming`'s `limit` must apply *after*
  // this scoping, not before, or a league whose fixtures sort past the
  // unscoped top N gets truncated away before it can be filtered to, and
  // the page falsely renders "Nothing scheduled" for a league that has
  // real fixtures in the database (Finding 1). `undefined` means every
  // league, matching `getUpcoming`/`getLiveAndRecent`'s own "no filter"
  // meaning; an unrecognised code resolves to `[]`, which both queries
  // treat as "match nothing", never "everything".
  const selectedLeagueIds = selected.length > 0 ? resolveLeagueIds(leagues, selected) : undefined;

  const [recent, upcoming] = await Promise.all([
    getLiveAndRecent(now, selectedLeagueIds),
    getUpcoming(now, 20, selectedLeagueIds),
  ]);

  const nextKickoff = upcoming[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Scores</h1>
        <LeagueFilter leagues={leagues} selected={selected} basePath="/scores" />
      </div>

      <LiveScores
        // Forces a clean remount on every filter change (Finding 2).
        // `<LiveScores>` seeds its state from `initial`/`useRef` only on
        // first mount; without a `key` tied to the selection, a
        // client-side navigation between two `?leagues=` URLs reconciles
        // it as the *same* instance and just updates props in place, so
        // the panel keeps showing the previous filter's live fixtures
        // until the next poll (or, since the ref merges rather than
        // replaces, potentially longer).
        key={selected.length > 0 ? selected.join(',') : 'all'}
        initial={recent}
        nowIso={now.toISOString()}
        leagues={selected}
        leagueIds={selectedLeagueIds}
        // Always mounted now (Important 5), even when `recent` is empty —
        // otherwise the poll loop never starts for a page opened before
        // kickoff, and this card would still be showing at 15:30 with a
        // match already in progress.
        emptyState={
          <section className="rounded-xl border border-border bg-surface p-6">
            <p className="text-sm font-semibold">No matches in progress</p>
            <p className="mt-1 text-sm text-muted">
              {nextKickoff
                ? <>Next up: {nextKickoff.home?.name} v {nextKickoff.away?.name}, {formatKickoffTime(nextKickoff.kickoff_utc, now)}.</>
                : <>No fixtures scheduled in the selected competitions.</>}
            </p>
          </section>
        }
      />

      <section>
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Upcoming</h2>
        <ul className="overflow-hidden rounded-xl border border-border bg-surface">
          {upcoming.length === 0 && (
            <li className="px-3 py-6 text-sm text-muted">Nothing scheduled.</li>
          )}
          {upcoming.map((f) => <ScoreRow key={f.id} fixture={f} scoreText={scoreCellText(f, now)} />)}
        </ul>
      </section>
    </div>
  );
}
