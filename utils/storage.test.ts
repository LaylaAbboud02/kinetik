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
