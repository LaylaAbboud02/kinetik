# Step 5a — Per-Site Profiles & Options Page

**Date:** 2026-07-22
**Build order step:** 5a of 7 (see CLAUDE.md §7 — step 5 split into 5a profiles, 5b shortcut customization)
**Status:** Approved, ready for implementation plan

## Goal

Let the user save a preferred playback speed per site and have it applied
automatically. Add the options page as the management surface for saved
profiles.

Per-site profiles are a Pro feature, but license gating is now the LAST build
step (CLAUDE.md §7, resequenced 2026-07-21). This step ships the feature
**ungated**, consistent with Skip Silence, A-B Loop, and Notes.

## Decisions Made During Brainstorming

1. **Step 5 split into 5a (profiles) and 5b (shortcut customization).** The two
   share almost no code. Profiles carry far more value: they make the step-2
   storage layer real and deliver the headline "Udemy always opens at 2.5x".
2. **Profiles are created from the popup**, via a "Save for this site" button
   that captures the current settings. Rejected manual hostname entry as the
   primary path: it requires typing domains from memory and cannot capture the
   setup the user just dialed in. The options page handles list/edit/delete.
3. **Auto-apply speed only.** The stored silence threshold is remembered so the
   popup opens with the user's preferred sensitivity, but skip silence is NOT
   auto-enabled. Rationale below.

### Why skip silence does not auto-apply

Enabling skip silence builds a Web Audio graph via
`createMediaElementSource()`. Established during step 3:

- It **cannot be undone** without a page reload.
- On cross-origin media it **mutes audio permanently** for that page load.
- The `AudioContext` may be `suspended` until the user interacts with the page.

Doing that silently on every matching page load risks muting a user's video
with no obvious cause. Speed has none of these properties — it is a single
reversible property assignment.

## Scope

**In scope**
- `utils/host-key.ts` — pure hostname derivation, unit-tested.
- Auto-applying a saved profile's speed when media loads.
- Popup: save / update / remove a profile for the current site, and a link to
  the options page.
- Options page: list, edit speed, and delete saved profiles.

**Out of scope**
- Keyboard shortcut customization — step 5b.
- License activation UI and Pro-gating — step 7.
- Manual "add a profile by typing a hostname" — rejected above; revisit only if
  the popup flow proves insufficient.
- Editing the silence threshold from the options page. It is displayed for
  reference; the popup slider is where it is tuned, with live audio feedback.

## Host Key Derivation

Profiles are keyed by hostname. A new pure module `utils/host-key.ts`:

```ts
deriveHostKey(url: string): string
```

Rules:
1. Parse the URL; on failure return the raw input (never an empty key).
2. Lowercase the hostname.
3. Strip a leading `www.`.

Stripping `www.` matters: `www.udemy.com` and `udemy.com` must resolve to one
profile, not two. Ports are dropped because `hostname` (unlike `host`) excludes
them, which is correct here — a profile should apply regardless of port.

### Why this is separate from `utils/video-key.ts`

They answer different questions at different granularities:

- `video-key.ts` identifies **one video** (for notes) — `youtube:dQw4w9WgXcQ`.
- `host-key.ts` identifies **a site** (for profiles) — `youtube.com`.

Merging them would produce a module with two different notions of identity.

## Auto-Apply

The content script currently has `resetForNewMedia()`, which sets
`userSpeed = DEFAULT_SPEED` whenever new media loads. This step replaces that
with a profile-aware version:

```
on new media source:
  reset loop state (unchanged)
  look up profile for deriveHostKey(location.href)
  if a profile exists -> apply profile.speed
  else                -> apply DEFAULT_SPEED
```

Three properties this must have:

- **Runs on every new media source, not just page load.** SPA sites reuse the
  `<video>` element (established while debugging step 4a), so binding this to
  page load alone would miss navigation between videos on YouTube.
