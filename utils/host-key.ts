// Derives the key a per-site profile is stored under.
//
// Deliberately separate from utils/video-key.ts: that identifies ONE VIDEO
// (for notes, e.g. "youtube:dQw4w9WgXcQ"), this identifies A SITE (for
// profiles, e.g. "youtube.com"). Same input, different granularity.
//
// Takes a URL string rather than reading window.location so it can be tested.
export function deriveHostKey(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Never return an empty key — a profile would be saved against nothing.
    return url;
  }
  // `hostname` (unlike `host`) already excludes the port, which is what we
  // want: a profile should apply regardless of port.
  const host = parsed.hostname.toLowerCase();
  // Strip www. so www.udemy.com and udemy.com are one profile, not two.
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** The profile key for the page this content script is running on. */
export function getHostKey(): string {
  return deriveHostKey(window.location.href);
}
