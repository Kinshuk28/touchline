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
export function CrestImage({
  url, name, size, eager = false,
}: { url: string; name: string; size: number; eager?: boolean }) {
  const [failed, setFailed] = useState(false);

  if (failed) return <MonogramCrest name={name} size={size} />;

  return (
    <Image
      src={url}
      alt=""
      width={size}
      height={size}
      // `eager`, set by an above-the-fold caller (e.g. the first screenful
      // of /scores — see the redesign spec), so these crests don't lazy-pop
      // in after the rest of the row has already painted. Every other
      // caller leaves this at the default `false`, i.e. plain lazy loading.
      loading={eager ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
      className="shrink-0 object-contain"
      /* Crests are small, already-optimised PNGs on a CDN. Next's optimizer
         would bill Netlify credits per transform for no visual gain. */
      unoptimized
    />
  );
}
