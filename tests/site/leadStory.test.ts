import { describe, it, expect } from 'vitest';
import { selectLeadStory } from '@/lib/site/leadStory';
import type { NewsRow } from '@/lib/site/rows';

/** Builds a minimal NewsRow, newest-first order controlled by the caller via `published_at`. */
function row(overrides: Partial<NewsRow> & { id: number }): NewsRow {
  return {
    source: 'BBC Sport',
    title: 'A real headline about a match',
    summary: null,
    url: `https://example.com/${overrides.id}`,
    image_url: null,
    published_at: '2026-08-04T12:00:00Z',
    categories: [],
    ...overrides,
  };
}

describe('selectLeadStory', () => {
  it('returns undefined for an empty list', () => {
    expect(selectLeadStory([])).toBeUndefined();
  });

  it('picks the newest item when nothing else distinguishes the candidates', () => {
    const newest = row({ id: 1, published_at: '2026-08-04T12:00:00Z', image_url: 'https://img/1.jpg' });
    const older = row({ id: 2, published_at: '2026-08-04T10:00:00Z', image_url: 'https://img/2.jpg' });
    // Caller (getTrendingNews) is newest-first — that ordering is the contract.
    expect(selectLeadStory([newest, older])).toBe(newest);
  });

  it('strongly prefers an item with an image over a newer one without', () => {
    const newerNoImage = row({ id: 1, published_at: '2026-08-04T12:00:00Z', image_url: null });
    const olderWithImage = row({ id: 2, published_at: '2026-08-04T09:00:00Z', image_url: 'https://img/2.jpg' });
    expect(selectLeadStory([newerNoImage, olderWithImage])).toBe(olderWithImage);
  });

  it('deprioritises a promo/meta title even when it is newest and has an image', () => {
    const promo = row({
      id: 1,
      published_at: '2026-08-04T12:00:00Z',
      image_url: 'https://img/1.jpg',
      title: 'Get live score updates for your football team on your lock screen for 2026-27',
    });
    const genuine = row({
      id: 2,
      published_at: '2026-08-04T08:00:00Z',
      image_url: 'https://img/2.jpg',
      title: 'Arsenal close in on deadline-day move',
    });
    expect(selectLeadStory([promo, genuine])).toBe(genuine);
  });

  it.each([
    'Get live score updates for your football team',
    'How to follow the new season on TV',
    'Watch: the best goals of the week',
    'Listen: this week\'s big preview',
    'Follow live: transfer deadline day',
    'Download the app for updates on your lock screen',
  ])('recognises %j as a promo title', (title) => {
    const promo = row({ id: 1, title, image_url: 'https://img/1.jpg', published_at: '2026-08-04T12:00:00Z' });
    const genuine = row({
      id: 2,
      title: 'A real transfer story',
      image_url: 'https://img/2.jpg',
      published_at: '2026-08-04T06:00:00Z',
    });
    expect(selectLeadStory([promo, genuine])).toBe(genuine);
  });

  it('among items that are otherwise equally ranked, prefers recency', () => {
    const newer = row({ id: 1, published_at: '2026-08-04T12:00:00Z', image_url: 'https://img/1.jpg' });
    const older = row({ id: 2, published_at: '2026-08-04T11:00:00Z', image_url: 'https://img/2.jpg' });
    const oldest = row({ id: 3, published_at: '2026-08-04T10:00:00Z', image_url: null });
    expect(selectLeadStory([newer, older, oldest])).toBe(newer);
  });

  it('falls back to the newest item rather than rendering no hero, even when every candidate is a promo with no image', () => {
    const newestPromo = row({
      id: 1,
      published_at: '2026-08-04T12:00:00Z',
      image_url: null,
      title: 'Get the app for live updates on your lock screen',
    });
    const olderPromo = row({
      id: 2,
      published_at: '2026-08-04T09:00:00Z',
      image_url: null,
      title: 'Watch: highlights from the weekend',
    });
    expect(selectLeadStory([newestPromo, olderPromo])).toBe(newestPromo);
  });

  it('never rewrites the selected item — returns the exact same object', () => {
    const only = row({ id: 1, title: 'Whatever the headline says' });
    const selected = selectLeadStory([only]);
    expect(selected).toBe(only);
    expect(selected?.title).toBe('Whatever the headline says');
  });
});
