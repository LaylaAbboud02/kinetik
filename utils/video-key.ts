// Derives a stable identifier for a video, used to key its notes.
//
// The page URL alone is not reliable: YouTube puts the video id in a `v` query
// param alongside params that vary (playlist, timestamp), and many sites append
// tracking or resume params. So we special-case known sites and otherwise fall
// back to host + path with the query string dropped.
//
// Takes a URL string rather than reading window.location so it can be tested.
export function deriveVideoKey(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Never return an empty key — a note would be attached to nothing.
    return url;
  }

  const host = parsed.hostname;

  if (host.includes('youtube.com')) {
    const videoId = parsed.searchParams.get('v');
    if (videoId) return `youtube:${videoId}`;
  }

  if (host.includes('vimeo.com')) {
    const match = parsed.pathname.match(/\/(\d+)/);
    if (match) return `vimeo:${match[1]}`;
  }

  // Microsoft Learn plays videos in an embedded player (an iframe) whose path
  // is identical for every video — the video is identified ONLY by its `id`
  // param, so the query-dropping fallback below would merge every video's
  // notes into one. The iframe starts on learn-video.azurefd.net and redirects
  // to a learn.microsoft.com video-embed page; handle both.
  const isMsLearnPlayer =
    host === 'learn-video.azurefd.net' ||
    (host === 'learn.microsoft.com' && parsed.pathname.includes('/video-embed'));
  if (isMsLearnPlayer) {
    const videoId = parsed.searchParams.get('id');
    if (videoId) return `mslearn:${videoId}`;
  }

  // Fallback: host + path, deliberately WITHOUT search or hash, so the same
  // lecture reached with ?start=360#overview matches the plain URL.
  return `${host}${parsed.pathname}`;
}

/** The key for the page this content script is running on. */
export function getVideoKey(): string {
  return deriveVideoKey(window.location.href);
}
