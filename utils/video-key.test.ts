import { describe, it, expect } from 'vitest';
import { deriveVideoKey } from './video-key';

describe('deriveVideoKey', () => {
  it('uses the video id for a YouTube watch URL', () => {
    expect(deriveVideoKey('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'youtube:dQw4w9WgXcQ',
    );
  });

  it('ignores extra YouTube query params', () => {
    expect(
      deriveVideoKey('https://www.youtube.com/watch?v=abc123&t=42s&list=PL1'),
    ).toBe('youtube:abc123');
  });

  it('falls back to host and path for YouTube URLs with no v param', () => {
    expect(deriveVideoKey('https://www.youtube.com/feed/subscriptions')).toBe(
      'www.youtube.com/feed/subscriptions',
    );
  });

  it('uses the numeric id for a Vimeo URL', () => {
    expect(deriveVideoKey('https://vimeo.com/123456789')).toBe(
      'vimeo:123456789',
    );
  });

  it('produces the same key for a Udemy lecture with and without query', () => {
    const withQuery = deriveVideoKey(
      'https://www.udemy.com/course/ml/learn/lecture/15862912?start=360#overview',
    );
    const withoutQuery = deriveVideoKey(
      'https://www.udemy.com/course/ml/learn/lecture/15862912',
    );
    expect(withQuery).toBe(withoutQuery);
    expect(withQuery).toBe('www.udemy.com/course/ml/learn/lecture/15862912');
  });

  it('falls back to host and path for unknown sites', () => {
    expect(deriveVideoKey('https://laracasts.com/series/x/episodes/1')).toBe(
      'laracasts.com/series/x/episodes/1',
    );
  });

  it('returns the input unchanged when the URL is malformed', () => {
    expect(deriveVideoKey('not a url')).toBe('not a url');
  });
});
