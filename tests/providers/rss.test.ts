import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RssClient, classify, contentHash, FEEDS } from '@/lib/providers/rss';

const xml = readFileSync('tests/fixtures/rss-bbc.xml', 'utf8');

function fetchImplFor(body: string): typeof fetch {
  return (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
}

function clientFor(body: string) {
  return new RssClient({ fetchImpl: fetchImplFor(body) });
}

describe('classify', () => {
  it('tags transfer stories', () => {
    expect(classify('Arsenal complete £60m signing of midfielder')).toContain('transfer');
    expect(classify('Real Madrid agree deal for winger')).toContain('transfer');
  });
  it('tags injury stories', () => {
    expect(classify('Haaland ruled out for six weeks with hamstring injury')).toContain('injury');
  });
  it('returns an empty array for ordinary match reports', () => {
    expect(classify('Liverpool beat Everton in the Merseyside derby')).toEqual([]);
  });
  it('is case-insensitive', () => {
    expect(classify('CHELSEA COMPLETE SIGNING OF STRIKER')).toContain('transfer');
  });
  it('does not tag ordinary match-report language as transfer or injury (fixed false positives)', () => {
    // Bare "complete" used to fire on any "complete a comeback/the double" match report.
    // It has been dropped in favour of specific phrases ("complete signing", "complete move").
    expect(classify('Arsenal complete comeback win over Spurs')).toEqual([]);
    expect(classify('Liverpool complete the double over Everton')).toEqual([]);
    // Bare "fee" used to fire on any unrelated "fee" story. Replaced by "transfer fee" /
    // "record fee".
    expect(classify('Referee fee dispute overshadows derby')).toEqual([]);
    // Bare "setback" used to fire on non-injury setbacks (a title race, a takeover bid).
    // Dropped entirely from INJURY_WORDS.
    expect(classify('Title race setback for City')).toEqual([]);
    // Bare "out for" used to fire on "out for revenge/blood/the win". Dropped in favour
    // of "ruled out", which already covers the real injury phrasing.
    expect(classify('United out for revenge in the derby')).toEqual([]);
    // Bare "fitness" used to fire on ordinary fitness-level commentary. Replaced by the
    // specific phrase "fitness doubt".
    expect(classify('Guardiola praises squad fitness levels')).toEqual([]);
  });
  it('does not let the short "acl" token match as a substring of unrelated words', () => {
    expect(classify('A spectacle at the Bernabeu')).toEqual([]);
    expect(classify('Miracle comeback stuns the champions')).toEqual([]);
  });
  it('does not tag the cup idiom "knock ... out of" as an injury (bare "knock" dropped)', () => {
    // "X knock Y out of the cup" is extremely common match-report language for
    // eliminating an opponent — nothing to do with an injury. Bare "knock" used to
    // match here even after the word-boundary fix, because the fix only ever
    // defended against the compound "knockout", not this separated form. The bare
    // token is gone; "picked up a knock" (a genuine injury phrase) remains.
    expect(classify('Arsenal knock Chelsea out of FA Cup')).toEqual([]);
    expect(classify('Manchester City knock Newcastle out of Carabao Cup')).toEqual([]);
  });
  it('does not tag managerial "under strain" as an injury (bare "strain" dropped)', () => {
    // "Klopp under strain after a run of poor results" is about job pressure, not a
    // muscle injury. Bare "strain" is gone; "muscle strain" / "hamstring strain"
    // remain as unambiguous injury phrases.
    expect(classify('Klopp under strain after run of poor results')).toEqual([]);
  });
  it('does not tag commercial/sponsorship contract stories as a transfer (bare "contract" dropped)', () => {
    // "Contract" is everywhere in football business writing that isn't a player
    // transfer — sponsorship, broadcast rights, image rights. Bare "contract" is
    // gone; "new contract" / "contract extension" / "signs contract" /
    // "contract talks" remain as unambiguous transfer-context phrases.
    expect(classify('Sponsor contract dispute overshadows kit launch')).toEqual([]);
  });
  it('tags past-tense transfer verbs ("signed for", "loaned to")', () => {
    // Past tense is at least as common as present tense in transfer headlines.
    // Bare "signed"/"joined" are deliberately not added (see the comment above
    // INJURY_WORDS in rss.ts) because they collide with non-transfer prose
    // ("legend's signed shirt", "players joined in celebration").
    expect(classify('Rice signed for Arsenal in club-record deal')).toContain('transfer');
    expect(classify('Striker loaned to Championship side')).toContain('transfer');
  });
  it('tags "signs new contract" via the specific contract phrase', () => {
    expect(classify('Haaland signs new contract at City')).toContain('transfer');
  });
  it('tags realistic transfer headlines', () => {
    expect(classify('Arsenal complete signing of midfielder')).toContain('transfer');
    expect(classify('Real Madrid agree deal for winger')).toContain('transfer');
    expect(classify('Chelsea complete £60m move for striker')).toContain('transfer');
    expect(classify('Wirtz set to join Bayern in £70m transfer')).toContain('transfer');
    expect(classify('Rice signs for Arsenal')).toContain('transfer');
  });
  it('tags realistic injury headlines', () => {
    expect(classify('Haaland ruled out for six weeks with hamstring injury')).toContain('injury');
    expect(classify('Saka faces surgery on knee')).toContain('injury');
    expect(classify('Rodri sidelined with cruciate ligament damage')).toContain('injury');
  });
  it('tags both transfer and injury when a headline carries both signals', () => {
    const tags = classify('Injured striker completes loan move to Roma');
    expect(tags).toContain('injury');
    expect(tags).toContain('transfer');
  });
});

describe('contentHash', () => {
  it('is stable for the same headline', () => {
    expect(contentHash('Same headline')).toBe(contentHash('Same headline'));
  });
  it('ignores case and surrounding whitespace so syndicated copies collapse', () => {
    expect(contentHash('  Same Headline ')).toBe(contentHash('same headline'));
  });
  it('differs for different headlines', () => {
    expect(contentHash('A')).not.toBe(contentHash('B'));
  });
});

describe('RssClient.fetchFeed', () => {
  it('parses items into NewsItem records', async () => {
    const items = await clientFor(xml).fetchFeed('BBC Sport', 'https://example.test/rss');
    expect(items.length).toBeGreaterThan(10);
    const i = items[0]!;
    expect(i.source).toBe('BBC Sport');
    expect(i.title).toBeTruthy();
    expect(i.url).toMatch(/^https?:\/\//);
    expect(i.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(i.contentHash).toHaveLength(64);
  });

  it('assigns every item a hash unique to its title', async () => {
    const items = await clientFor(xml).fetchFeed('BBC Sport', 'https://example.test/rss');
    const titles = new Set(items.map((i) => i.title.trim().toLowerCase()));
    const hashes = new Set(items.map((i) => i.contentHash));
    expect(hashes.size).toBe(titles.size);
  });

  it('returns an empty array instead of throwing when a feed is unreachable', async () => {
    const fetchImpl = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const items = await new RssClient({ fetchImpl }).fetchFeed('X', 'https://example.test/rss');
    expect(items).toEqual([]);
  });

  it('returns an empty array instead of throwing on unparseable XML', async () => {
    const fetchImpl = (async () => new Response('not xml at all', { status: 200 })) as unknown as typeof fetch;
    const items = await new RssClient({ fetchImpl }).fetchFeed('X', 'https://example.test/rss');
    expect(items).toEqual([]);
  });

  it('returns an empty array instead of throwing when fetchImpl itself rejects (network/DNS failure)', async () => {
    // The third failure mode alongside non-2xx and unparseable XML: the fetch call
    // never even completes.
    const fetchImpl = (async () => {
      throw new Error('simulated DNS failure');
    }) as unknown as typeof fetch;
    const items = await new RssClient({ fetchImpl }).fetchFeed('X', 'https://example.test/rss');
    expect(items).toEqual([]);
  });

  it('does not swap title and summary: title matches the <title>, summary matches the description text', async () => {
    const items = await clientFor(xml).fetchFeed('BBC Sport', 'https://example.test/rss');
    const i = items[0]!;
    expect(i.title).toBe('FA set to withdraw support for Fifa president Infantino');
    expect(i.summary).toContain('Football Association');
    expect(i.title).not.toBe(i.summary);
  });

  it('resolves imageUrl to the media:thumbnail CDN url for a real fixture item', async () => {
    const items = await clientFor(xml).fetchFeed('BBC Sport', 'https://example.test/rss');
    // Pinned against the known first item in tests/fixtures/rss-bbc.xml — all 70
    // items in that fixture carry a media:thumbnail, and this was previously
    // completely uncovered.
    expect(items[0]!.imageUrl).toBe(
      'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/d0fe/live/77f3d980-8d91-11f1-800e-433295bded5e.jpg',
    );
  });

  it('yields a null imageUrl when an item has neither media:thumbnail nor enclosure', async () => {
    const body = feedXml([{ title: 'No image here', link: 'https://x.test/1' }]);
    const items = await new RssClient({ fetchImpl: fetchImplFor(body) }).fetchFeed('X', 'https://example.test/rss');
    expect(items).toHaveLength(1);
    expect(items[0]!.imageUrl).toBeNull();
  });

  it('does not throw when an item carries an unparseable pubDate, and stores a null date rather than guessing "now"', async () => {
    // Proves finding 1's per-item fix: a malformed date must not kill its own
    // feed's other items. Before the fix, `new Date('garbage-date').toISOString()`
    // threw an uncaught RangeError here, and fetchFeed's promise rejected instead
    // of resolving to [] or to the parsed items. A *later* fix replaced that crash
    // with a `new Date().toISOString()` fallback -- itself a bug, since it stored
    // a fabricated "now" as the article's real publication date. The correct
    // behaviour is neither: publishedAt must be null, an honest "unknown".
    const body = feedXml([
      { title: 'Healthy item before the bad one', link: 'https://x.test/1' },
      { title: 'Item with an unparseable pubDate', link: 'https://x.test/2', pubDate: 'garbage-date' },
      { title: 'Healthy item after the bad one', link: 'https://x.test/3' },
    ]);
    const items = await new RssClient({ fetchImpl: fetchImplFor(body) }).fetchFeed('X', 'https://example.test/rss');
    expect(items).toHaveLength(3);
    const titles = items.map((i) => i.title);
    expect(titles).toContain('Healthy item before the bad one');
    expect(titles).toContain('Item with an unparseable pubDate');
    expect(titles).toContain('Healthy item after the bad one');
    const bad = items.find((i) => i.title === 'Item with an unparseable pubDate')!;
    expect(bad.publishedAt).toBeNull();
  });

  it('stores a null published date, not a fabricated "now", when an item carries no date at all', async () => {
    const xmlNoDate =
      '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test Feed</title>' +
      '<item><title><![CDATA[No date here]]></title><link>https://x.test/no-date</link></item>' +
      '</channel></rss>';
    const items = await new RssClient({ fetchImpl: fetchImplFor(xmlNoDate) }).fetchFeed('X', 'https://example.test/rss');
    expect(items).toHaveLength(1);
    expect(items[0]!.publishedAt).toBeNull();
  });
});

// Branches a fetchImpl over the three real FEEDS URLs so RssClient.fetchAll() itself
// (not a hand-rolled re-implementation of its dedupe loop) is what's under test.
function fetchImplForFeeds(bodies: { bbc?: string; guardian?: string; sky?: string }): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u === FEEDS[0]!.url) {
      if (bodies.bbc === undefined) throw new Error('simulated failure for BBC Sport');
      return new Response(bodies.bbc, { status: 200 });
    }
    if (u === FEEDS[1]!.url) {
      if (bodies.guardian === undefined) throw new Error('simulated failure for The Guardian');
      return new Response(bodies.guardian, { status: 200 });
    }
    if (u === FEEDS[2]!.url) {
      if (bodies.sky === undefined) throw new Error('simulated failure for Sky Sports');
      return new Response(bodies.sky, { status: 200 });
    }
    throw new Error(`unexpected feed url in test: ${u}`);
  }) as unknown as typeof fetch;
}

