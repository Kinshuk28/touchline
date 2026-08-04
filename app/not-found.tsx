import Link from 'next/link';

// Next.js renders this for any route that doesn't match a page (including
// `notFound()` calls) instead of its own unstyled default. Added alongside
// the removal of `/team/[slug]` links from `ScoreRow` (Critical 2): a stray
// link into a route that doesn't exist yet must land somewhere that still
// looks like Touchline, not a bare framework error page.
export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">404</p>
      <h1 className="text-2xl font-extrabold tracking-tight">Page not found</h1>
      <p className="max-w-prose text-sm text-muted">
        That page doesn&apos;t exist — it may not have shipped yet, or the link was wrong.
      </p>
      <Link
        href="/"
        className="mt-2 rounded border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-text"
      >
        Back to home
      </Link>
    </div>
  );
}
