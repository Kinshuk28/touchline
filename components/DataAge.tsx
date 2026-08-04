import { dataAge, checkedAge } from '@/lib/site/format';

/**
 * `variant="checked"` reads the timestamp as poll freshness ("checked X
 * ago") rather than data freshness ("updated X ago") — see
 * `lib/site/format.ts#checkedAge`. `LiveScores` uses this variant so the
 * stamp reflects "is this panel still polling", which cannot freeze during
 * a goalless spell the way a row-derived `updated_at` stamp did (Important 6).
 */
export function DataAge({
  updatedAt, now, variant = 'updated',
}: { updatedAt: string; now: Date; variant?: 'updated' | 'checked' }) {
  const text = variant === 'checked' ? checkedAge(updatedAt, now) : dataAge(updatedAt, now);
  return (
    <span className="text-[11px] text-muted tabular-nums" title={updatedAt}>
      {text}
    </span>
  );
}
