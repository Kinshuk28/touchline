import Link from 'next/link';
import { Crest } from '@/components/Crest';
import { parseClubColors, clubWashBackground } from '@/lib/site/clubColors';
import type { ClubRow } from '@/lib/site/rows';

/**
 * One club on `/clubs` — crest (largest anywhere on the site: this is the
 * one page where a club's crest and colours are the subject, not an
 * accent), name, venue, founded year and its parsed kit colours as a
 * visible swatch.
 *
 * Now a `<Link>` to `/team/[slug]`. It was a plain `<div>` for as long as
 * that route did not exist — shipping a dead link on a club element was a
 * real bug caught earlier on fixture rows — and the moment the route
 * landed, the card became the most obvious way into it.
 *
 * `venue`/`founded`/`club_colors` are each rendered independently and
 * omitted (never a placeholder or an em dash) when null — see `ClubRow`'s
 * doc comment for why all three are null together for a historical club.
 */
export function ClubCard({ club, eager = false }: { club: ClubRow; eager?: boolean }) {
  const colors = parseClubColors(club.club_colors);
  // Wash sits only behind the crest, on its own `surface-2` block — never
  // behind the name/venue/founded text below, which stays on the plain,
  // already-AA `--surface` card background regardless of the club's
  // colours. See clubWashBackground's doc comment for the full reasoning.
  const wash = clubWashBackground(club.club_colors);

  return (
    <Link
      href={`/team/${club.slug}`}
      className="group block overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-muted"
    >
      <div
        className="flex h-24 items-center justify-center bg-surface-2 sm:h-28"
        style={wash ? { background: wash } : undefined}
      >
        <Crest team={club} size={56} eager={eager} />
      </div>
      <div className="space-y-1 p-3">
        <p className="truncate text-15 font-semibold" title={club.name}>
          {club.name}
        </p>
        {club.venue && (
          <p className="truncate text-13 text-muted" title={club.venue}>
            {club.venue}
          </p>
        )}
        {club.founded !== null && (
          <p className="font-mono text-11 text-muted">Est. {club.founded}</p>
        )}
        {colors && (
          <div className="pt-1.5">
            {/* Decorative — the club_colors text line right below is what
                actually carries the colour names, so this bar is never the
                sole source of the information, only a visual amplification
                of it (spec: "club colour is never the sole carrier of
                meaning"). */}
            <div
              className="flex h-2 overflow-hidden rounded-full border border-border"
              aria-hidden="true"
            >
              <span className="flex-1" style={{ background: colors[0] }} />
              {colors[1] && <span className="flex-1" style={{ background: colors[1] }} />}
            </div>
            <p className="mt-1 truncate text-11 text-muted">{club.club_colors}</p>
          </div>
        )}
      </div>
    </Link>
  );
}
