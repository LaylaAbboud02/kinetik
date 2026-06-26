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
  | { type: 'GET_SPEED' };

/** Reply to GET_SPEED so the popup can show the current speed when it opens. */
export interface GetSpeedResponse {
  speed: number;
}
