import { monogram, monogramColor } from '@/lib/site/monogram';

/**
 * The monogram fallback shown wherever a crest image is absent, or present
 * but fails to load. Plain server-renderable markup — no client state.
 */
export function MonogramCrest({ name, size }: { name: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, background: monogramColor(name), fontSize: size * 0.38 }}
      className="shrink-0 grid place-items-center rounded-full font-bold tracking-tight text-white"
    >
      {monogram(name)}
    </span>
  );
}
