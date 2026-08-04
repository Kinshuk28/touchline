import { dataAge } from '@/lib/site/format';

export function DataAge({ updatedAt, now }: { updatedAt: string; now: Date }) {
  return (
    <span className="text-[11px] text-muted tabular-nums" title={updatedAt}>
      {dataAge(updatedAt, now)}
    </span>
  );
}
