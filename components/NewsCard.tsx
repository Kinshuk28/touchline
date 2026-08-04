import { relativeTime } from '@/lib/site/format';
import type { NewsRow } from '@/lib/site/rows';

export function NewsCard({ item, now, lead = false }: { item: NewsRow; now: Date; lead?: boolean }) {
  const age = relativeTime(item.published_at, now);
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-border bg-surface p-4 hover:border-muted"
    >
      {item.categories.includes('transfer') && (
        <span className="mb-2 inline-block rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-ink">
          Transfer
        </span>
      )}
      {item.categories.includes('injury') && (
        <span className="mb-2 ml-1 inline-block rounded border border-live px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-live">
          Injury
        </span>
      )}
      <h3 className={lead ? 'text-xl font-extrabold leading-tight tracking-tight' : 'text-sm font-semibold leading-snug'}>
        {item.title}
      </h3>
      {lead && item.summary && <p className="mt-2 text-sm text-muted">{item.summary}</p>}
      <p className="mt-2 text-[11px] text-muted">
        {item.source}{age ? ` · ${age}` : ''}
      </p>
    </a>
  );
}
