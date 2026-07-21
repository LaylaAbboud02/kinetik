// Pure decision logic for Skip Silence. Deliberately free of any Web Audio or
// DOM dependency so it can be unit-tested without a browser.

/**
 * Root-mean-square amplitude of a sample buffer, normalized 0–1.
 * RMS approximates perceived loudness better than a single peak sample.
 */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumOfSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    sumOfSquares += samples[i] * samples[i];
  }
  return Math.sqrt(sumOfSquares / samples.length);
}

export type MediaSourceSafety = 'safe' | 'cross-origin' | 'unknown';

/**
 * Decide whether routing this media through Web Audio is safe.
 *
 * Cross-origin media makes MediaElementAudioSourceNode emit pure silence AND
 * mutes playback, with no way to detect it up front or undo it. So we classify
 * the source URL before creating any audio node.
 *
 * `blob:` sources come from Media Source Extensions (YouTube, Udemy, Mux) and
 * carry the page's own origin, so they are safe.
 */
export function classifyMediaSource(
  currentSrc: string,
  pageOrigin: string,
): MediaSourceSafety {
  if (!currentSrc) return 'unknown';
  if (currentSrc.startsWith('blob:') || currentSrc.startsWith('data:')) {
    return 'safe';
  }
  try {
    return new URL(currentSrc, pageOrigin).origin === pageOrigin
      ? 'safe'
      : 'cross-origin';
  } catch {
    return 'unknown';
  }
}

export interface SilenceGateOptions {
  /** Amplitude at or below which audio counts as silence (0–1). */
  threshold: number;
  /** How long silence must persist before we act, in milliseconds. */
  sustainMs: number;
}

export interface SilenceGate {
  /** Feed one amplitude sample; returns true while we should be skipping. */
  update(amplitude: number, nowMs: number): boolean;
  setThreshold(threshold: number): void;
  reset(): void;
}

/**
 * Hysteresis state machine: "fast attack, slow release".
 *
 * Silence must be sustained for `sustainMs` before we report it (so natural
 * pauses in speech don't cause constant speed flip-flopping), but any sample
 * above the threshold exits silence immediately.
 */
export function createSilenceGate(options: SilenceGateOptions): SilenceGate {
  let threshold = options.threshold;
  const sustainMs = options.sustainMs;
  let silentSince: number | null = null;

  return {
    update(amplitude, nowMs) {
      if (amplitude > threshold) {
        silentSince = null;
        return false;
      }
      if (silentSince === null) silentSince = nowMs;
      return nowMs - silentSince >= sustainMs;
    },
    setThreshold(next) {
      threshold = next;
    },
    reset() {
      silentSince = null;
    },
  };
}
