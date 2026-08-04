'use client';

import { useState } from 'react';
import {
  FOLLOWING_COOKIE_NAME,
  FOLLOWING_COOKIE_MAX_AGE,
  parseFollowingCookie,
  serializeFollowingCookie,
  toggleFollowingCode,
} from '@/lib/site/following';

function readCookieValue(): string | null {
  const prefix = `${FOLLOWING_COOKIE_NAME}=`;
  const found = document.cookie.split('; ').find((c) => c.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

/**
 * A real `<button>` (never a link or a div) so it is keyboard-operable and
 * announces its state via `aria-pressed` — no custom ARIA widget needed.
 * Reads and writes the `touchline-following` cookie directly on click: an
 * explicit user action, nothing automatic, nothing set on page load. The
 * cookie's own read/write rules — `SameSite=Lax`, `Path=/`, one year, not
 * `HttpOnly` (this component has to read it back) — live here since this is
 * the only place that ever sets it.
 */
export function FollowToggle({
  code, name, initiallyFollowing,
}: { code: string; name: string; initiallyFollowing: boolean }) {
  const [following, setFollowing] = useState(initiallyFollowing);
  const upperCode = code.trim().toUpperCase();

  function handleClick() {
    const current = parseFollowingCookie(readCookieValue());
    const next = toggleFollowingCode(current, upperCode);
    document.cookie = `${FOLLOWING_COOKIE_NAME}=${serializeFollowingCookie(next)}; Path=/; Max-Age=${FOLLOWING_COOKIE_MAX_AGE}; SameSite=Lax`;
    setFollowing(next.includes(upperCode));
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={following}
      className={`rounded-full border px-3 py-1 text-11 font-semibold uppercase tracking-wider transition-colors ${
        following ? 'border-accent bg-accent text-accent-ink' : 'border-border text-muted hover:text-text'
      }`}
    >
      {following ? 'Following' : 'Follow'} <span className="sr-only">{name}</span>
    </button>
  );
}
