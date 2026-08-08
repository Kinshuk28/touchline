import Link from 'next/link';
import { signOut } from '@/lib/auth/actions';
import { Button } from '@/components/ui/Button';

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
  current: 'squad' | 'leagues' | 'history' | 'stats';
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-2 border-comp-pl/40 bg-surface/80 px-3 py-2">
        <h1 className="font-display text-24 font-black uppercase tracking-[-0.01em] text-comp-pl drop-shadow-[0_0_10px_rgba(0,255,136,0.6)]">
          Fantasy
        </h1>

        {/* `p-1.5 -m-1.5` on every tab, same invisible-hit-area trick as the
            site header's nav (app/layout.tsx) — grows the tappable area
            without moving the visible text or the underline (a
            text-decoration, unaffected by the padding box it sits inside). */}
        <nav aria-label="Fantasy" className="flex gap-3 font-mono text-11 font-semibold uppercase tracking-wider">
          {/* `aria-current` rather than colour alone — the underline and the
              attribute both say which page this is. */}
          <Link
            href="/fantasy"
            aria-current={current === 'squad' ? 'page' : undefined}
            className={`inline-block p-1.5 -m-1.5 ${current === 'squad' ? 'text-comp-pd underline decoration-2 underline-offset-4 drop-shadow-[0_0_6px_rgba(0,212,255,0.8)]' : 'text-muted hover:text-comp-pd'}`}
          >
            Squad
          </Link>
          <Link
            href="/fantasy/leagues"
            aria-current={current === 'leagues' ? 'page' : undefined}
            className={`inline-block p-1.5 -m-1.5 ${current === 'leagues' ? 'text-comp-pd underline decoration-2 underline-offset-4 drop-shadow-[0_0_6px_rgba(0,212,255,0.8)]' : 'text-muted hover:text-comp-pd'}`}
          >
            Leagues
          </Link>
          <Link
            href="/fantasy/history"
            aria-current={current === 'history' ? 'page' : undefined}
            className={`inline-block p-1.5 -m-1.5 ${current === 'history' ? 'text-comp-pd underline decoration-2 underline-offset-4 drop-shadow-[0_0_6px_rgba(0,212,255,0.8)]' : 'text-muted hover:text-comp-pd'}`}
          >
            History
          </Link>
          <Link
            href="/fantasy/stats"
            aria-current={current === 'stats' ? 'page' : undefined}
            className={`inline-block p-1.5 -m-1.5 ${current === 'stats' ? 'text-comp-pd underline decoration-2 underline-offset-4 drop-shadow-[0_0_6px_rgba(0,212,255,0.8)]' : 'text-muted hover:text-comp-pd'}`}
          >
            Stats
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3 font-mono text-11 text-muted">
          {email && <span className="max-w-[14rem] truncate">{email}</span>}
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">Sign out</Button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
