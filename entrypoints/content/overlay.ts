// The on-screen "flash" indicator: a small badge (e.g. "2.5×") that appears
// briefly when the speed changes, then fades out. This is feedback only — not
// a control. The popup is the real control surface.
//
// Design choices worth understanding:
// - We use INLINE styles. Content scripts share the DOM with the host page, so
//   any class names or stylesheet we inject could collide with or be
//   overridden by the page's own CSS. Inline styles on the element itself win
//   against the page's normal rules and need no separate stylesheet.
// - On speed change we re-parent the badge into `document.fullscreenElement`
//   when a video is fullscreen. A `document.body` child is not rendered while
//   another element is fullscreen, so the badge would be invisible otherwise.

let badge: HTMLDivElement | null = null;
let hideTimer: number | undefined;

// The V shortcut toggles whether the flash appears on speed changes.
let enabled = true;

/** Format a speed for display: 2.5 -> "2.5", 1 -> "1", 1.75 -> "1.75". */
function formatSpeed(speed: number): string {
  // Round to 2 decimals to avoid floating-point noise like 1.7500000001,
  // then Number() drops trailing zeros (1.50 -> 1.5, 2.00 -> 2).
  return String(Number(speed.toFixed(2)));
}

function ensureBadge(): HTMLDivElement {
  if (badge) return badge;
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    top: '12%',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647', // max 32-bit int: sit above virtually any page UI
    padding: '8px 16px',
    background: 'rgba(0, 0, 0, 0.8)',
    color: '#fff',
    font: '600 22px/1 system-ui, sans-serif',
    borderRadius: '8px',
    pointerEvents: 'none', // never intercept clicks meant for the page
    opacity: '0',
    transition: 'opacity 0.25s ease',
  } satisfies Partial<CSSStyleDeclaration>);
  badge = el;
  return el;
}

/** Show the speed badge briefly, then fade it out (no-op if disabled). */
export function flashSpeed(speed: number): void {
  if (!enabled) return;
  const el = ensureBadge();
  const parent = document.fullscreenElement ?? document.body;
  if (el.parentElement !== parent) parent.appendChild(el);

  el.textContent = `${formatSpeed(speed)}×`; // × is the × symbol
  el.style.opacity = '1';

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    el.style.opacity = '0';
  }, 1500);
}

/** Toggle whether the flash indicator appears (bound to the V shortcut). */
export function toggleOverlay(): boolean {
  enabled = !enabled;
  return enabled;
}
