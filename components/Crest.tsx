'use client';

import Image from 'next/image';
import { useState } from 'react';
import { monogram, monogramColor } from '@/lib/site/monogram';
import type { TeamLite } from '@/lib/site/rows';

export function Crest({ team, size = 24 }: { team: TeamLite | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const name = team?.name ?? 'Unknown club';
  const showImage = team?.crest_url != null && !failed;

  if (showImage) {
    return (
      <Image
        src={team!.crest_url!}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className="shrink-0 object-contain"
        /* Crests are small, already-optimised PNGs on a CDN. Next's optimizer
           would bill Netlify credits per transform for no visual gain. */
        unoptimized
      />
    );
  }

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
