'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('touchline-theme');
    if (stored === 'light' || stored === 'dark') { setTheme(stored); return; }
    setTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('touchline-theme', next);
  }

  return (
    <button
      onClick={toggle}
      className="min-w-16 rounded border border-border px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-text"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === null ? '·' : theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