- **Async-safe.** Storage reads return promises. If the media changes again
  while a lookup is in flight, the stale result must be discarded. Implemented
  with a monotonically increasing token captured before the await and compared
  after.
- **Silent.** Auto-apply does not flash the speed badge. The badge is feedback
  for user-initiated changes; flashing on every page load would be noise.

## Popup Changes

A "This site" section showing:

- **No profile saved:** a `Save for this site` button. Saving captures the
  current `userSpeed` and the current silence threshold into a `SiteProfile`
  for the current host key.
- **Profile saved:** the stored value (`Saved: 2.5x`), an `Update` button, and
  a `Remove` button.
- A link that opens the options page (`browser.runtime.openOptionsPage()`).

The popup asks the content script for the current host key rather than deriving
it itself, because the content script is the context that knows the page URL.
This mirrors how notes and loop state are already mediated.

## Options Page

New entrypoint `entrypoints/options/index.html` + `main.ts` + `style.css`. WXT
maps `options/index.html` to the manifest's `options_page` automatically, the
same convention that wired up the popup.

Contents:
- A table of saved profiles: host, speed, silence threshold.
- Speed is editable inline via a number input (range 0.25–16, step 0.05),
  saved on change.
- A delete button per row.
- Empty state: "No saved profiles yet. Open the Kinetik popup on a site and
  choose 'Save for this site'."

The options page reads and writes `utils/storage.ts` **directly** rather than
messaging a content script. It is an extension page with full storage access
and no associated tab, so there is no content script to ask.

## Messaging

Extend the `Message` union in `utils/types.ts`:

```ts
| { type: 'GET_SITE_CONTEXT' }
| { type: 'SAVE_SITE_PROFILE' }
| { type: 'REMOVE_SITE_PROFILE' }
```

Response type for `GET_SITE_CONTEXT`:

```ts
interface SiteContext {
  hostKey: string;
  profile: SiteProfile | null;
}
```

`SAVE_SITE_PROFILE` is handled by the content script rather than the popup
writing storage directly, because the content script owns the authoritative
current speed and silence threshold.

## Data Model

Unchanged from step 2 — `SiteProfile` already carries everything needed:

```ts
interface SiteProfile {
  speed: number;
  skipSilence: boolean;
  silenceThreshold: number;
}
```

`skipSilence` is stored (captured from the current toggle state) but not acted
on at load time, per the decision above. It is retained so step 7 or a later
change can use it without a storage migration.

## Testing

**Unit (Vitest, `utils/host-key.test.ts`)**
- `https://www.udemy.com/course/x` and `https://udemy.com/course/x` produce the
  same key.
- Uppercase host is lowercased.
- A host with a port drops the port.
- A subdomain that is not `www` is preserved (`app.example.com`).
- Malformed input is returned unchanged.

The profile storage functions themselves are already covered by step 2's tests.

**Manual (real browser)** — behavior that cannot be unit tested: saving from the
popup, auto-apply on load and on SPA navigation, the options page's edit and
delete, and — critically — that a site *without* a profile still resets to 1x.

## Verification / Definition of Done

- `npm run compile`, `npm test`, `npm run build` all pass.
- Saving from the popup creates a profile; reloading the page applies its speed.
- Navigating between videos on the same site re-applies the profile speed.
- A site with no profile still starts at 1x.
- The options page lists profiles, edits speed, and deletes.
- Auto-apply does not flash the speed badge.
- Speed control, Skip Silence, A-B Loop, and Notes all still work.

## Risks

- **This changes a code path that was recently debugged.** The
  `resetForNewMedia()` logic was written and verified during step 4a to fix
  loop and speed state on SPA navigation. Auto-apply modifies it, so the manual
  verification explicitly re-tests the no-profile reset case.
- **Async race on rapid navigation.** Clicking quickly between videos could let
  a stale profile lookup resolve after a newer one. Mitigated by the token
  check described under Auto-Apply.
