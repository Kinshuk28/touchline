import type { Metadata } from 'next';
import { Orbitron, JetBrains_Mono } from 'next/font/google';
import { Mark } from '@/components/Mark';
import { Analytics } from '@/components/Analytics';
import './globals.css';

// Two roles, per the design system: Orbitron for display (headings, prices,
// scores — anything struck rather than typed) and JetBrains Mono for
// everything else, body copy included. Each exposed as a CSS variable on
// <html> and mapped to font-display/font-sans/font-mono in globals.css's
// `@theme inline` block, the same wiring the previous font system used —
// only the monospace face changed.
const orbitron = Orbitron({ subsets: ['latin'], weight: ['700', '900'], variable: '--font-orbitron', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jetbrains-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Touchline — Europe\'s top five leagues',
  description: 'Live scores, fixtures, tables and news for the Premier League, La Liga, Serie A, Bundesliga and Ligue 1.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${orbitron.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <Analytics />
        {/* A soft ambient glow, not a sun — the Cyberpunk system trades the
            Vaporwave horizon for a flat circuit grid (see `body::before` in
            globals.css), so this is just a diffuse green-into-magenta wash
            behind the header. Fixed, behind everything, `aria-hidden`. */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed left-1/2 top-[-220px] -z-10 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-gradient-to-b from-comp-sa to-comp-pl opacity-10 blur-[100px]"
        />

        <header className="relative z-10 border-b-2 border-border bg-surface/60">
          {/* Window chrome, not a plain nav bar — the three coloured dots
              read as an OS title bar the instant you see them, which is
              exactly the terminal/vintage-GUI reference the system asks
              every window-like surface to carry. Decorative: the wordmark
              beside them is what a screen reader announces. */}
          <div aria-hidden="true" className="flex items-center gap-1.5 border-b border-border px-4 py-1.5">
            <span className="size-2.5 rounded-full bg-comp-pl" />
            <span className="size-2.5 rounded-full bg-comp-pd" />
            <span className="size-2.5 rounded-full bg-comp-sa" />
            <span className="ml-2 font-mono text-11 uppercase tracking-[0.2em] text-muted">touchline.exe</span>
          </div>
          {/* `flex-wrap` plus an explicit `order` per child: at >=360px with
              eight nav links, brand + nav no longer fit on one line. Below
              `sm`, the nav drops to its own full-width second row
              (`order-2 w-full`); from `sm` up, `sm:w-auto` restores a
              single-row [brand, nav] layout. */}
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <a
              href="/"
              className="order-1 flex items-center gap-2 font-display text-lg font-black uppercase tracking-[0.04em] text-comp-pl drop-shadow-[0_0_8px_rgba(0,255,136,0.7)]"
            >
              <Mark />
              TOUCHLINE
            </a>
            {/* `p-2 -m-2` on every link: padding grows the tappable area,
                the matching negative margin cancels the same amount back out
                of the flex layout, so the visible text and the 16px/6px
                gaps this row is laid out with (gap-x-4/gap-y-1.5) are
                unchanged. Horizontally the 8px-per-side extension exactly
                meets a neighbour's own extension in the middle of the
                existing gap; vertically, where the row wraps at narrow
                widths, it eats slightly into the 6px row gap — an accepted
                trade for turning an 11px-tall text link into a real touch
                target on a nav that is on every single page. */}
            <nav aria-label="Primary" className="order-2 flex w-full flex-wrap gap-x-4 gap-y-1.5 font-mono text-11 uppercase tracking-[0.14em] text-muted sm:w-auto">
              <a href="/news" className="inline-block p-2 -m-2 hover:text-comp-pl hover:drop-shadow-[0_0_6px_rgba(0,255,136,0.8)]">News</a>
              <a href="/scores" className="inline-block p-2 -m-2 hover:text-comp-pl hover:drop-shadow-[0_0_6px_rgba(0,255,136,0.8)]">Scores</a>
              <a href="/tables" className="inline-block p-2 -m-2 hover:text-comp-pl hover:drop-shadow-[0_0_6px_rgba(0,255,136,0.8)]">Tables</a>
              <a href="/clubs" className="inline-block p-2 -m-2 hover:text-comp-pl hover:drop-shadow-[0_0_6px_rgba(0,255,136,0.8)]">Clubs</a>
              <a href="/calendar" className="inline-block p-2 -m-2 hover:text-comp-pl hover:drop-shadow-[0_0_6px_rgba(0,255,136,0.8)]">Calendar</a>
              <a href="/transfers" className="inline-block p-2 -m-2 hover:text-comp-pl hover:drop-shadow-[0_0_6px_rgba(0,255,136,0.8)]">Transfers</a>
              <a href="/fantasy" className="inline-block p-2 -m-2 hover:text-comp-pl hover:drop-shadow-[0_0_6px_rgba(0,255,136,0.8)]">Fantasy</a>
              <a href="/search" className="inline-block p-2 -m-2 hover:text-comp-pl hover:drop-shadow-[0_0_6px_rgba(0,255,136,0.8)]">Search</a>
            </nav>
          </div>
        </header>
        {/* max-w-7xl (1280px): three asymmetric dashboard columns need the
            room before the narrowest — the news rail — stops fitting a
            headline beside its thumbnail. Applied to the shell so every
            route shares the same gutters and the header/footer rules line
            up with the content edge. */}
        <main className="relative z-10 mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="relative z-10 mt-12 border-t-2 border-border bg-surface/40">
          <div className="mx-auto max-w-7xl px-4 py-6 font-mono text-11 uppercase tracking-wider text-muted">
            {'> '}Data from football-data.org and the Fantasy Premier League API. Headlines link to their publishers.
          </div>
        </footer>
      </body>
    </html>
  );
}
