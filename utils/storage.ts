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
