import Link from 'next/link';
import { signOut } from '@/lib/auth/actions';

/**
 * The frame every signed-in fantasy page sits in: who you are, the way out,
 * and the two places there are to be.
 *
 * Shared rather than repeated because the sign-out form and the identity line
 * are the parts a manager needs to find in the same place on every page —
 * drifting by a few pixels between the picker and a league table is the kind
 * of thing that reads as two different products.
 */
export function FantasyShell({
  email,
  current,
  children,
}: {
  email: string | null;
  current: 'squad' | 'leagues';
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2">
        <h1 className="font-display text-24 font-extrabold leading-tight tracking-[-0.02em]">Fantasy</h1>

        <nav aria-label="Fantasy" className="flex gap-3 text-11 font-semibold uppercase tracking-wider">
          {/* `aria-current` rather than colour alone — the underline and the
              attribute both say which page this is. */}
          <Link
            href="/fantasy"
            aria-current={current === 'squad' ? 'page' : undefined}
            className={current === 'squad' ? 'underline underline-offset-4' : 'text-muted hover:text-text'}
          >
            Squad
          </Link>
          <Link
            href="/fantasy/leagues"
            aria-current={current === 'leagues' ? 'page' : undefined}
            className={current === 'leagues' ? 'underline underline-offset-4' : 'text-muted hover:text-text'}
          >
            Leagues
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3 text-11 text-muted">
          {email && <span className="max-w-[14rem] truncate">{email}</span>}
          <form action={signOut}>
            <button type="submit" className="rounded-md border border-border px-2 py-0.5 font-semibold hover:text-text">
              Sign out
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
