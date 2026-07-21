// Pure A-B loop logic. No DOM or video element here, so it can be unit-tested
// without a browser (same pattern as utils/silence.ts).

export interface ABLoop {
  pointA: number | null;
  pointB: number | null;
  enabled: boolean;
}

export const EMPTY_LOOP: ABLoop = {
  pointA: null,
  pointB: null,
  enabled: false,
};

/** Shortest allowed loop, in seconds. Below this the video appears frozen. */
export const MIN_LOOP_SECONDS = 0.5;

export type LoopOutcome = 'set-a' | 'looping' | 'cleared' | 'too-short';

export interface LoopTransition {
  loop: ABLoop;
  outcome: LoopOutcome;
}

/**
 * One press of the L key: idle -> set A -> set B and loop -> clear.
 * Returns the next state plus what happened, so the caller can show feedback.
 */
export function advanceLoop(loop: ABLoop, currentTime: number): LoopTransition {
  // Third press (or any press while looping): clear.
  if (loop.enabled) {
    return { loop: EMPTY_LOOP, outcome: 'cleared' };
  }

  // First press: mark the start.
  if (loop.pointA === null) {
    return {
      loop: { pointA: currentTime, pointB: null, enabled: false },
      outcome: 'set-a',
    };
  }

  // Second press: mark the end. Accept the points in either order.
  const start = Math.min(loop.pointA, currentTime);
  const end = Math.max(loop.pointA, currentTime);

  // A zero-length loop would jump back constantly and look like a freeze.
  if (end - start < MIN_LOOP_SECONDS) {
    return { loop, outcome: 'too-short' };
  }

  return {
    loop: { pointA: start, pointB: end, enabled: true },
    outcome: 'looping',
  };
}

/** Has playback run past the end of an active loop? */
export function shouldJumpBack(loop: ABLoop, currentTime: number): boolean {
  if (!loop.enabled || loop.pointA === null || loop.pointB === null) {
    return false;
  }
  return currentTime >= loop.pointB;
}

/** Seconds -> "1:23", or "1:01:01" for videos over an hour. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const paddedSecs = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${paddedSecs}`;
  }
  return `${mins}:${paddedSecs}`;
}
