/**
 * Render-time image URL upgrading — never touches what ingestion stores
 * (`news_items.image_url` stays exactly what the feed gave us). This is a
 * pure display-layer transform applied wherever an image is actually
 * rendered (components/Hero.tsx, components/NewsCard.tsx).
 *
 * Diagnosed cause: BBC's ichef CDN URLs look like
 * `https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/<hash>/live/<id>.jpg`
 * — that `240` is a width segment, and the stored URLs are all thumbnail
 * width (~7KB), stretched up to card/hero size by the browser. The same
 * asset is available at other widths by swapping that one path segment;
 * measured sizes (240/480/800/1024/1536) all come back non-error from the
 * CDN, so this is a safe, same-asset upgrade, not a guess.
 *
 * Every other source (Sky's e1/e2.365dm.com, already 1920x1080; the
 * Guardian, which stores no image at all) is returned unchanged — there is
 * no equivalent width-segment trick for them, and inventing one would risk
 * serving a broken image.
 */

// Matches exactly `https://ichef.bbci.co.uk/<segment>/<segment>/<digits>/<rest>`
// — e.g. `.../ace/standard/240/cpsprodpb/1eb2/live/<id>.jpg`. Deliberately
// strict (two fixed segments, then a purely-numeric width segment, then at
// least one more segment) so a URL that merely starts with the right host
// but has an unexpected shape — no width segment, a non-numeric one, too
// few segments — falls through to "return unchanged" rather than getting a
// digit string spliced into the wrong place.
const BBC_ICHEF_WIDTH_SEGMENT = /^(https:\/\/ichef\.bbci\.co\.uk\/[^/?#]+\/[^/?#]+\/)\d+(\/[^?#]+)$/;

/**
 * Returns `url` rewritten to request `width` pixels wide, when the source
 * is recognised as supporting that (currently: BBC's ichef CDN only).
 * Anything else — including a malformed string, a non-BBC host, or a BBC
 * ichef URL whose path doesn't match the expected shape — is returned
 * exactly as given. Never throws.
 */
export function upgradeImageUrl(url: string, width: number): string {
  if (typeof url !== 'string' || url.length === 0) return url;
  if (!Number.isFinite(width) || width <= 0) return url;

  try {
    const match = BBC_ICHEF_WIDTH_SEGMENT.exec(url);
    if (!match) return url;
    const [, prefix, rest] = match;
    return `${prefix}${Math.round(width)}${rest}`;
  } catch {
    // Defensive only — the regex above can't actually throw on a string
    // input, but the contract ("must never throw") is worth enforcing
    // structurally rather than trusting that to stay true forever.
    return url;
  }
}
