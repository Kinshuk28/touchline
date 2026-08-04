import { CrestImage } from '@/components/CrestImage';
import { MonogramCrest } from '@/components/MonogramCrest';
import type { TeamLite } from '@/lib/site/rows';

/**
 * A missing crest is the *normal* case — many clubs, and most players
 * elsewhere in the app, have no image — so that branch is plain
 * server-rendered markup with zero client hydration. Only the "a URL exists
 * and might 404" branch needs a client component (`CrestImage`).
 */
export function Crest({
  team, size = 24, eager = false,
}: { team: TeamLite | null; size?: number; eager?: boolean }) {
  const name = team?.name ?? 'Unknown club';
  if (team?.crest_url) return <CrestImage url={team.crest_url} name={name} size={size} eager={eager} />;
  return <MonogramCrest name={name} size={size} />;
}
