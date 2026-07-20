# Storage Layer & Per-Site Profile Data Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Project git rule:** This user does ALL commits themselves. The "Suggested commit" blocks below are message suggestions only — do NOT run `git commit`/`git push`. Leave staging and committing to the user.

**Goal:** Build the storage foundation for Kinetik — a typed, testable module for saving/loading per-site speed profiles.

**Architecture:** A single `utils/storage.ts` module is the only code that touches `chrome.storage`. It stores all profiles as one synced map (`Record<host, SiteProfile>`) via WXT's `storage.defineItem`, and exposes four domain functions (`getProfile`, `getAllProfiles`, `saveProfile`, `deleteProfile`). No UI, gating, or auto-apply — foundation only. Verified with Vitest using WXT's in-memory fake browser.

**Tech Stack:** TypeScript, WXT (`wxt/utils/storage`), Vitest (`wxt/testing` fake browser).

Spec: `docs/superpowers/specs/2026-06-21-storage-layer-design.md`

---

### Task 1: Add the SiteProfile data model

**Files:**
- Modify: `utils/types.ts` (append)

- [ ] **Step 1: Add the interface and default constant**

Append to `utils/types.ts`:

```ts
// --- Per-site profiles (storage layer, build step 2) --------------------
// A saved set of preferences for one domain. `skipSilence` and
// `silenceThreshold` are used by Skip Silence (step 3); they live in the model
// now so the stored shape doesn't have to change (and migrate) later.
export interface SiteProfile {
  speed: number;
  skipSilence: boolean;
  silenceThreshold: number; // 0.0–1.0
}

/** The values a brand-new profile starts from. */
export const DEFAULT_PROFILE: SiteProfile = {
  speed: 1.0,
  skipSilence: false,
  silenceThreshold: 0.02,
};
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run compile`
Expected: no output, exit code 0 (no type errors).

- [ ] **Step 3: Suggested commit** (user runs this)

```
feat: add SiteProfile data model and DEFAULT_PROFILE
```

---

### Task 2: Set up Vitest with WXT's fake browser

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Install Vitest**

Run: `npm install -D vitest`
Expected: adds `vitest` to `devDependencies`.

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

// WxtVitest wires up WXT's module resolution and swaps in an in-memory
// "fake browser" so extension APIs (chrome.storage, etc.) work in tests.
export default defineConfig({
  plugins: [WxtVitest()],
});
```

- [ ] **Step 3: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

(`vitest run` runs once and exits — good for CI and one-off checks; `vitest`
alone stays in watch mode.)

- [ ] **Step 4: Verify Vitest runs (with no tests yet)**

Run: `npm test`
Expected: Vitest starts and reports "No test files found" (exit code 1 is fine
here — it just means there are no tests yet; the next task adds them). This
confirms the config loads without errors.

- [ ] **Step 5: Suggested commit** (user runs this)

```
chore: set up Vitest with WXT fake-browser testing
```

---

### Task 3: Write the failing storage tests

**Files:**
- Create: `utils/storage.test.ts`

- [ ] **Step 1: Write the test file**

Create `utils/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  getProfile,
  getAllProfiles,
  saveProfile,
  deleteProfile,
} from './storage';
import type { SiteProfile } from './types';

const profileA: SiteProfile = {
  speed: 2.5,
  skipSilence: false,
  silenceThreshold: 0.02,
};
const profileB: SiteProfile = {
  speed: 1.75,
  skipSilence: true,
  silenceThreshold: 0.05,
};

