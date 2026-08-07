import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { googleSignInHref } from '@/lib/auth/actions';
import { SignInForm } from '@/components/SignInForm';
import { SessionBridge } from '@/components/SessionBridge';
import { BoardPanel } from '@/components/BoardPanel';
import { GoogleGlyph } from '@/components/fantasy/icons';

export const metadata: Metadata = {
  title: 'Sign in — Touchline Fantasy',
  description: 'Sign in with a one-time link to pick and manage your fantasy squad.',
};

// A session cookie decides what this page renders, so it can never be
// prerendered or cached.
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; bridge?: string }>;
}) {
  const { error, bridge } = await searchParams;
  const session = await getSession();
  if (session) redirect('/fantasy');
  const googleHref = await googleSignInHref();

  return (
    <div className="mx-auto max-w-lg space-y-3">
      {/* Only rendered when a magic link actually landed here, so the
          browser-only sign-in path costs nothing on an ordinary visit.
          See components/SessionBridge.tsx. */}
      {bridge === '1' && <SessionBridge />}

      {error === 'link' && (
        <p role="status" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-13">
          That sign-in link has expired or was already used. Links work once, and last an hour.
        </p>
      )}

      <BoardPanel label="Touchline Fantasy" meta="Sign in">
        <div className="space-y-4 p-4">
          <p className="text-15 text-muted">
            Pick fifteen Premier League players, score them on real gameweek results, and
            change your side each week.
          </p>

          <a
            href={googleHref}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2 text-13 font-semibold hover:bg-surface"
          >
            <GoogleGlyph size={16} />
            Continue with Google
          </a>

          <div className="flex items-center gap-3 text-11 uppercase tracking-wider text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <SignInForm />
          <p className="border-t border-border pt-3 text-11 text-muted">
            No password, either way. Google signs you in with your Google account; the emailed
            link works once and expires in an hour. We store nothing about you beyond your
            address and the squad you pick.
          </p>
        </div>
      </BoardPanel>

      <p className="text-center text-11 text-muted">
        <Link href="/" className="hover:text-text">← Back to the scores</Link>
      </p>
    </div>
  );
}
