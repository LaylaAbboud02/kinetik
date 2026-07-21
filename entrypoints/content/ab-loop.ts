import { formatTime, shouldJumpBack, type ABLoop } from '@/utils/loop';

// Owns the on-page side of A-B looping: the persistent badge shown while a
// loop is active, and the timeupdate listener that jumps playback back to A.
// The loop STATE lives in the content script; this module renders and enforces
// whatever state it is handed.

let badge: HTMLDivElement | null = null;

function ensureBadge(): HTMLDivElement {
  if (badge) return badge;
  const el = document.createElement('div');
  // Inline styles for the same reason as the flash overlay: the host page's
  // CSS can't be allowed to restyle or hide our UI.
  Object.assign(el.style, {
    position: 'fixed',
    top: '12%',
    right: '3%',
    zIndex: '2147483647',
    padding: '6px 12px',
    background: 'rgba(0, 0, 0, 0.75)',
    color: '#fff',
    font: '600 14px/1 system-ui, sans-serif',
    borderRadius: '6px',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  badge = el;
  return el;
}

/** Show or hide the persistent loop badge to match the given state. */
export function renderBadge(loop: ABLoop): void {
  if (!loop.enabled || loop.pointA === null || loop.pointB === null) {
    badge?.remove();
    return;
  }
  const el = ensureBadge();
  // Re-parent when fullscreen, otherwise the badge isn't rendered at all.
  const parent = document.fullscreenElement ?? document.body;
  if (el.parentElement !== parent) parent.appendChild(el);
  el.textContent = `⟳ ${formatTime(loop.pointA)} – ${formatTime(loop.pointB)}`;
}

/**
 * Attach the loop enforcement listener to a video.
 *
 * `getLoop` is a callback rather than a value because the content script owns
 * the state and it changes over time; reading it fresh on each tick keeps this
 * module stateless.
 *
 * Returns a cleanup function that detaches the listener.
 */
export function attach(
  video: HTMLVideoElement,
  getLoop: () => ABLoop,
): () => void {
  const onTimeUpdate = () => {
    const loop = getLoop();
    if (shouldJumpBack(loop, video.currentTime) && loop.pointA !== null) {
      video.currentTime = loop.pointA;
    }
  };
  // timeupdate fires ~4x/second, so playback can overshoot pointB slightly
  // before jumping back. Acceptable for study loops.
  video.addEventListener('timeupdate', onTimeUpdate);
  return () => video.removeEventListener('timeupdate', onTimeUpdate);
}
