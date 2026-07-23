# Per-Site Profiles & Options Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Project git rule:** This user does ALL commits themselves. "Suggested commit" blocks are message suggestions only — do NOT run `git commit`/`git push`.

**Goal:** Save a preferred speed per site from the popup, have it applied automatically on every new video, and manage saved profiles from a new options page.

**Architecture:** A pure `utils/host-key.ts` derives the profile key from a URL. The content script's existing `resetForNewMedia()` becomes profile-aware, applying a saved speed instead of 1× when one exists. The popup saves/removes profiles via the content script (which owns the current speed). The options page is a new WXT entrypoint that reads and writes `utils/storage.ts` directly, since it has no associated tab.

**Tech Stack:** TypeScript, WXT (options entrypoint auto-mapped to `options_page`), `chrome.storage.sync` via WXT storage, Vitest.

Spec: `docs/superpowers/specs/2026-07-22-site-profiles-design.md`

**File structure:**

| File | Responsibility |
|---|---|
| `utils/host-key.ts` (new) | URL → profile hostname key. Pure. |
| `utils/host-key.test.ts` (new) | Unit tests for the above. |
| `utils/types.ts` (modify) | `SiteContext`, 3 new `Message` variants. |
| `entrypoints/content/index.ts` (modify) | Profile-aware auto-apply + message handling. |
| `entrypoints/popup/*` (modify) | Save/Update/Remove + options link. |
| `entrypoints/options/index.html` (new) | Options page markup. |
| `entrypoints/options/main.ts` (new) | Options page logic. |
| `entrypoints/options/style.css` (new) | Options page styling. |

**Existing API this builds on** (from step 2, already tested, currently unused):
`getProfile(host)`, `getAllProfiles()`, `saveProfile(host, profile)`, `deleteProfile(host)` in `utils/storage.ts`.

---

### Task 1: Host key derivation + tests

**Files:**
- Create: `utils/host-key.ts`
- Create: `utils/host-key.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `utils/host-key.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveHostKey } from './host-key';