describe('RssClient.fetchAll', () => {
  it('collapses the same story syndicated across two of the three real feeds into a single item, keeping the first-listed feed\'s copy', async () => {
    const shared = 'Same Headline Across Feeds';
    const bbcBody = feedXml([{ title: shared, link: 'https://bbc.test/story' }]);
    const guardianBody = feedXml([{ title: 'Guardian-only headline', link: 'https://guardian.test/only' }]);
    // Sky Sports carries the same story as BBC Sport, syndicated with different
    // casing and a different URL — the real-world shape of a wire-copy duplicate.
    const skyBody = feedXml([{ title: shared.toUpperCase(), link: 'https://sky.test/story' }]);

    const client = new RssClient({
      fetchImpl: fetchImplForFeeds({ bbc: bbcBody, guardian: guardianBody, sky: skyBody }),
    });
    const items = await client.fetchAll();

    const matches = items.filter((i) => i.contentHash === contentHash(shared));
    expect(matches).toHaveLength(1); // collapsed, not duplicated
    // Pin which copy won the collision: FEEDS[0] is BBC Sport, and batches.flat()
    // preserves FEEDS order, so the first-seen (BBC Sport's) copy is kept.
    expect(matches[0]!.source).toBe('BBC Sport');
    expect(matches[0]!.url).toBe('https://bbc.test/story');
    // The non-duplicate story from the other feed still comes through untouched.
    expect(items.some((i) => i.title === 'Guardian-only headline')).toBe(true);
    expect(items).toHaveLength(2);
  });

  it('still returns the other two feeds\' items when one feed has an item with an unparseable pubDate', async () => {
    // Proves finding 1's fetchAll-level fix: before the fix, an uncaught RangeError
    // thrown while formatting one item's date propagated out of fetchFeed(), and
    // Promise.all rejected the whole fetchAll() call — discarding the two healthy
    // feeds along with it. See the "old behaviour" note in the task report for
    // confirmation this reproduces against the pre-fix code.
    const bbcBody = feedXml([{ title: 'Healthy BBC story', link: 'https://bbc.test/1' }]);
    const guardianBody = feedXml([{ title: 'Healthy Guardian story', link: 'https://guardian.test/1' }]);
    const skyBody = feedXml([
      { title: 'Sky story with a bad date', link: 'https://sky.test/1', pubDate: 'garbage-date' },
    ]);

    const client = new RssClient({
      fetchImpl: fetchImplForFeeds({ bbc: bbcBody, guardian: guardianBody, sky: skyBody }),
    });
    const items = await client.fetchAll();

    const titles = items.map((i) => i.title);
    expect(titles).toContain('Healthy BBC story');
    expect(titles).toContain('Healthy Guardian story');
    // The malformed-date item isn't dropped either — it's kept with a fallback
    // timestamp instead of taking its feed (or the whole call) down.
    expect(titles).toContain('Sky story with a bad date');
    expect(items).toHaveLength(3);
  });

  it('still returns the other two feeds\' items when one feed rejects outright (network/DNS failure)', async () => {
    const bbcBody = feedXml([{ title: 'Healthy BBC story', link: 'https://bbc.test/1' }]);
    const skyBody = feedXml([{ title: 'Healthy Sky story', link: 'https://sky.test/1' }]);

    // bodies.guardian left undefined -> fetchImplForFeeds throws for that URL.
    const client = new RssClient({ fetchImpl: fetchImplForFeeds({ bbc: bbcBody, sky: skyBody }) });
    const items = await client.fetchAll();

    const titles = items.map((i) => i.title);
    expect(titles).toContain('Healthy BBC story');
    expect(titles).toContain('Healthy Sky story');
    expect(items).toHaveLength(2);
  });
});

function feedXml(items: Array<{ title: string; link: string; pubDate?: string }>): string {
  const itemsXml = items
    .map(
      (it) =>
        `<item><title><![CDATA[${it.title}]]></title><link>${it.link}</link><description><![CDATA[summary]]></description><pubDate>${it.pubDate ?? 'Mon, 03 Aug 2026 07:49:33 GMT'}</pubDate></item>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test Feed</title>${itemsXml}</channel></rss>`;
}
