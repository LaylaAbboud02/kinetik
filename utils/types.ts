// Shared TypeScript types used across entrypoints (content script, popup,
// background). Defining them in one place keeps the message protocol and data
// model consistent — if the popup and content script disagree on a message
// shape, that's a whole class of bugs we want the compiler to catch for us.

// --- Speed constants (free tier, fully uncapped per spec) ---------------
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 16;
export const DEFAULT_SPEED = 1.0;
/** Step used by the S / D keyboard shortcuts. */
export const KEYBOARD_SPEED_STEP = 0.25;

// --- Message protocol ----------------------------------------------------
// A discriminated union: every message has a literal `type`, so TypeScript can
// narrow to the right payload once you check `msg.type`. This is the central
// definition; later build steps add more variants here (skip silence, loops,
// notes, license checks). For step 1 we only need speed control.
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

/** Reply to GET_SPEED so the popup can show the current speed when it opens. */
export interface GetSpeedResponse {
  speed: number;
}

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

// --- Skip Silence (build step 3) ---------------------------------------
/** Amplitude at or below which audio counts as silence (0–1 scale). */
export const DEFAULT_SILENCE_THRESHOLD = 0.02;
/** How long silence must persist before we speed up (ms). */
export const SILENCE_SUSTAIN_MS = 200;
/** playbackRate used while skipping through silence. */
export const SILENCE_SKIP_RATE = 8;

/** What the popup needs to render the Skip Silence controls. */
export interface SkipSilenceState {
  enabled: boolean;
  threshold: number;
  /** false when the media is cross-origin (connecting would mute audio). */
  supported: boolean;
  /** true when the AudioContext could not start without a page interaction. */
  contextSuspended: boolean;
  /** Live RMS amplitude (0–1), so the popup can show a level meter for tuning. */
  amplitude: number;
}

// --- A-B Loop (build step 4a) ------------------------------------------
/** Loop state as sent to the popup. Mirrors ABLoop in utils/loop.ts. */
export interface LoopState {
  pointA: number | null;
  pointB: number | null;
  enabled: boolean;
}

// --- Timestamped Notes (build step 4b) ---------------------------------
/** A short note attached to a moment in a specific video. */
export interface VideoNote {
  id: string;
  videoKey: string;
  timestamp: number; // seconds into the video
  text: string;
  createdAt: number; // Date.now()
}

/** What the popup needs to render the notes list. */
export interface NotesState {
  videoKey: string;
  notes: VideoNote[];
}

// --- Per-site profiles (build step 5a) ---------------------------------
/** What the popup needs to render its "this site" section. */
export interface SiteContext {
  hostKey: string;
  profile: SiteProfile | null;
}
