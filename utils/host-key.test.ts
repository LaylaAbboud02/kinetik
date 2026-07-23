import { describe, it, expect } from 'vitest';
import { deriveHostKey } from './host-key';

describe('deriveHostKey', () => {
  it('strips a leading www so both forms share one profile', () => {
    expect(deriveHostKey('https://www.udemy.com/course/x')).toBe('udemy.com');
    expect(deriveHostKey('https://udemy.com/course/x')).toBe('udemy.com');
  });

  it('lowercases the hostname', () => {
    expect(deriveHostKey('https://WWW.YouTube.com/watch?v=abc')).toBe(
      'youtube.com',
    );
  });

  it('drops the port', () => {
    expect(deriveHostKey('http://localhost:3000/video')).toBe('localhost');
  });

  it('keeps subdomains other than www', () => {
    expect(deriveHostKey('https://app.example.com/watch')).toBe(
      'app.example.com',
    );
  });

  it('returns the input unchanged when the URL is malformed', () => {
    expect(deriveHostKey('not a url')).toBe('not a url');
  });
});
