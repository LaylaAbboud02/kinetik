import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import {
  DEFAULT_SILENCE_THRESHOLD,
  DEFAULT_SPEED,
  KEYBOARD_SPEED_STEP,
  MAX_SPEED,
  MIN_SPEED,
  type GetSpeedResponse,
  type LoopState,
  type Message,
  type NotesState,
  type SiteContext,
  type SkipSilenceState,
} from '@/utils/types';
import { flashMessage, flashSpeed, toggleOverlay } from './overlay';
import * as skipSilence from './skip-silence';
import * as abLoop from './ab-loop';
import { promptForNote } from './note-input';
import { getVideoKey } from '@/utils/video-key';
import { getNotes, addNote, deleteNote } from '@/utils/notes';
import { getHostKey } from '@/utils/host-key';
import { getProfile, saveProfile, deleteProfile } from '@/utils/storage';
import {
  DEFAULT_BINDINGS,
  resolveAction,
  getBindings,
  watchBindings,
  type ActionId,
  type Bindings,
} from '@/utils/shortcuts';
import {
  advanceLoop,
  formatTime,
  EMPTY_LOOP,
  type ABLoop,
} from '@/utils/loop';

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
    // userSpeed lives only for this page load. Free tier intentionally does
    // NOT persist speed — every new page/video starts at 1x. Persistence is a
    // Pro feature (per-site profiles) handled in a later build step.
    //
    // Two distinct notions of speed, deliberately kept apart:
    //   - userSpeed: what the USER chose (slider/keyboard). Source of truth.
    //   - the video's actual playbackRate: may be temporarily boosted by
    //     Skip Silence, without disturbing userSpeed.
    let userSpeed = DEFAULT_SPEED;
    let video: HTMLVideoElement | null = null;

    // The rate we intend the video to be playing at right now — userSpeed
    // normally, or the boosted rate while Skip Silence is skipping. Tracked
    // separately so the rate guard below knows what to re-assert when a site's
    // own player overwrites playbackRate.
    let effectiveRate = DEFAULT_SPEED;

    /** Clamp to the allowed range and round to avoid float drift. */
    function clampSpeed(speed: number): number {
      const bounded = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
      return Number(bounded.toFixed(2));
    }

    /** User-initiated change: stores the speed, applies it, flashes the badge. */
    function setUserSpeed(speed: number): void {
      userSpeed = clampSpeed(speed);
      setEffectiveRate(userSpeed);
      flashSpeed(userSpeed);
    }

    /**
     * Automatic rate change (Skip Silence). Sets playbackRate ONLY — it does
     * not change userSpeed and does not flash the badge, which would otherwise
     * strobe constantly as we dip in and out of silence.
     */
    function setEffectiveRate(rate: number): void {
      effectiveRate = rate;
      if (video) video.playbackRate = rate;
    }

    /**
     * Sites like Udemy reset playbackRate to their own preferred speed when
     * playback starts, wiping out whatever we applied. So we watch for rate
     * changes we didn't make and re-assert ours.
     *
     * Ignores a rate of 0: players use it while stalling or buffering, and
     * forcing a real speed there would fight the player's own state handling.
     */
    function guardRate(): void {
      if (!video) return;
      const actual = video.playbackRate;
      if (actual === 0) return;
      if (Math.abs(actual - effectiveRate) < 0.01) return;
      video.playbackRate = effectiveRate;
    }

    /** Return the video to the user's chosen speed. */
    function restoreUserSpeed(): void {
      setEffectiveRate(userSpeed);
    }

    // --- Skip Silence state (ephemeral this step) ------------------------
    // Not persisted: per-site persistence is a Pro behavior gated in step 5.
    let skipSilenceEnabled = false;
    let silenceThreshold = DEFAULT_SILENCE_THRESHOLD;

    // How skip-silence reaches back into speed control. Passing these as hooks
    // keeps the audio module ignorant of user-speed bookkeeping.
    const skipSilenceHooks: skipSilence.SkipSilenceHooks = {
      setRate: setEffectiveRate,
      restore: restoreUserSpeed,
    };

    // --- A-B Loop state (ephemeral, per CLAUDE.md §5) --------------------
    let loop: ABLoop = EMPTY_LOOP;
    let detachLoop: (() => void) | null = null;

    /** Apply new loop state: render the badge and keep enforcement attached. */
    function setLoop(next: ABLoop): void {
      loop = next;
      abLoop.renderBadge(loop);
    }

    /** One press of L: cycle set-A -> set-B/loop -> clear, with feedback. */
    function cycleLoop(): void {
      if (!video) return;
      const { loop: next, outcome } = advanceLoop(loop, video.currentTime);
      setLoop(next);
      switch (outcome) {
        case 'set-a':
          flashMessage(`Loop start ${formatTime(next.pointA ?? 0)}`);
          break;
        case 'looping':
          flashMessage(
            `Looping ${formatTime(next.pointA ?? 0)} – ${formatTime(next.pointB ?? 0)}`,
          );
          break;
        case 'cleared':
          flashMessage('Loop cleared');
          break;
        case 'too-short':
          flashMessage('Loop too short');
          break;
      }
    }

    /**
     * One press of N: pause, collect a note, save it, resume.
     * Playback resumes only if it was actually playing beforehand.
     */
    async function captureNote(): Promise<void> {
      if (!video) return;
      const timestamp = video.currentTime;
      const wasPlaying = !video.paused;
      if (wasPlaying) video.pause();

      const text = await promptForNote();
      if (text) {
        // Surface storage failures instead of dropping them: this function is
        // invoked with `void`, so an unhandled rejection would vanish and the
        // note would silently fail to save.
        try {
          await addNote(getVideoKey(), timestamp, text);
          flashMessage(`Note saved ${formatTime(timestamp)}`);
        } catch (error) {
          console.error('[Kinetik] failed to save note', error);
          flashMessage("Couldn't save note");
        }
      }

      if (wasPlaying) void video.play();
    }

    // --- Video detection (SPA- and shadow-DOM-safe) ---------------------
    // Two complications to handle:
    //   1. SPA sites (YouTube/Udemy) inject the <video> after this script
    //      runs, and swap it out on in-page navigation without a reload.
    //   2. Some players (e.g. Mux Player on Laracasts) put the <video> inside
    //      a Web Component's SHADOW DOM. A normal document.querySelector and a
    //      normal MutationObserver cannot see into shadow roots, so we have to
    //      search through them explicitly.
    // Tracks which media we last reset for, so we can tell a genuinely new
    // video apart from ordinary events on the current one.
    let lastSrc = '';
    let detachSourceWatch: (() => void) | null = null;
    let detachRateGuard: (() => void) | null = null;

    // Guards against a stale profile lookup landing after newer media loaded.
    // Incremented on every reset; the async apply checks it before touching
    // playback.
    let mediaToken = 0;

    /**
     * Start fresh for new content: clear the loop, then apply this site's
     * saved speed (or 1x if there is no profile).
     *
     * Runs for EVERY new media source, not just page load, because SPA sites
     * reuse the <video> element when navigating between videos.
     */
    function resetForNewMedia(): void {
      const token = ++mediaToken;
      setLoop(EMPTY_LOOP); // old timestamps refer to a different video

      // Reset immediately so there is never a window at the previous video's
      // speed, then upgrade to the profile speed once storage answers.
      // Route through setEffectiveRate so effectiveRate resets too — otherwise
      // guardRate sees a stale effectiveRate and snaps the new video back to
      // the previous video's speed.
      userSpeed = DEFAULT_SPEED;
      setEffectiveRate(DEFAULT_SPEED);

      void getProfile(getHostKey())
        .then((profile) => {
          // Media changed again while we were reading storage — discard.
          if (token !== mediaToken || !profile) return;
          userSpeed = profile.speed;
          // setEffectiveRate, not setUserSpeed: auto-apply must not flash the
          // badge. The badge is feedback for user-initiated changes only.
          setEffectiveRate(userSpeed);
        })
        .catch((error) => {
          console.error('[Kinetik] failed to load site profile', error);
        });
    }

    /**
     * SPA sites (YouTube, Udemy) often REUSE the same <video> element and just
     * swap its source when you navigate to another video. In that case
     * bindVideo never runs again, so watching for element changes alone misses
     * the new video entirely. We watch the element's source instead.
     */
    function watchSource(el: HTMLVideoElement): () => void {
      const onSourceEvent = () => {
        const src = el.currentSrc || el.src;
        if (!src || src === lastSrc) return; // same media, ignore
        lastSrc = src;
        resetForNewMedia();
      };
      // These all fire when an element starts playing different content.
      el.addEventListener('loadstart', onSourceEvent);
      el.addEventListener('emptied', onSourceEvent);
      el.addEventListener('loadedmetadata', onSourceEvent);
      onSourceEvent(); // capture whatever is already loaded
      return () => {
        el.removeEventListener('loadstart', onSourceEvent);
        el.removeEventListener('emptied', onSourceEvent);
        el.removeEventListener('loadedmetadata', onSourceEvent);
      };
    }

    function bindVideo(el: HTMLVideoElement): void {
      if (video === el) return; // already bound to this exact element
      // Detach everything tied to the element we're leaving. Skip silence's
      // audio graph is bound to its original element and can't be moved, so we
      // tear it down; the user re-enables it on the new video if they want it.
      detachLoop?.();
      detachSourceWatch?.();
      detachRateGuard?.();
      skipSilence.teardown();
      skipSilenceEnabled = false;

      video = el;
      lastSrc = '';
      resetForNewMedia();

      detachLoop = abLoop.attach(video, () => loop);
      detachSourceWatch = watchSource(video);

      video.addEventListener('ratechange', guardRate);
      detachRateGuard = () => el.removeEventListener('ratechange', guardRate);
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
    // memory; they're customizable via the options page (see utils/shortcuts).
    // Start from the defaults so shortcuts work immediately, then swap in the
    // user's bindings once storage answers.
    let bindings: Bindings = DEFAULT_BINDINGS;

    void getBindings()
      .then((loaded) => {
        bindings = loaded;
      })
      .catch((error) => {
        console.error('[Kinetik] failed to load shortcuts', error);
      });

    // Apply remaps live, so changing a key in the options tab takes effect in
    // already-open video tabs without a reload.
    watchBindings((next) => {
      bindings = next;
    });

    /** What each action does. Keys come from `bindings`, not hardcoded. */
    const actionHandlers: Record<ActionId, () => void> = {
      speedDown: () => setUserSpeed(userSpeed - KEYBOARD_SPEED_STEP),
      speedUp: () => setUserSpeed(userSpeed + KEYBOARD_SPEED_STEP),
      reset: () => setUserSpeed(DEFAULT_SPEED),
      rewind: () => {
        if (video) video.currentTime -= 10;
      },
      advance: () => {
        if (video) video.currentTime += 10;
      },
      toggleOverlay: () => {
        toggleOverlay();
      },
      loop: () => cycleLoop(),
      note: () => void captureNote(),
    };

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
      const action = resolveAction(bindings, e.code);
      // Unbound key: leave it entirely alone so the page can use it. This is
      // what makes remapping a real fix for shortcut conflicts.
      if (!action) return;

      actionHandlers[action]();

      // We acted on the key, so stop the page reacting to it too.
      e.preventDefault();
      e.stopPropagation();
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
          setUserSpeed(message.speed);
          return;
        case 'GET_SPEED':
          return { speed: userSpeed } satisfies GetSpeedResponse;
        case 'TOGGLE_SKIP_SILENCE': {
          if (!video) return;
          if (!message.enabled) {
            skipSilence.stop(skipSilenceHooks);
            skipSilenceEnabled = false;
            return;
          }
          // Cross-origin media would be muted irreversibly, so only proceed
          // when it's safe or the user explicitly forced it.
          const safety = skipSilence.checkSupport(video);
          if (safety === 'cross-origin' && !message.force) return;
          skipSilence.connect(video);
          await skipSilence.resume();
          skipSilence.start(silenceThreshold, skipSilenceHooks);
          skipSilenceEnabled = true;
          return;
        }
        case 'SET_SILENCE_THRESHOLD':
          silenceThreshold = message.threshold;
          skipSilence.setThreshold(message.threshold);
          return;
        case 'GET_SKIP_SILENCE_STATE':
          return {
            enabled: skipSilenceEnabled,
            threshold: silenceThreshold,
            supported: video
              ? skipSilence.checkSupport(video) !== 'cross-origin'
              : false,
            contextSuspended: skipSilence.isSuspended(),
            amplitude: skipSilence.readAmplitude(),
          } satisfies SkipSilenceState;
        case 'GET_LOOP_STATE':
          return {
            pointA: loop.pointA,
            pointB: loop.pointB,
            enabled: loop.enabled,
          } satisfies LoopState;
        case 'CLEAR_LOOP':
          setLoop(EMPTY_LOOP);
          return;
        case 'GET_NOTES': {
          const videoKey = getVideoKey();
          return {
            videoKey,
            notes: await getNotes(videoKey),
          } satisfies NotesState;
        }
        case 'DELETE_NOTE':
          await deleteNote(getVideoKey(), message.id);
          return;
        case 'SEEK_TO':
          if (video) video.currentTime = message.timestamp;
          return;
        case 'GET_SITE_CONTEXT': {
          const hostKey = getHostKey();
          return {
            hostKey,
            profile: await getProfile(hostKey),
          } satisfies SiteContext;
        }
        case 'SAVE_SITE_PROFILE':
          // The content script owns the authoritative current settings, which
          // is why it saves rather than the popup writing storage directly.
          await saveProfile(getHostKey(), {
            speed: userSpeed,
            skipSilence: skipSilenceEnabled,
            silenceThreshold: silenceThreshold,
          });
          return;
        case 'REMOVE_SITE_PROFILE':
          await deleteProfile(getHostKey());
          return;
      }
    });
  },
});
