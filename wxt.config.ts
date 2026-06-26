import { defineConfig } from 'wxt';

// WXT reads this to generate the Manifest V3 manifest.json and wire up
// entrypoints. We deliberately keep permissions minimal for step 1 — we only
// need to run a content script on pages and show a popup. No `storage`,
// `tabs`, or host permissions beyond what the content script's `matches`
// already grant. We'll add permissions as later build steps need them.
export default defineConfig({
  manifest: {
    name: 'Kinetik',
    description:
      'Control video playback speed beyond platform limits on any site.',
    // `action` with no popup specified is auto-filled by WXT from the
    // popup/ entrypoint (action.default_popup). Listed here for the icon/title.
    action: {
      default_title: 'Kinetik — video speed control',
    },
  },
});
