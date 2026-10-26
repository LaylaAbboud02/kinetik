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

  it('uses the id param for the Microsoft Learn embedded player', () => {
    const embed =
      'https://learn.microsoft.com/_themes/docs.theme/master/en-us/_themes/global/video-embed-one-stream.html?id=ea041e4b-a1ed&locale=en-gb';
    expect(deriveVideoKey(embed)).toBe('mslearn:ea041e4b-a1ed');
  });

  it('gives different Microsoft Learn videos different keys', () => {
    const base =
      'https://learn.microsoft.com/_themes/docs.theme/master/en-us/_themes/global/video-embed-one-stream.html';
    expect(deriveVideoKey(`${base}?id=aaa`)).not.toBe(
      deriveVideoKey(`${base}?id=bbb`),
    );
  });

  it('handles the Microsoft Learn player before its redirect', () => {
    expect(
      deriveVideoKey('https://learn-video.azurefd.net/vod/player?id=ea041e4b-a1ed'),
    ).toBe('mslearn:ea041e4b-a1ed');
  });

  it('returns the input unchanged when the URL is malformed', () => {
    expect(deriveVideoKey('not a url')).toBe('not a url');
  });
});
