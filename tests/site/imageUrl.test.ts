import { describe, it, expect } from 'vitest';
import { upgradeImageUrl } from '@/lib/site/imageUrl';

describe('upgradeImageUrl', () => {
  it('upgrades a BBC ichef URL to the requested width', () => {
    const url = 'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/1eb2/live/62bbe1d0-abcd-1234-9876-abcdef012345.jpg';
    expect(upgradeImageUrl(url, 800)).toBe(
      'https://ichef.bbci.co.uk/ace/standard/800/cpsprodpb/1eb2/live/62bbe1d0-abcd-1234-9876-abcdef012345.jpg',
    );
  });

  it('leaves a Sky (365dm.com) URL untouched — already full resolution', () => {
    const url = 'https://e1.365dm.com/26/08/1920x1080/skysports-photo_6789012.jpg';
    expect(upgradeImageUrl(url, 800)).toBe(url);
  });

  it('leaves a Sky e2 URL untouched too', () => {
    const url = 'https://e2.365dm.com/26/08/1920x1080/skysports-photo_1122334.jpg';
    expect(upgradeImageUrl(url, 1536)).toBe(url);
  });

  it('returns a malformed URL unchanged rather than throwing', () => {
    expect(upgradeImageUrl('not a url at all', 800)).toBe('not a url at all');
    expect(upgradeImageUrl('', 800)).toBe('');
  });

  it('returns a BBC ichef URL with an unusual path shape unchanged, rather than mangling it', () => {
    // No width segment at all.
    expect(upgradeImageUrl('https://ichef.bbci.co.uk/images/logo.jpg', 800))
      .toBe('https://ichef.bbci.co.uk/images/logo.jpg');
    // Width segment present but nothing after it to preserve.
    expect(upgradeImageUrl('https://ichef.bbci.co.uk/ace/standard/240', 800))
      .toBe('https://ichef.bbci.co.uk/ace/standard/240');
    // Non-numeric "width" segment.
    expect(upgradeImageUrl('https://ichef.bbci.co.uk/ace/standard/wide/cpsprodpb/x.jpg', 800))
      .toBe('https://ichef.bbci.co.uk/ace/standard/wide/cpsprodpb/x.jpg');
  });

  it('never throws on non-string-ish edge cases', () => {
    // @ts-expect-error — deliberately exercising the runtime guard against a caller that ignores the type.
    expect(() => upgradeImageUrl(null, 800)).not.toThrow();
    // @ts-expect-error — same as above.
    expect(upgradeImageUrl(undefined, 800)).toBe(undefined);
  });
});
