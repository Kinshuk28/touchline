import Parser from 'rss-parser';
import { createHash } from 'node:crypto';

export const FEEDS: Array<{ source: string; url: string }> = [
  { source: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/football/rss' },
  { source: 'Sky Sports', url: 'https://www.skysports.com/rss/12040' },
];

const TRANSFER_WORDS = [
  'transfer', 'signing', 'signs', 'sign ', 'move to', 'joins', 'deal for',
  'bid for', 'agree deal', 'medical', 'loan', 'fee', 'complete',
];
const INJURY_WORDS = [
  'injury', 'injured', 'ruled out', 'sidelined', 'hamstring', 'acl',
  'surgery', 'setback', 'out for', 'fitness',
];

export function classify(title: string): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  if (TRANSFER_WORDS.some((w) => t.includes(w))) out.push('transfer');
  if (INJURY_WORDS.some((w) => t.includes(w))) out.push('injury');
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
