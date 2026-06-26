import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import {
  DEFAULT_SPEED,
  KEYBOARD_SPEED_STEP,
  MAX_SPEED,
  MIN_SPEED,
  type GetSpeedResponse,
  type Message,
} from '@/utils/types';
import { flashSpeed, toggleOverlay } from './overlay';

// The content script runs in the context of the web page. It's the only part
// of the extension that can touch the page's <video> element. The popup talks
// to it via messages (see utils/messaging.ts).
//
// `defineContentScript` is WXT's wrapper: the `matches` array becomes the
// manifest's content_scripts match patterns (which URLs we run on), and
// `main` runs once the script is injected. `*://*/*` = all http/https pages,
// since "any site with HTML5 video" could be anywhere.
export default defineContentScript({
  matches: ['*://*/*'],
  main() {
    // --- In-memory state -------------------------------------------------
    // currentSpeed lives only for this page load. Free tier intentionally does
    // NOT persist speed — every new page/video starts at 1x. Persistence is a
    // Pro feature (per-site profiles) handled in a later build step.
    let currentSpeed = DEFAULT_SPEED;
    let video: HTMLVideoElement | null = null;

    /** Clamp to the allowed range and round to avoid float drift. */
    function clampSpeed(speed: number): number {
      const bounded = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
      return Number(bounded.toFixed(2));
    }

    /** Apply a speed to the current video, update state, and flash the badge. */
    function applySpeed(speed: number): void {
      currentSpeed = clampSpeed(speed);
      if (video) video.playbackRate = currentSpeed;
      flashSpeed(currentSpeed);
    }

    // --- Video detection (SPA- and shadow-DOM-safe) ---------------------
    // Two complications to handle:
    //   1. SPA sites (YouTube/Udemy) inject the <video> after this script
    //      runs, and swap it out on in-page navigation without a reload.
    //   2. Some players (e.g. Mux Player on Laracasts) put the <video> inside
    //      a Web Component's SHADOW DOM. A normal document.querySelector and a
    //      normal MutationObserver cannot see into shadow roots, so we have to
    //      search through them explicitly.
    function bindVideo(el: HTMLVideoElement): void {
      if (video === el) return; // already bound to this exact element
      video = el;
      // New video element = new content. Reset to 1x (free-tier behavior),
      // rather than inheriting the previous video's speed.
      currentSpeed = DEFAULT_SPEED;
      video.playbackRate = currentSpeed;
    }

    // Recursively search the document AND any open shadow roots for the first
    // <video>. `querySelectorAll('*')` only returns a root's own elements, so
    // at each element that hosts a shadow root we recurse into it.
    function findVideoDeep(
      root: Document | ShadowRoot = document,
    ): HTMLVideoElement | null {
      for (const el of root.querySelectorAll<HTMLElement>('*')) {
        if (el instanceof HTMLVideoElement) return el;
        if (el.shadowRoot) {
          const inner = findVideoDeep(el.shadowRoot);
          if (inner) return inner;
        }
      }
      return null;
    }

    function tryFindVideo(): void {
      // Fast path first: a plain top-level query covers the common case
      // cheaply. Only pay for the deep shadow-DOM walk if that misses.
      const el = document.querySelector('video') ?? findVideoDeep();
      if (el) {
        bindVideo(el);
        stopPolling(); // found it — no need to keep scanning
      }
    }

    // Polling fallback: the MutationObserver below cannot see videos that
    // appear *inside* shadow DOM, so we also scan on a 1s timer — but only
    // while we have no connected video, to avoid wasting CPU once we're bound.
    let pollTimer: number | undefined;
    function startPolling(): void {
      if (pollTimer === undefined) {
        pollTimer = window.setInterval(tryFindVideo, 1000);
      }
    }
    function stopPolling(): void {
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    }

    tryFindVideo(); // in case the video is already present at injection time
    if (!video) startPolling();

    // MutationObserver is the fast path for ordinary (light-DOM) SPA sites: it
    // fires on DOM changes so we can rebind promptly when the video appears or
    // is replaced. When our video is gone, we re-scan and re-arm the poll (for
    // the shadow-DOM case the observer can't see).
    const observer = new MutationObserver(() => {
      if (!video || !video.isConnected) {
        video = null;
        tryFindVideo();
        if (!video) startPolling();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // --- Keyboard shortcuts ---------------------------------------------
    // Defaults mirror Video Speed Controller so switchers keep their muscle
    // memory. (Customization comes later via the options page.) L and N are
    // Pro-gated features (A-B loop, notes) handled in a later build step — not
    // bound yet.
    function shouldIgnoreKey(e: KeyboardEvent): boolean {
      // Don't hijack keys the OS/browser owns (Cmd+R reload, Ctrl+S save, …).
      if (e.ctrlKey || e.metaKey || e.altKey) return true;
      // Don't fire while the user is typing in a field.
      const t = e.target as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        t.isContentEditable
      );
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (shouldIgnoreKey(e)) return;
      // e.code is the physical key ("KeyS"), independent of shift/caps lock.
      let handled = true;
      switch (e.code) {
        case 'KeyS': // decrease speed
          applySpeed(currentSpeed - KEYBOARD_SPEED_STEP);
          break;
        case 'KeyD': // increase speed
          applySpeed(currentSpeed + KEYBOARD_SPEED_STEP);
          break;
        case 'KeyR': // reset to 1x
          applySpeed(DEFAULT_SPEED);
          break;
        case 'KeyZ': // rewind 10s
          if (video) video.currentTime -= 10;
          break;
        case 'KeyX': // advance 10s
          if (video) video.currentTime += 10;
          break;
        case 'KeyV': // toggle the flash indicator
          toggleOverlay();
          break;
        default:
          handled = false;
      }
      // If we acted on the key, stop the page from also reacting to it
      // (e.g. a site that uses "s" for its own shortcut).
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    // `capture: true` runs our handler before the page's own listeners, so our
    // stopPropagation can actually prevent the site from seeing the key.
    document.addEventListener('keydown', onKeyDown, { capture: true });

    // --- Messaging (from the popup) -------------------------------------
    // The popup sends SET_SPEED when the slider moves, and GET_SPEED when it
    // opens (to display the current speed). Returning a value from an async
    // listener sends it back as the response.
    browser.runtime.onMessage.addListener(async (message: Message) => {
      switch (message.type) {
        case 'SET_SPEED':
          applySpeed(message.speed);
          return;
        case 'GET_SPEED':
          return { speed: currentSpeed } satisfies GetSpeedResponse;
      }
    });
  },
});
