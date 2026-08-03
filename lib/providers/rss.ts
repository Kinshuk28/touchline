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
const TRANSFER_WORDS = [
  'transfer', 'signing', 'signs for', 'signs with', 'set to join', 'joins',
  'move to', 'move for', 'deal for', 'bid for', 'agree deal', 'agrees deal',
  'agreed deal', 'medical', 'loan', 'release clause', 'transfer fee',
  'record fee', 'swap deal', 'contract', 'complete signing', 'complete move',
];
const INJURY_WORDS = [
  'injury', 'injured', 'ruled out', 'sidelined', 'hamstring', 'acl',
  'cruciate', 'surgery', 'operation', 'strain', 'knock', 'out until',
  'doubtful', 'fitness doubt',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesKeyword(t: string, term: string): boolean {
  if (term.includes(' ')) return t.includes(term);
  return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(t);
}

export function classify(title: string): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  if (TRANSFER_WORDS.some((w) => matchesKeyword(t, w))) out.push('transfer');
  if (INJURY_WORDS.some((w) => matchesKeyword(t, w))) out.push('injury');
  return out;
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
  publishedAt: string;
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
        publishedAt: published ? new Date(published).toISOString() : new Date().toISOString(),
        categories: classify(title),
        contentHash: contentHash(title),
      });
    }
    return items;
  }

  async fetchAll(): Promise<NewsItem[]> {
    const batches = await Promise.all(FEEDS.map((f) => this.fetchFeed(f.source, f.url)));
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
