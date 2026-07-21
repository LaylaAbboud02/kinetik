import {
  computeRms,
  classifyMediaSource,
  createSilenceGate,
  type SilenceGate,
} from '@/utils/silence';
import { SILENCE_SKIP_RATE, SILENCE_SUSTAIN_MS } from '@/utils/types';

// Owns the Web Audio graph and the silence-detection loop. It does not know
// about user speed — it calls back into the content script via hooks to change
// the playback rate, so the "what speed did the user pick" logic stays in one
// place.

let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
// Annotated with the explicit ArrayBuffer type param: TypeScript 6 types
// typed arrays by their backing buffer, and getFloatTimeDomainData requires
// Float32Array<ArrayBuffer> (not the wider ArrayBufferLike default).
let sampleBuffer: Float32Array<ArrayBuffer> | null = null;
let gate: SilenceGate | null = null;
let loopTimer: number | undefined;
let skipping = false;

/** Is it safe to route this video through Web Audio? */
export function checkSupport(video: HTMLVideoElement) {
  return classifyMediaSource(video.currentSrc, window.location.origin);
}

/**
 * Build MediaElementSource -> Analyser -> Destination.
 * WARNING: this cannot be undone. Only call after checkSupport passes (or the
 * user explicitly opts in).
 */
export function connect(video: HTMLVideoElement): void {
  if (audioContext) return; // only ever connect once per element
  audioContext = new AudioContext();
  const source = audioContext.createMediaElementSource(video);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  sampleBuffer = new Float32Array(analyser.fftSize);

  // Connecting through to the destination is MANDATORY — without it the
  // video's audio is routed into the graph and never reaches the speakers.
  source.connect(analyser);
  analyser.connect(audioContext.destination);
}

/** Current RMS amplitude (0–1), or 0 if not connected. */
export function readAmplitude(): number {
  if (!analyser || !sampleBuffer) return 0;
  analyser.getFloatTimeDomainData(sampleBuffer);
  return computeRms(sampleBuffer);
}

export function isSuspended(): boolean {
  return audioContext?.state === 'suspended';
}

export async function resume(): Promise<void> {
  await audioContext?.resume();
}

export interface SkipSilenceHooks {
  /** Set playbackRate without touching user speed or flashing the badge. */
  setRate(rate: number): void;
  /** Put the video back to the user's chosen speed. */
  restore(): void;
}

/** Start the detection loop. `connect()` must have been called first. */
export function start(threshold: number, hooks: SkipSilenceHooks): void {
  gate = createSilenceGate({ threshold, sustainMs: SILENCE_SUSTAIN_MS });
  skipping = false;
  if (loopTimer !== undefined) return;
  loopTimer = window.setInterval(() => {
    if (!gate) return;
    const shouldSkip = gate.update(readAmplitude(), performance.now());
    if (shouldSkip === skipping) return; // no state change, nothing to do
    skipping = shouldSkip;
    if (shouldSkip) hooks.setRate(SILENCE_SKIP_RATE);
    else hooks.restore();
  }, 50);
}

/** Stop detecting and return the video to normal speed. */
export function stop(hooks: SkipSilenceHooks): void {
  if (loopTimer !== undefined) {
    clearInterval(loopTimer);
    loopTimer = undefined;
  }
  gate = null;
  if (skipping) {
    skipping = false;
    hooks.restore();
  }
}

export function setThreshold(threshold: number): void {
  gate?.setThreshold(threshold);
}
