import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';

// The background service worker is the extension's always-available (but
// short-lived, in MV3) event handler. It does almost nothing for step 1 —
// later steps use it for license checks and periodic subscription refresh.
// WXT maps this file to the manifest's `background.service_worker`.
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      console.log('[Kinetik] installed');
    }
  });
});
