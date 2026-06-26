import { browser } from 'wxt/browser';
import type { Message } from './types';

// Typed wrappers around Chrome's message-passing API.
//
// Background: a popup and a content script run in *different* JavaScript
// contexts (different pages, even different processes). They can't call each
// other's functions directly — they communicate by passing serializable
// messages. `browser.tabs.sendMessage` delivers a message to the content
// script running in a specific tab; the content script receives it via
// `browser.runtime.onMessage`. We use `browser` (from WXT) instead of the
// global `chrome` so the same code works in Firefox too, and because it
// returns promises rather than taking callbacks.

/**
 * Send a message from the popup to the content script in the currently active
 * tab, and await its reply. Returns `undefined` if there's no content script
 * listening (e.g. on a chrome:// page where content scripts can't run).
 */
export async function sendToActiveTab<R = unknown>(
  message: Message,
): Promise<R | undefined> {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) return undefined;
  try {
    return (await browser.tabs.sendMessage(tab.id, message)) as R;
  } catch {
    // sendMessage rejects if no receiver exists in the tab (no video page,
    // restricted URL, etc.). That's an expected condition, not a crash.
    return undefined;
  }
}