describe('deriveHostKey', () => {
  it('strips a leading www so both forms share one profile', () => {
    expect(deriveHostKey('https://www.udemy.com/course/x')).toBe('udemy.com');
    expect(deriveHostKey('https://udemy.com/course/x')).toBe('udemy.com');
  });

  it('lowercases the hostname', () => {
    expect(deriveHostKey('https://WWW.YouTube.com/watch?v=abc')).toBe(
      'youtube.com',
    );
  });

  it('drops the port', () => {
    expect(deriveHostKey('http://localhost:3000/video')).toBe('localhost');
  });

  it('keeps subdomains other than www', () => {
    expect(deriveHostKey('https://app.example.com/watch')).toBe(
      'app.example.com',
    );
  });

  it('returns the input unchanged when the URL is malformed', () => {
    expect(deriveHostKey('not a url')).toBe('not a url');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — cannot resolve `./host-key`.

- [ ] **Step 3: Write the implementation**

Create `utils/host-key.ts`:

```ts
// Derives the key a per-site profile is stored under.
//
// Deliberately separate from utils/video-key.ts: that identifies ONE VIDEO
// (for notes, e.g. "youtube:dQw4w9WgXcQ"), this identifies A SITE (for
// profiles, e.g. "youtube.com"). Same input, different granularity.
//
// Takes a URL string rather than reading window.location so it can be tested.
export function deriveHostKey(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Never return an empty key — a profile would be saved against nothing.
    return url;
  }
  // `hostname` (unlike `host`) already excludes the port, which is what we
  // want: a profile should apply regardless of port.
  const host = parsed.hostname.toLowerCase();
  // Strip www. so www.udemy.com and udemy.com are one profile, not two.
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** The profile key for the page this content script is running on. */
export function getHostKey(): string {
  return deriveHostKey(window.location.href);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS — 45 existing + 5 new = 50 tests.

- [ ] **Step 5: Suggested commit** (user runs this)

```
feat: add host key derivation for per-site profiles
```

---

### Task 2: Profile-aware auto-apply in the content script

**Files:**
- Modify: `utils/types.ts`
- Modify: `entrypoints/content/index.ts`

- [ ] **Step 1: Add the message variants and context type**

In `utils/types.ts`, replace the `Message` union with:

```ts
export type Message =
  | { type: 'SET_SPEED'; speed: number }
  | { type: 'GET_SPEED' }
  | { type: 'TOGGLE_SKIP_SILENCE'; enabled: boolean; force?: boolean }
  | { type: 'SET_SILENCE_THRESHOLD'; threshold: number }
  | { type: 'GET_SKIP_SILENCE_STATE' }
  | { type: 'GET_LOOP_STATE' }
  | { type: 'CLEAR_LOOP' }
  | { type: 'GET_NOTES' }
  | { type: 'DELETE_NOTE'; id: string }
  | { type: 'SEEK_TO'; timestamp: number }
  | { type: 'GET_SITE_CONTEXT' }
  | { type: 'SAVE_SITE_PROFILE' }
  | { type: 'REMOVE_SITE_PROFILE' };
```

Then append:

```ts
// --- Per-site profiles (build step 5a) ---------------------------------
/** What the popup needs to render its "this site" section. */
export interface SiteContext {
  hostKey: string;
  profile: SiteProfile | null;
}
```

- [ ] **Step 2: Add imports to the content script**

In `entrypoints/content/index.ts`, add below the existing
`import { getNotes, addNote, deleteNote } from '@/utils/notes';` line:

```ts
import { getHostKey } from '@/utils/host-key';
import { getProfile, saveProfile, deleteProfile } from '@/utils/storage';
```

Add `type SiteContext` to the existing import list from `@/utils/types`.

- [ ] **Step 3: Make new-media reset profile-aware**

In `entrypoints/content/index.ts`, replace the existing `resetForNewMedia`
function (currently around line 163-168) with:

```ts
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
      userSpeed = DEFAULT_SPEED;
      if (video) video.playbackRate = userSpeed;

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
```

- [ ] **Step 4: Handle the three new messages**

In `entrypoints/content/index.ts`, add these cases to the
`browser.runtime.onMessage` switch, just before its closing brace:

```ts
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
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit; echo "compile: $?"` — expected `compile: 0`.
Run: `npx vitest run` — expected 50 tests passing.
Run: `npx wxt build` — expected success.

- [ ] **Step 6: Suggested commit** (user runs this)

```
feat: auto-apply saved site profile speed on new media
```

---

### Task 3: Popup save / update / remove

**Files:**
- Modify: `entrypoints/popup/index.html`
- Modify: `entrypoints/popup/main.ts`

- [ ] **Step 1: Add the markup**

In `entrypoints/popup/index.html`, insert immediately after the
`<div class="popup__row">` block containing `reset-btn`:

```html
      <hr class="popup__divider" />

      <div class="popup__row popup__row--between">
        <span class="popup__label">This site</span>
        <span id="profile-readout" class="popup__mono">Not saved</span>
      </div>
      <div class="popup__row">
        <button id="save-profile-btn" class="popup__btn" type="button">
          Save for this site
        </button>
        <button id="remove-profile-btn" class="popup__btn" type="button" hidden>
          Remove
        </button>
      </div>
```

Then insert immediately before the closing `</main>` tag:

```html
      <button id="open-options-btn" class="popup__link" type="button">
        Manage all profiles
      </button>
```

- [ ] **Step 2: Add the link style**

Append to `entrypoints/popup/style.css`:

```css
.popup__link {
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.popup__link:hover {
  opacity: 1;
}
```

- [ ] **Step 3: Add element lookups and imports**

In `entrypoints/popup/main.ts`, add to the element lookups at the top:

```ts
const profileReadout =
  document.querySelector<HTMLSpanElement>('#profile-readout')!;
const saveProfileBtn =
  document.querySelector<HTMLButtonElement>('#save-profile-btn')!;
const removeProfileBtn =
  document.querySelector<HTMLButtonElement>('#remove-profile-btn')!;
const openOptionsBtn =
  document.querySelector<HTMLButtonElement>('#open-options-btn')!;
```

Add `type SiteContext` to the existing import from `@/utils/types`, and add
this import for opening the options page:

```ts
import { browser } from 'wxt/browser';
```

- [ ] **Step 4: Add rendering and refresh**

In `entrypoints/popup/main.ts`, add after the existing `normalizeNotesState`
function:

```ts
/** Show whether this site has a saved profile, and which buttons apply. */
function reflectSiteContext(context: SiteContext | undefined): void {
  const profile = context?.profile ?? null;
  if (profile) {
    profileReadout.textContent = `Saved: ${Number(profile.speed.toFixed(2))}×`;
    saveProfileBtn.textContent = 'Update for this site';
    removeProfileBtn.hidden = false;
  } else {
    profileReadout.textContent = context?.hostKey
      ? `Not saved (${context.hostKey})`
      : 'Not saved';
    saveProfileBtn.textContent = 'Save for this site';
    removeProfileBtn.hidden = true;
  }
}

/** Fetch this site's profile state and render it. */
async function refreshSiteContext(): Promise<void> {
  const context = await sendToActiveTab<SiteContext>({
    type: 'GET_SITE_CONTEXT',
  });
  reflectSiteContext(context);
}
```

- [ ] **Step 5: Wire the buttons and load on open**

In `entrypoints/popup/main.ts`, add these listeners next to the others:

```ts
saveProfileBtn.addEventListener('click', async () => {
  await sendToActiveTab({ type: 'SAVE_SITE_PROFILE' });
  await refreshSiteContext();
});

removeProfileBtn.addEventListener('click', async () => {
  await sendToActiveTab({ type: 'REMOVE_SITE_PROFILE' });
  await refreshSiteContext();
});

openOptionsBtn.addEventListener('click', () => {
  void browser.runtime.openOptionsPage();
});
```

Then inside `init()`, add after the `await refreshNotes();` line:

```ts
  await refreshSiteContext();
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit; echo "compile: $?"` — expected `compile: 0`.
Run: `npx wxt build` — expected success.

- [ ] **Step 7: Suggested commit** (user runs this)

```
feat: save and remove site profiles from the popup
```

---

### Task 4: The options page

**Files:**
- Create: `entrypoints/options/index.html`
- Create: `entrypoints/options/style.css`
- Create: `entrypoints/options/main.ts`

- [ ] **Step 1: Create the markup**

Create `entrypoints/options/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kinetik Settings</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <main class="page">
      <header class="page__header">
        <h1 class="page__title">Kinetik</h1>
        <p class="page__subtitle">Per-site speed profiles</p>
      </header>

      <section>
        <table class="profiles" id="profiles-table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Speed</th>
              <th>Silence sensitivity</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="profiles-body"></tbody>
        </table>
        <p id="profiles-empty" class="empty" hidden>
          No saved profiles yet. Open the Kinetik popup on a site and choose
          “Save for this site”.
        </p>
      </section>
    </main>

    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the styles**

Create `entrypoints/options/style.css`:

```css
:root {
  color-scheme: light dark;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
}

.page {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
}

.page__header {
  margin-bottom: 24px;
}

.page__title {
  margin: 0;
  font-size: 22px;
}

.page__subtitle {
  margin: 4px 0 0;
  opacity: 0.7;
  font-size: 14px;
}

.profiles {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.profiles th,
.profiles td {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.25);
}

.profiles th {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}

.speed-input {
  width: 84px;
  padding: 4px 6px;
  border: 1px solid rgba(127, 127, 127, 0.4);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.delete-btn {
  border: 1px solid currentColor;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 10px;
}

.delete-btn:hover {
  opacity: 1;
}

.empty {
  opacity: 0.7;
  font-size: 14px;
}
```

- [ ] **Step 3: Create the logic**

Create `entrypoints/options/main.ts`:

```ts
import {
  getAllProfiles,
  saveProfile,
  deleteProfile,
} from '@/utils/storage';
import { MAX_SPEED, MIN_SPEED, type SiteProfile } from '@/utils/types';
import './style.css';

// The options page is an extension page with no associated tab, so unlike the
// popup there is no content script to message — it reads and writes storage
// directly.

const tbody = document.querySelector<HTMLTableSectionElement>('#profiles-body')!;
const table = document.querySelector<HTMLTableElement>('#profiles-table')!;
const empty = document.querySelector<HTMLParagraphElement>('#profiles-empty')!;

/** Build one table row for a saved profile. */
function renderRow(host: string, profile: SiteProfile): HTMLTableRowElement {
  const row = document.createElement('tr');

  const hostCell = document.createElement('td');
  // textContent, not innerHTML: host strings come from visited pages.
  hostCell.textContent = host;

  const speedCell = document.createElement('td');
  const speedInput = document.createElement('input');
  speedInput.type = 'number';
  speedInput.className = 'speed-input';
  speedInput.min = String(MIN_SPEED);
  speedInput.max = String(MAX_SPEED);
  speedInput.step = '0.05';
  speedInput.value = String(profile.speed);
  speedInput.addEventListener('change', async () => {
    const next = Number(speedInput.value);
    // Ignore nonsense input rather than persisting an unusable speed.
    if (!Number.isFinite(next) || next < MIN_SPEED || next > MAX_SPEED) {
      speedInput.value = String(profile.speed);
      return;
    }
    await saveProfile(host, { ...profile, speed: next });
    await render();
  });
  speedCell.appendChild(speedInput);

  const thresholdCell = document.createElement('td');
  thresholdCell.textContent = profile.silenceThreshold.toFixed(3);

  const actionCell = document.createElement('td');
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'delete-btn';
  del.textContent = 'Delete';
  del.addEventListener('click', async () => {
    await deleteProfile(host);
    await render();
  });
  actionCell.appendChild(del);

  row.append(hostCell, speedCell, thresholdCell, actionCell);
  return row;
}

/** Load every profile and rebuild the table. */
async function render(): Promise<void> {
  const profiles = await getAllProfiles();
  const hosts = Object.keys(profiles).sort();

  tbody.replaceChildren();
  const hasProfiles = hosts.length > 0;
  table.hidden = !hasProfiles;
  empty.hidden = hasProfiles;

  for (const host of hosts) {
    tbody.appendChild(renderRow(host, profiles[host]));
  }
}

void render();
```

- [ ] **Step 4: Verify the options page is wired into the manifest**

Run: `npx wxt build`
Expected: build succeeds and the output includes `options.html`.

Run: `python3 -c "import json;print(json.load(open('.output/chrome-mv3/manifest.json')).get('options_ui'))"`
Expected: a dict containing `options.html` (WXT maps the `options/` entrypoint
automatically; no manifest edit needed).

- [ ] **Step 5: Verify types and tests**

Run: `npx tsc --noEmit; echo "compile: $?"` — expected `compile: 0`.
Run: `npx vitest run` — expected 50 tests passing.

- [ ] **Step 6: Suggested commit** (user runs this)

```
feat: add options page for managing site profiles
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Automated checks**

Run: `npx tsc --noEmit; echo "compile: $?"` — expected `compile: 0`.
Run: `npx vitest run` — expected 50 tests passing (45 existing + 5 new).
Run: `npx wxt build` — expected success.

- [ ] **Step 2: USER VERIFICATION — real browser**

Ask the user to reload the extension, refresh a video page, and confirm:
1. Set speed to 2.5× on Udemy, open the popup → click **Save for this site**.
   The readout becomes `Saved: 2.5×` and the button becomes **Update**.
2. Reload the page → the video starts at 2.5× automatically, and the speed
   badge does NOT flash.
3. Navigate to a different lecture on the same site → still 2.5×.
4. Go to a site with no profile → starts at 1× as before (this is the
   regression check for the step-4a reset behavior).
5. Popup → **Manage all profiles** opens the options page listing the profile.
6. Change the speed in the options table → reload the site → new speed applies.
7. Delete in the options page → the site goes back to starting at 1×.
8. Popup **Remove** also clears the profile.
9. Speed control, Skip Silence, A-B Loop, and Notes all still work.

- [ ] **Step 3: Suggested commit** (user runs this)

```
chore: verify per-site profiles end to end
```

---

## Notes for the implementer

- **Auto-apply must not flash the badge.** Use `setEffectiveRate`, not
  `setUserSpeed`. The badge is feedback for user-initiated changes.
- **The token check is load-bearing.** Without it, quickly clicking between
  videos can let an earlier profile lookup resolve after a later one and apply
  the wrong speed.
- **Reset to 1× first, then upgrade.** Applying the profile only after the
  await would leave a brief window at the previous video's speed.
- **The options page talks to storage directly.** It has no associated tab, so
  there is no content script to message — unlike the popup.
- **Don't gate on Pro yet.** Gating is step 7 (CLAUDE.md §7 as resequenced).
- **`skipSilence` is captured but not auto-applied.** Saving records the current
  toggle state for future use; nothing reads it at load time this step.
