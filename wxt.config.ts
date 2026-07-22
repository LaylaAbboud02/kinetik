import { defineConfig } from 'wxt';

// WXT reads this to generate the Manifest V3 manifest.json and wire up
// entrypoints. Permissions are kept to the minimum the code actually uses —
// host access comes from the content script's `matches`, and we add capability
// permissions only as build steps need them.
export default defineConfig({
  manifest: {
    name: 'Kinetik',
    description:
      'Control video playback speed beyond platform limits on any site.',
    // Required by utils/notes.ts and utils/storage.ts. Without this,
    // chrome.storage is unavailable and every read/write throws.
    permissions: ['storage'],
    // `action` with no popup specified is auto-filled by WXT from the
    // popup/ entrypoint (action.default_popup). Listed here for the icon/title.
    action: {
      default_title: 'Kinetik — video speed control',
    },
  },
});