describe('site profile storage', () => {
  beforeEach(() => {
    // Clear the in-memory fake storage so each test starts clean.
    fakeBrowser.reset();
  });

  it('returns null for a host with no saved profile', async () => {
    expect(await getProfile('udemy.com')).toBeNull();
  });

  it('saves and reads back a profile', async () => {
    await saveProfile('udemy.com', profileA);
    expect(await getProfile('udemy.com')).toEqual(profileA);
  });

  it('updates a profile in place on repeated save', async () => {
    await saveProfile('udemy.com', profileA);
    await saveProfile('udemy.com', profileB);
    expect(await getProfile('udemy.com')).toEqual(profileB);
    expect(Object.keys(await getAllProfiles())).toEqual(['udemy.com']);
  });

  it('returns all saved profiles', async () => {
    await saveProfile('udemy.com', profileA);
    await saveProfile('youtube.com', profileB);
    expect(await getAllProfiles()).toEqual({
      'udemy.com': profileA,
      'youtube.com': profileB,
    });
  });

  it('deletes one profile and leaves others intact', async () => {
    await saveProfile('udemy.com', profileA);
    await saveProfile('youtube.com', profileB);
    await deleteProfile('udemy.com');
    expect(await getProfile('udemy.com')).toBeNull();
    expect(await getProfile('youtube.com')).toEqual(profileB);
  });

  it('is a no-op when deleting an unsaved host', async () => {
    await expect(deleteProfile('nope.com')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — Vitest cannot resolve `./storage` (the module doesn't exist
yet), so every test errors. This is the expected "red" state.

- [ ] **Step 3: Suggested commit** (user runs this)

```
test: add failing round-trip tests for site profile storage
```

---

### Task 4: Implement the storage module

**Files:**
- Create: `utils/storage.ts`

- [ ] **Step 1: Write the implementation**

Create `utils/storage.ts`:

```ts
import { storage } from 'wxt/utils/storage';
import type { SiteProfile } from './types';

// The single source of truth for saved profiles: one synced map of
// hostname -> SiteProfile. `sync:` puts it in chrome.storage.sync (follows the
// user across devices); `fallback: {}` means getValue() returns an empty object
// instead of null when nothing is saved yet; `version: 1` reserves a migration
// path if this shape ever changes.
const siteProfiles = storage.defineItem<Record<string, SiteProfile>>(
  'sync:siteProfiles',
  { fallback: {}, version: 1 },
);

/** One site's profile, or null if none is saved for that host. */
export async function getProfile(host: string): Promise<SiteProfile | null> {
  const all = await siteProfiles.getValue();
  return all[host] ?? null;
}

/** Every saved profile, keyed by host. For the options page (step 6). */
export async function getAllProfiles(): Promise<Record<string, SiteProfile>> {
  return siteProfiles.getValue();
}

/** Create or update the profile for a host (upsert). */
export async function saveProfile(
  host: string,
  profile: SiteProfile,
): Promise<void> {
  const all = await siteProfiles.getValue();
  await siteProfiles.setValue({ ...all, [host]: profile });
}

/** Remove the profile for a host. No-op if the host has none. */
export async function deleteProfile(host: string): Promise<void> {
  const all = await siteProfiles.getValue();
  if (!(host in all)) return;
  const next = { ...all };
  delete next[host];
  await siteProfiles.setValue(next);
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 6 tests green.

- [ ] **Step 3: Suggested commit** (user runs this)

```
feat: implement per-site profile storage module
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run compile`
Expected: exit code 0, no errors.

- [ ] **Step 2: Run the test suite once**

Run: `npm test`
Expected: 6 passed.

- [ ] **Step 3: Production build still works**

Run: `npm run build`
Expected: "✔ Finished" with the extension written to `.output/chrome-mv3/`.
(Storage is foundation-only, so step-1 behavior is unchanged.)

- [ ] **Step 4: Suggested final commit** (user runs this)

```
chore: verify storage layer (typecheck, tests, build)
```
(Or squash Tasks 1–5 into one commit — your call.)

---

## Notes for the implementer

- **No UI / no wiring yet.** Nothing imports `storage.ts` in this step. That's
  correct — the popup/options integration and Pro-gating come in steps 5–6.
- **Host is caller-supplied.** `storage.ts` never touches `window` or the DOM;
  it stores whatever host string it's given. How a URL becomes a host key is
  decided later (step 5/6).
- **If `npm test` in Task 2 Step 4 fails to even start** (not just "no tests"),
  the Vitest/WXT config is wrong — fix that before writing tests. A clean "no
  test files found" is the expected result there.
