# Step 2 — Storage Layer & Per-Site Profile Data Model

**Date:** 2026-06-21
**Build order step:** 2 of 7 (see CLAUDE.md §7)
**Status:** Approved, ready for implementation plan

## Goal

Build the storage foundation for Kinetik and the per-site profile data model.
This is foundation-only: it produces no user-visible behavior yet. Profiles are
a Pro feature whose auto-apply and management UI depend on the license system
(step 5) and options page (step 6). We build storage now so later steps don't
have to retrofit it.

## Scope

**In scope**
- Add the `SiteProfile` interface and `DEFAULT_PROFILE` constant to
  `utils/types.ts`.
- Create `utils/storage.ts`: the single module that reads/writes
  `chrome.storage`, exposing a small domain-specific API for site profiles.
- Set up Vitest (via WXT's testing integration) and write round-trip tests for
  `storage.ts`.
- Add a `test` script to `package.json`.

**Explicitly out of scope (later steps)**
- Any UI (popup quick-switch, options-page management) — step 6.
- Auto-applying a profile on page load — gated on Pro license (step 5).
- Pro-gating logic — step 5.
- Notes and A-B loop storage — step 4 (different data, different store).
- License/subscription caching — step 5 (`chrome.storage.local`).

## Data Model

Added to `utils/types.ts`, per CLAUDE.md §5:

```ts
interface SiteProfile {
  speed: number;
  skipSilence: boolean;
  silenceThreshold: number;   // 0.0–1.0, default 0.02
}

const DEFAULT_PROFILE: SiteProfile = {
  speed: 1.0,
  skipSilence: false,
  silenceThreshold: 0.02,
};
```

`skipSilence` and `silenceThreshold` belong to step 3's Skip Silence feature.
They are included in the model now so the stored shape does not have to change
(and migrate) when step 3 lands.

## Storage Strategy

A single synced storage item holds a map of hostname → profile:

```
key:      sync:siteProfiles
type:     Record<string, SiteProfile>
default:  {}
```

- **Why a single map (not one item per host):** profiles are tiny (two numbers
  and a boolean). A single map is trivial to enumerate whole (options page
  "list all profiles") and to look up by host (popup quick-switch). Even
  hundreds of profiles stay well within `chrome.storage.sync` limits.
- **Why `sync` (not `local`):** per CLAUDE.md §3, profiles are small settings
  that should follow the user across devices.
- **Key format:** the map key is a bare hostname string, e.g. `"udemy.com"`,
  `"www.youtube.com"`. Profiles are per-domain. Deriving the host from a URL is
  the *caller's* responsibility, not the storage module's (keeps storage pure
  and testable — see below).

Defined once with WXT's typed storage helper:

```ts
import { storage } from 'wxt/utils/storage';

const siteProfiles = storage.defineItem<Record<string, SiteProfile>>(
  'sync:siteProfiles',
  { fallback: {}, version: 1 },
);
```

`version: 1` reserves a migration path if the stored shape ever changes.

## Module API — `utils/storage.ts`

`utils/storage.ts` is the **only** file that touches `chrome.storage`. All other
code goes through these functions. Each takes a plain `host` string and has no
DOM dependency, so the module is pure and unit-testable.

```ts
/** One site's profile, or null if none is saved for that host. */
getProfile(host: string): Promise<SiteProfile | null>

/** Every saved profile, keyed by host. For the options page. */
getAllProfiles(): Promise<Record<string, SiteProfile>>

/** Create or update the profile for a host. */
saveProfile(host: string, profile: SiteProfile): Promise<void>

/** Remove the profile for a host (no-op if none exists). */
deleteProfile(host: string): Promise<void>
```

Behavior notes:
- `getProfile` returns `null` (not `DEFAULT_PROFILE`) when a host has no saved
  profile, so callers can distinguish "never configured" from "configured to
  defaults." Applying `DEFAULT_PROFILE` is a caller decision.
- `saveProfile` reads the map, sets the one host's entry, and writes the map
  back (upsert).
- `deleteProfile` reads the map, removes the host key if present, writes back.
  Deleting a non-existent host is a silent no-op.

## Testing

Use WXT's Vitest integration, which substitutes an in-memory fake browser so
`chrome.storage` works in tests and resets between them.

- Add `vitest` as a dev dependency and a `vitest.config.ts` using WXT's
  `WxtVitest` plugin.
- Add `"test": "vitest"` to `package.json` scripts.
- `utils/storage.test.ts` cases:
  1. `getProfile` returns `null` for an unsaved host.
  2. `saveProfile` then `getProfile` returns the saved profile.
  3. `saveProfile` twice on the same host updates in place (map has one entry).
  4. `getAllProfiles` returns all saved profiles.
  5. `deleteProfile` removes the target host and leaves others intact.
  6. `deleteProfile` on an unsaved host is a no-op (no throw).
- Reset `fakeBrowser` storage between tests so cases are independent.

This test setup is reused in later steps (skip-silence math, video-key
derivation, license logic).

## Verification / Definition of Done

- `npm run compile` passes (no type errors).
- `npm run build` succeeds.
- `npm test` passes all storage round-trip tests.
- No change to user-visible behavior (foundation only) — confirmed by the
  extension still building and step-1 behavior being untouched.

## Risks / Notes

- **`sync` size limits:** not a practical concern at the size of this data, but
  the single-map choice is the thing to revisit first if it ever became one.
- **Host derivation is deferred:** the question of exactly how callers turn a
  page URL into a host key (e.g. strip `www.`? subdomains?) is out of scope
  here and decided when profiles are actually applied (step 5/6). Storage is
  intentionally agnostic — it stores whatever host string it's given.
