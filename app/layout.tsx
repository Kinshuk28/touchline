import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { ThemeToggle } from '@/components/ThemeToggle';
import './globals.css';

// The three roles from the redesign spec — Archivo (display), IBM Plex Sans
// (body), IBM Plex Mono (data) — each exposed as a CSS variable on <html>
// and mapped to font-display/font-sans/font-mono in globals.css's
// `@theme inline` block. That mapping is what makes the utilities actually
// resolve to these faces instead of Tailwind's default stacks.
const archivo = Archivo({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-archivo', display: 'swap' });
const ibmPlexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-ibm-plex-sans', display: 'swap' });
const ibmPlexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-ibm-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Touchline — Europe\'s top five leagues',
  description: 'Live scores, fixtures, tables and news for the Premier League, La Liga, Serie A, Bundesliga and Ligue 1.',
};

const themeBootstrap = `
try {
  var t = localStorage.getItem('touchline-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body className="min-h-dvh font-sans antialiased">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <a href="/" className="font-display text-lg font-extrabold tracking-[-0.02em]">
              TOUCH<span className="text-accent">LINE</span>
            </a>
            <nav className="flex gap-4 text-11 font-semibold uppercase tracking-wider text-muted">
              <a href="/scores" className="hover:text-text">Scores</a>
              <a href="/calendar" className="hover:text-text">Calendar</a>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mt-12 border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-6 text-11 text-muted">
            Data from football-data.org and the Fantasy Premier League API. Headlines link to their publishers.
          </div>
        </footer>
      </body>
    </html>
  );
}
