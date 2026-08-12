'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Crest } from '@/components/Crest';
import { MIN_QUERY_LENGTH } from '@/lib/site/searchQuery';
import type { ClubRow } from '@/lib/site/rows';

interface SearchPlayer {
  id: number;
  slug: string;
  name: string;
  position: string | null;
}

interface SearchResults {
  clubs: ClubRow[];
  players: SearchPlayer[];
}

const DEBOUNCE_MS = 200;

/**
 * The site's only search surface now — replaces the old dedicated
 * `/search` page, which cost a full navigation and a form submit just to
 * find out whether a name matched anything. Lives in the header (see
 * app/layout.tsx), so it's reachable from every page rather than being its
 * own destination.
 *
 * Fires no request below `MIN_QUERY_LENGTH` characters (currently 3) —
 * short of that, a query matches too much to be worth a round trip, the
 * same floor `/api/search` itself enforces server-side. Debounced by
 * `DEBOUNCE_MS` so a fast typist doesn't fire one request per keystroke;
 * a `requestId` ref (not a boolean) discards a response that lands after a
 * newer request has already gone out, which a plain "ignore if not still
 * loading" flag can't do when two requests are in flight at once.
 */
export function SearchBox() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setLoading(false);
      return;
    }

    const id = ++requestIdRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: SearchResults | null) => {
          if (requestIdRef.current !== id) return; // a newer keystroke has already superseded this one
          setResults(data);
          setLoading(false);
        })
        .catch(() => {
          if (requestIdRef.current !== id) return;
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const trimmed = query.trim();
  const showDropdown = open && trimmed.length >= MIN_QUERY_LENGTH;
  const total = (results?.clubs.length ?? 0) + (results?.players.length ?? 0);

  return (
    <div ref={containerRef} className="relative order-3 w-full sm:w-56">
      <label htmlFor="site-search" className="sr-only">Search clubs and players</label>
      <input
        id="site-search"
        type="search"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        placeholder={`Search clubs, players… (${MIN_QUERY_LENGTH}+ letters)`}
        autoComplete="off"
        className="cyber-cut-sm w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-11 text-text outline-none placeholder:text-muted focus-visible:border-comp-pl"
      />
      {showDropdown && (
        <div
          role="listbox"
          aria-label="Search results"
          className="cyber-cut absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto border border-border bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
        >
          {loading && <p className="px-3 py-2 text-11 text-muted">Searching…</p>}
          {!loading && total === 0 && (
            <p className="px-3 py-2 text-11 text-muted">Nothing matches &ldquo;{trimmed}&rdquo;.</p>
          )}
          {!loading && results && results.clubs.length > 0 && (
            <ul>
              <li className="border-b border-border bg-surface-2 px-3 py-1 font-mono text-11 uppercase tracking-wider text-muted">
                Clubs
              </li>
              {results.clubs.map((club) => (
                <li key={`club-${club.id}`}>
                  <Link
                    href={`/team/${club.slug}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-surface-2"
                  >
                    <Crest team={club} size={18} />
                    <span className="min-w-0 flex-1 truncate text-13 font-medium">{club.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!loading && results && results.players.length > 0 && (
            <ul>
              <li className="border-b border-border bg-surface-2 px-3 py-1 font-mono text-11 uppercase tracking-wider text-muted">
                Players
              </li>
              {results.players.map((player) => (
                <li key={`player-${player.id}`}>
                  <Link
                    href={`/player/${player.slug}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-13 font-medium">{player.name}</span>
                    {player.position && (
                      <span className="shrink-0 font-mono text-11 uppercase tracking-wider text-muted">{player.position}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
