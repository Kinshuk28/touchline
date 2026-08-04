'use client';

import Image from 'next/image';
import { useState } from 'react';
import { MonogramCrest } from '@/components/MonogramCrest';

/**
 * The only part of a crest that needs client hydration: a URL that might
 * 404, requiring an `onError` handler and a bit of state to fall back to the
 * monogram. Split out of `Crest` so the far more common "no crest_url at
 * all" case never pays for hydration it doesn't need.
 */
export function CrestImage({ url, name, size }: { url: string; name: string; size: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) return <MonogramCrest name={name} size={size} />;

  return (
    <Image
      src={url}
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
