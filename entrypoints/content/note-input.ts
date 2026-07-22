// The inline text box shown over the video when the user presses N.
//
// Exposes a promise-based API: promptForNote() resolves with the typed text,
// or null if the user cancelled. The caller (content script) handles pausing,
// saving, and resuming — this module only collects text.

let container: HTMLDivElement | null = null;

/**
 * Show a focused input over the video and resolve with what the user typed.
 * Resolves null on Escape, on an empty/whitespace-only entry, or if a prompt
 * is already open.
 */
export function promptForNote(): Promise<string | null> {
  if (container) return Promise.resolve(null); // already open

  return new Promise((resolve) => {
    const box = document.createElement('div');
    // Inline styles so the host page's CSS cannot restyle or hide our UI.
    Object.assign(box.style, {
      position: 'fixed',
      bottom: '15%',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '12px 14px',
      background: 'rgba(0, 0, 0, 0.88)',
      borderRadius: '10px',
      boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
    } satisfies Partial<CSSStyleDeclaration>);

    const label = document.createElement('span');
    label.textContent = 'Note (Enter to save, Esc to cancel)';
    Object.assign(label.style, {
      color: 'rgba(255, 255, 255, 0.75)',
      font: '400 11px/1 system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'What happened here?';
    Object.assign(input.style, {
      width: '320px',
      maxWidth: '60vw',
      padding: '8px 10px',
      border: '1px solid rgba(255, 255, 255, 0.25)',
      borderRadius: '6px',
      background: '#fff',
      color: '#111',
      font: '400 14px/1.2 system-ui, sans-serif',
      outline: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    box.append(label, input);
    container = box;

    // Re-parent into the fullscreen element, otherwise the box is not rendered
    // at all during fullscreen playback.
    const parent = document.fullscreenElement ?? document.body;
    parent.appendChild(box);
    input.focus();

    // Removing a focused element fires `blur` SYNCHRONOUSLY, mid-removal.
    // Without the `closed` guard, the blur handler re-enters close(), its
    // box.remove() throws NotFoundError because the node is already detaching,
    // and that exception propagates back up and aborts the first close()
    // before it can resolve — leaving the promise pending forever.
    let closed = false;
    const onBlur = () => close(null);

    const close = (value: string | null) => {
      if (closed) return;
      closed = true;
      input.removeEventListener('blur', onBlur);
      container = null;
      // Resolve before touching the DOM so the caller is never left hanging
      // even if removal fails for some page-specific reason.
      resolve(value);
      box.remove();
    };

    input.addEventListener('keydown', (e) => {
      // CRITICAL: stop every keystroke from reaching the page. Without this,
      // typing "s" would fire YouTube's own keyboard shortcuts mid-note.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = input.value.trim();
        close(text.length > 0 ? text : null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    });

    // Clicking away cancels rather than leaving an orphaned box on screen.
    input.addEventListener('blur', onBlur);
  });
}
