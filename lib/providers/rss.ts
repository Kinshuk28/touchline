import Parser from 'rss-parser';
import { createHash } from 'node:crypto';

export const FEEDS: Array<{ source: string; url: string }> = [
  { source: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/football/rss' },
  { source: 'Sky Sports', url: 'https://www.skysports.com/rss/12040' },
];

// Multi-word phrases below are checked as plain substrings of the lowercased title: a
// real headline is very unlikely to contain a several-word phrase like "agree deal" or
// "ruled out" by accident, so no extra care is needed there. Single-word tokens (no
// internal space) are different — a short or common word can appear as a *substring
// inside an unrelated word* and fire a false positive, e.g. bare "acl" inside
// "spectacle"/"miracle"/"debacle"/"oracle", bare "signing" inside
// "resigning"/"designing"/"consigning" (a manager resigning is not a transfer), bare
// "knock" inside "knockout" (Champions League "knockout stages" is a very common
// football phrase), or bare "operation" inside "cooperation". To avoid that whole class
// of trap, every single-word keyword is matched with word boundaries (`\bword\b`)
// instead of a raw substring test. The trade-off: a bare plural like "transfers" or
// "injuries" no longer matches through its singular root ("transfer"/"injury") — in
// practice those headlines still carry other signal (another keyword, or the word
// elsewhere in the title), so the small recall loss is worth the precision gained.
//
// Beyond that word-boundary trap, some tokens are ambiguous even as *whole words* —
// they have a common non-football-news sense as well as the football sense:
//   - bare "knock" is also standard match-report idiom for eliminating an opponent
//     ("Arsenal knock Chelsea out of the FA Cup"), nothing to do with an injury.
//   - bare "strain" is also standard for managerial/off-pitch pressure ("Klopp under
//     strain after a run of poor results"), nothing to do with a muscle injury.
//   - bare "contract" is everywhere in football *business* writing that isn't a player
//     transfer at all — sponsorship deals, broadcast-rights deals, image-rights deals
//     ("Sponsor contract dispute overshadows kit launch").
// Word boundaries can't fix these, because the word itself is the false positive, not
// just a substring of it. So these three are dropped as bare tokens entirely and only
// kept as specific multi-word phrases that disambiguate the real signal.
const TRANSFER_WORDS = [
  'transfer', 'signing', 'signs for', 'signs with', 'signed for', 'set to join',
  'joins', 'loaned to', 'move to', 'move for', 'deal for', 'bid for',
  'agree deal', 'agrees deal', 'agreed deal', 'medical', 'loan',
  'release clause', 'transfer fee', 'record fee', 'swap deal',
  'complete signing', 'complete move', 'new contract', 'contract extension',
  'signs contract', 'contract talks',
];
const INJURY_WORDS = [
  'injury', 'injured', 'ruled out', 'sidelined', 'hamstring', 'acl',
  'cruciate', 'surgery', 'operation', 'out until', 'doubtful',
  'fitness doubt', 'muscle strain', 'hamstring strain', 'picked up a knock',
];
// Bare "signed" and bare "joined" were deliberately left out even though they're
// common past-tense transfer verbs: "signed" collides with memorabilia/autograph
// stories ("legend's signed shirt auctioned for charity") and "joined" collides with
// ordinary match-report prose ("players joined in celebration", "joined by his
// teammates"). "signed for" and "loaned to" above capture the same real signal
// (see the required-regression headlines) without those collisions.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Precompiled once at module load rather than per matchesKeyword() call: single-word
// terms need a `\bword\b` RegExp, multi-word phrases are checked as plain substrings
// and need no RegExp at all. Building `new RegExp` inside classify()'s hot path (once
// per keyword, per call) was wasted work since the word lists never change at runtime.
function compileMatchers(words: readonly string[]): Array<(t: string) => boolean> {
  return words.map((term) => {
    if (term.includes(' ')) return (t: string) => t.includes(term);
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`);
    return (t: string) => re.test(t);
  });
}

const TRANSFER_MATCHERS = compileMatchers(TRANSFER_WORDS);
const INJURY_MATCHERS = compileMatchers(INJURY_WORDS);

export function classify(title: string): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  if (TRANSFER_MATCHERS.some((m) => m(t))) out.push('transfer');
  if (INJURY_MATCHERS.some((m) => m(t))) out.push('injury');
  return out;
}

// A feed can carry a pubDate/isoDate that `new Date()` parses into an Invalid Date
// (e.g. a malformed or non-standard string), or no date at all. Calling
// `.toISOString()` on an Invalid Date throws RangeError, so this must never do that
// -- but the old fix for that RangeError went too far the other way: it fell back to
// `new Date().toISOString()`, i.e. *now*, and stored that guess as the article's
// actual publication date. That's a fabrication, not a safe default: `published_at`
// is the single column `news_items` is sorted by (`news_published_idx ... published_at
// desc`), so a story of genuinely unknown date would pin itself to the very top of
// the feed, ahead of stories that really are new. The honest value for "we don't know
// when this was published" is `null`, not a confident-looking timestamp equal to the
// moment the ingestion job happened to run.
function safePublishedAt(published: string | undefined): string | null {
  if (published) {
    const d = new Date(published);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export function contentHash(title: string): string {
  return createHash('sha256').update(title.trim().toLowerCase()).digest('hex');
}

export interface NewsItem {
  source: string;
  title: string;
  summary: string | null;
  url: string;
  imageUrl: string | null;
  // null means the feed's date was absent or unparseable -- never guessed at.
  // See safePublishedAt above and lib/db/repositories/news.ts for how the
  // write path tolerates this both before and after migration 0004 makes
  // the `news_items.published_at` column nullable.
  publishedAt: string | null;
  categories: string[];
  contentHash: string;
}

export class RssClient {
  private readonly fetchImpl: typeof fetch;
  private readonly parser = new Parser({
    customFields: { item: [['media:thumbnail', 'mediaThumbnail', { keepArray: false }]] },
  });

  constructor(opts: { fetchImpl?: typeof fetch } = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async fetchFeed(source: string, url: string): Promise<NewsItem[]> {
    let xml: string;
    try {
      const res = await this.fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 Touchline' } });
      if (!res.ok) return [];
      xml = await res.text();
    } catch {
      return [];
    }

    let feed: Awaited<ReturnType<Parser['parseString']>>;
    try {
      feed = await this.parser.parseString(xml);
    } catch {
      return [];
    }

    const items: NewsItem[] = [];
    for (const item of feed.items ?? []) {
      // Defense in depth: a malformed item (bad date, unexpected field shape, or
      // anything else unanticipated) must not take down the rest of this feed's
      // items. Skip just this one and keep going. safePublishedAt() below already
      // guarantees the date itself can't throw, but this guard covers whatever we
      // haven't thought of too.
      try {
        const title = item.title?.trim();
        const link = item.link?.trim();
        if (!title || !link) continue;
        const published = item.isoDate ?? item.pubDate;
        items.push({
          source,
          title,
          summary: item.contentSnippet?.trim() ?? null,
          url: link,
          imageUrl: extractImage(item),
          publishedAt: safePublishedAt(published),
          categories: classify(title),
          contentHash: contentHash(title),
        });
      } catch {
        continue;
      }
    }
    return items;
  }

  async fetchAll(): Promise<NewsItem[]> {
    // Promise.allSettled, not Promise.all: a feed being unreachable (or any other
    // per-feed failure) must never throw, and one dead feed must not take down a run
    // that is also reading two healthy ones. fetchFeed() already catches its own
    // fetch/parse/item errors and resolves to [], so this is defense in depth — but it
    // is the line that actually enforces "never let one feed's rejection sink the
    // whole call" against future bugs in fetchFeed.
    const results = await Promise.allSettled(FEEDS.map((f) => this.fetchFeed(f.source, f.url)));
    const batches = results.map((r) => (r.status === 'fulfilled' ? r.value : []));
    const seen = new Set<string>();
    const merged: NewsItem[] = [];
    for (const item of batches.flat()) {
      if (seen.has(item.contentHash)) continue;
      seen.add(item.contentHash);
      merged.push(item);
    }
    return merged;
  }
}

function extractImage(item: Record<string, unknown>): string | null {
  const thumb = item.mediaThumbnail as { $?: { url?: string } } | undefined;
  if (thumb?.$?.url) return thumb.$.url;
  const enclosure = item.enclosure as { url?: string } | undefined;
  return enclosure?.url ?? null;
}
