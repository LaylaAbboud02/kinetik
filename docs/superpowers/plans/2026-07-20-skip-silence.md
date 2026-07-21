# Skip Silence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Project git rule:** This user does ALL commits themselves. "Suggested commit" blocks are message suggestions only — do NOT run `git commit`/`git push`.

**Goal:** Detect silence in a playing video and skip it by temporarily raising `playbackRate`, with a sensitivity slider.

**Architecture:** Pure decision logic (RMS, silence gate, CORS classification) lives in `utils/silence.ts` and is unit-tested without a browser. `entrypoints/content/skip-silence.ts` owns the Web Audio graph and detection loop, calling back into the content script to change rate. The content script separates **user speed** (source of truth) from **effective playbackRate** (temporarily boosted).

**Tech Stack:** TypeScript, Web Audio API (`AnalyserNode`), WXT, Vitest.

Spec: `docs/superpowers/specs/2026-07-20-skip-silence-design.md`

**Task order rationale:** Task 1 is pure logic (safe, testable). Task 2 is a **feasibility spike** requiring real-browser verification by the user — if it fails, stop and redesign before building Tasks 3–6 on a broken assumption.

---

### Task 1: Pure silence-detection logic + tests

**Files:**
- Create: `utils/silence.ts`
- Create: `utils/silence.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `utils/silence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeRms, classifyMediaSource, createSilenceGate } from './silence';

describe('computeRms', () => {
  it('returns 0 for an empty buffer', () => {
    expect(computeRms(new Float32Array([]))).toBe(0);
  });

  it('returns 0 for pure digital silence', () => {
    expect(computeRms(new Float32Array([0, 0, 0, 0]))).toBe(0);
  });

  it('returns the magnitude for a constant signal', () => {
    // RMS of [0.5, -0.5, 0.5, -0.5] is 0.5
    expect(computeRms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });
});

describe('classifyMediaSource', () => {
  const origin = 'https://www.udemy.com';

  it('treats blob: URLs as safe (MSE players)', () => {
    expect(classifyMediaSource('blob:https://www.udemy.com/abc', origin)).toBe('safe');
  });

  it('treats same-origin URLs as safe', () => {
    expect(classifyMediaSource('https://www.udemy.com/video.mp4', origin)).toBe('safe');
  });

  it('flags cross-origin URLs', () => {
    expect(classifyMediaSource('https://cdn.other.com/video.mp4', origin)).toBe('cross-origin');
  });

  it('returns unknown for an empty source', () => {
    expect(classifyMediaSource('', origin)).toBe('unknown');
  });
});

describe('createSilenceGate', () => {
  it('does not report silence before the sustain window elapses', () => {
    const gate = createSilenceGate({ threshold: 0.02, sustainMs: 200 });
    expect(gate.update(0.001, 1000)).toBe(false); // silence begins
    expect(gate.update(0.001, 1100)).toBe(false); // only 100ms elapsed
  });

  it('reports silence once sustained past the window', () => {
    const gate = createSilenceGate({ threshold: 0.02, sustainMs: 200 });
    gate.update(0.001, 1000);
    expect(gate.update(0.001, 1200)).toBe(true);
  });

  it('exits silence immediately when audio returns', () => {
    const gate = createSilenceGate({ threshold: 0.02, sustainMs: 200 });
    gate.update(0.001, 1000);
    expect(gate.update(0.001, 1200)).toBe(true);
    expect(gate.update(0.5, 1210)).toBe(false); // loud sample -> instant exit
  });

  it('restarts the sustain window after audio returns', () => {
    const gate = createSilenceGate({ threshold: 0.02, sustainMs: 200 });
    gate.update(0.001, 1000);
    gate.update(0.5, 1100);            // audio returns, resets
    expect(gate.update(0.001, 1150)).toBe(false); // new window starts at 1150
    expect(gate.update(0.001, 1360)).toBe(true);
  });

  it('respects an updated threshold', () => {
    const gate = createSilenceGate({ threshold: 0.02, sustainMs: 0 });
    expect(gate.update(0.05, 0)).toBe(false); // above 0.02 -> not silent
    gate.setThreshold(0.1);
    expect(gate.update(0.05, 10)).toBe(true); // now below 0.1 -> silent
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./silence`.

- [ ] **Step 3: Write the implementation**

Create `utils/silence.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — storage tests (6) plus silence tests (12) all green.

- [ ] **Step 5: Suggested commit** (user runs this)

```
feat: add pure silence-detection logic (RMS, gate, CORS classification)
```

---

### Task 2: Feasibility spike — audio graph reads real amplitude

**Goal:** Prove on a real site that the analyser reads non-zero amplitude and the video is NOT muted. **Stop and report if this fails.**

**Files:**
- Create: `entrypoints/content/skip-silence.ts`
- Modify: `entrypoints/content/index.ts`

- [ ] **Step 1: Create the audio graph module (spike version)**

Create `entrypoints/content/skip-silence.ts`:

```ts
import { computeRms, classifyMediaSource } from '@/utils/silence';

// SPIKE VERSION: connects the audio graph and logs amplitude so we can verify
// Web Audio actually works on real sites before building the rest.

let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let sampleBuffer: Float32Array | null = null;
let spikeTimer: number | undefined;

/** Is it safe to route this video through Web Audio? */
export function checkSupport(video: HTMLVideoElement): ReturnType<
  typeof classifyMediaSource
> {
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

/** [SPIKE ONLY] Log amplitude twice a second so we can eyeball real values. */
export function startSpikeLogging(): void {
  if (spikeTimer !== undefined) return;
  spikeTimer = window.setInterval(() => {
    console.log(
      '[Kinetik spike] amplitude:',
      readAmplitude().toFixed(4),
      '| ctx:',
      audioContext?.state,
    );
  }, 500);
}
```

- [ ] **Step 2: Add a temporary trigger in the content script**

In `entrypoints/content/index.ts`, add the import at the top:

```ts
import * as skipSilence from './skip-silence';
```

Then add this inside `main()`, immediately before the `browser.runtime.onMessage` listener:

```ts
    // [SPIKE] Temporary: press K to connect the audio graph and start logging
    // amplitude. Removed in Task 6 once the real toggle exists.
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'KeyK' || e.ctrlKey || e.metaKey || e.altKey) return;
        if (!video) {
          console.log('[Kinetik spike] no video bound yet');
          return;
        }
        const safety = skipSilence.checkSupport(video);
        console.log('[Kinetik spike] source safety:', safety, video.currentSrc);
        if (safety === 'cross-origin') {
          console.log('[Kinetik spike] SKIPPING connect — would mute audio');
          return;
        }
        skipSilence.connect(video);
        void skipSilence.resume();
        skipSilence.startSpikeLogging();
        console.log('[Kinetik spike] connected; suspended?', skipSilence.isSuspended());
      },
      { capture: true },
    );
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: USER VERIFICATION — hand off and wait**

Ask the user to:
1. Reload the extension at `chrome://extensions`.
2. Open a **Udemy** (and separately a **YouTube**) video and refresh the page.
3. Start playing the video with audio audible.
4. Open DevTools Console, filter for `Kinetik`.
5. Press **K** once.
6. Report: the `source safety` value, whether amplitude numbers are non-zero
   and move with the audio, and **whether the video audio is still audible**.

**Pass criteria:** safety is `safe`, amplitude is non-zero and varies with
sound, audio still plays.
**Fail criteria:** amplitude pinned at `0.0000` while audio plays, or audio goes
silent → **STOP. Do not continue to Task 3.** Report back; the approach needs
rethinking.

- [ ] **Step 5: Suggested commit** (user runs this, only if the spike passes)

```
feat: add Web Audio graph for silence detection (spike)
```

---

### Task 3: Separate user speed from effective playback rate

This is the step-1 integration point. Skip-silence changes rate automatically;
those changes must not overwrite the user's chosen speed or flash the badge.

**Files:**
- Modify: `entrypoints/content/index.ts`

- [ ] **Step 1: Rename state and split the speed functions**

In `entrypoints/content/index.ts`, replace the existing `currentSpeed`
declaration and `applySpeed` function with:

```ts
    // The speed the USER chose (slider/keyboard). Source of truth. Skip-silence
    // temporarily overrides the video's playbackRate without touching this.
    let userSpeed = DEFAULT_SPEED;

    /** User-initiated speed change: stores the speed, applies it, flashes badge. */
    function setUserSpeed(speed: number): void {
      userSpeed = clampSpeed(speed);
      if (video) video.playbackRate = userSpeed;
      flashSpeed(userSpeed);
    }

    /**
     * Automatic rate change (skip-silence). Sets playbackRate ONLY — does not
     * change userSpeed and does not flash the badge, which would strobe.
     */
    function setEffectiveRate(rate: number): void {
      if (video) video.playbackRate = rate;
    }

    /** Return the video to the user's chosen speed. */
    function restoreUserSpeed(): void {
      setEffectiveRate(userSpeed);
    }
```

- [ ] **Step 2: Update every existing reference**

Replace all remaining uses of the old names in the same file:
- In `bindVideo`: `currentSpeed = DEFAULT_SPEED;` → `userSpeed = DEFAULT_SPEED;`
  and `video.playbackRate = currentSpeed;` → `video.playbackRate = userSpeed;`
- In `onKeyDown`: `applySpeed(currentSpeed - KEYBOARD_SPEED_STEP)` →
  `setUserSpeed(userSpeed - KEYBOARD_SPEED_STEP)`;
  `applySpeed(currentSpeed + KEYBOARD_SPEED_STEP)` →
  `setUserSpeed(userSpeed + KEYBOARD_SPEED_STEP)`;
  `applySpeed(DEFAULT_SPEED)` → `setUserSpeed(DEFAULT_SPEED)`
- In the message listener: `applySpeed(message.speed)` →
  `setUserSpeed(message.speed)`; `{ speed: currentSpeed }` →
  `{ speed: userSpeed }`

- [ ] **Step 3: Verify nothing broke**

Run: `npm run compile`
Expected: exit 0, no errors (any missed rename shows up here).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Suggested commit** (user runs this)

```
refactor: separate user speed from effective playback rate
```

---

### Task 4: Wire the detection loop to speed changes

**Files:**
- Modify: `entrypoints/content/skip-silence.ts`
- Modify: `entrypoints/content/index.ts`

- [ ] **Step 1: Replace the spike logging with the real control loop**

In `entrypoints/content/skip-silence.ts`, delete `startSpikeLogging` and add
these imports and members. Change the import line to:

```ts
import {
  computeRms,
  classifyMediaSource,
  createSilenceGate,
  type SilenceGate,
} from '@/utils/silence';
import { SILENCE_SKIP_RATE, SILENCE_SUSTAIN_MS } from '@/utils/types';
```

Then append:

```ts
let gate: SilenceGate | null = null;
let loopTimer: number | undefined;
let skipping = false;

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
    if (shouldSkip === skipping) return; // no state change, do nothing
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
```

- [ ] **Step 2: Add the constants**

Append to `utils/types.ts`:

```ts
// --- Skip Silence (build step 3) ---------------------------------------
/** Amplitude at or below which audio counts as silence (0–1 scale). */
export const DEFAULT_SILENCE_THRESHOLD = 0.02;
/** How long silence must persist before we speed up (ms). */
export const SILENCE_SUSTAIN_MS = 200;
/** playbackRate used while skipping through silence. */
export const SILENCE_SKIP_RATE = 8;
```

- [ ] **Step 3: Remove the spike trigger from the content script**

In `entrypoints/content/index.ts`, delete the entire `// [SPIKE] Temporary:
press K ...` keydown listener block added in Task 2.

- [ ] **Step 4: Verify**

Run: `npm run compile` — expected exit 0.
Run: `npm run build` — expected success.

- [ ] **Step 5: Suggested commit** (user runs this)

```
feat: wire silence detection loop to automatic speed changes
```

---

### Task 5: Messaging + popup UI

**Files:**
- Modify: `utils/types.ts`
- Modify: `entrypoints/content/index.ts`
- Modify: `entrypoints/popup/index.html`
- Modify: `entrypoints/popup/main.ts`
- Modify: `entrypoints/popup/style.css`

- [ ] **Step 1: Extend the message types**

In `utils/types.ts`, replace the `Message` union with:

```ts
export type Message =
  | { type: 'SET_SPEED'; speed: number }
  | { type: 'GET_SPEED' }
  | { type: 'TOGGLE_SKIP_SILENCE'; enabled: boolean; force?: boolean }
  | { type: 'SET_SILENCE_THRESHOLD'; threshold: number }
  | { type: 'GET_SKIP_SILENCE_STATE' };
```

And append the state interface:

```ts
/** What the popup needs to render the Skip Silence controls. */
export interface SkipSilenceState {
  enabled: boolean;
  threshold: number;
  /** false when the media is cross-origin (connecting would mute audio). */
  supported: boolean;
  /** true when the AudioContext could not start without a page interaction. */
  contextSuspended: boolean;
}
```

- [ ] **Step 2: Handle the new messages in the content script**

In `entrypoints/content/index.ts`, add near the other state declarations:

```ts
    let skipSilenceEnabled = false;
    let silenceThreshold = DEFAULT_SILENCE_THRESHOLD;

    const skipSilenceHooks: skipSilence.SkipSilenceHooks = {
      setRate: setEffectiveRate,
      restore: restoreUserSpeed,
    };
```

Then add these cases inside the existing `browser.runtime.onMessage` switch,
before the closing brace:

```ts
        case 'TOGGLE_SKIP_SILENCE': {
          if (!video) return;
          if (!message.enabled) {
            skipSilence.stop(skipSilenceHooks);
            skipSilenceEnabled = false;
            return;
          }
          // Cross-origin media would be muted irreversibly, so only proceed
          // when it's safe or the user explicitly forced it.
          const safety = skipSilence.checkSupport(video);
          if (safety === 'cross-origin' && !message.force) return;
          skipSilence.connect(video);
          await skipSilence.resume();
          skipSilence.start(silenceThreshold, skipSilenceHooks);
          skipSilenceEnabled = true;
          return;
        }
        case 'SET_SILENCE_THRESHOLD':
          silenceThreshold = message.threshold;
          skipSilence.setThreshold(message.threshold);
          return;
        case 'GET_SKIP_SILENCE_STATE':
          return {
            enabled: skipSilenceEnabled,
            threshold: silenceThreshold,
            supported: video
              ? skipSilence.checkSupport(video) !== 'cross-origin'
              : false,
            contextSuspended: skipSilence.isSuspended(),
          } satisfies SkipSilenceState;
```

Add `DEFAULT_SILENCE_THRESHOLD` and `type SkipSilenceState` to the existing
import from `@/utils/types`.

- [ ] **Step 3: Add the popup controls**

In `entrypoints/popup/index.html`, insert after the `popup__row` div containing
the reset button:

```html
      <hr class="popup__divider" />

      <div class="popup__row popup__row--between">
        <label class="popup__label" for="skip-silence-toggle">Skip silence</label>
        <input id="skip-silence-toggle" type="checkbox" />
      </div>

      <label class="popup__label popup__label--small" for="threshold-slider">
        Sensitivity
      </label>
      <input
        id="threshold-slider"
        class="popup__slider"
        type="range"
        min="0.001" max="0.1" step="0.001" value="0.02"
        aria-label="Silence sensitivity"
      />

      <p id="skip-silence-note" class="popup__status"></p>
```

- [ ] **Step 4: Wire the popup logic**

In `entrypoints/popup/main.ts`, add to the element lookups at the top:

```ts
const skipToggle = document.querySelector<HTMLInputElement>('#skip-silence-toggle')!;
const thresholdSlider = document.querySelector<HTMLInputElement>('#threshold-slider')!;
const skipNote = document.querySelector<HTMLParagraphElement>('#skip-silence-note')!;
```

Add the import:

```ts
import type { SkipSilenceState } from '@/utils/types';
```

Then append this logic to the file:

```ts
/** Render the Skip Silence section from the content script's state. */
function reflectSkipSilence(state: SkipSilenceState): void {
  skipToggle.checked = state.enabled;
  thresholdSlider.value = String(state.threshold);
  if (!state.supported) {
    skipNote.textContent =
      'This site streams video from another domain. Enabling may mute audio until you reload.';
  } else if (state.contextSuspended) {
    skipNote.textContent = 'Click the video once, then toggle again.';
  } else {
    skipNote.textContent = '';
  }
}

skipToggle.addEventListener('change', async () => {
  const state = await sendToActiveTab<SkipSilenceState>({
    type: 'GET_SKIP_SILENCE_STATE',
  });
  // On an unsupported site, require an explicit confirmation before connecting
  // (it cannot be undone without a page reload).
  const force =
    skipToggle.checked && state?.supported === false
      ? confirm(
          'This site may mute audio when Skip Silence is enabled, until you reload the page. Enable anyway?',
        )
      : false;
  if (skipToggle.checked && state?.supported === false && !force) {
    skipToggle.checked = false;
    return;
  }
  await sendToActiveTab({
    type: 'TOGGLE_SKIP_SILENCE',
    enabled: skipToggle.checked,
    force,
  });
});

thresholdSlider.addEventListener('input', () => {
  void sendToActiveTab({
    type: 'SET_SILENCE_THRESHOLD',
    threshold: Number(thresholdSlider.value),
  });
});
```

And inside the existing `init()`, after the speed reflection, add:

```ts
  const skipState = await sendToActiveTab<SkipSilenceState>({
    type: 'GET_SKIP_SILENCE_STATE',
  });
  if (skipState) reflectSkipSilence(skipState);
```

- [ ] **Step 5: Add the styles**

Append to `entrypoints/popup/style.css`:

```css
.popup__divider {
  border: none;
  border-top: 1px solid rgba(127, 127, 127, 0.3);
  margin: 2px 0;
}

.popup__row--between {
  justify-content: space-between;
  align-items: center;
}

.popup__label {
  font-size: 13px;
  font-weight: 600;
}

.popup__label--small {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.8;
}
```

- [ ] **Step 6: Verify**

Run: `npm run compile` — expected exit 0.
Run: `npm run build` — expected success.

- [ ] **Step 7: Suggested commit** (user runs this)

```
feat: add Skip Silence toggle and sensitivity slider to popup
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Automated checks**

Run: `npx tsc --noEmit; echo "compile: $?"` — expected `compile: 0`.
Run: `npx vitest run` — expected all tests pass (6 storage + 12 silence).
Run: `npx wxt build` — expected success.

- [ ] **Step 2: Confirm no spike code remains**

Run: `grep -rn "SPIKE\|startSpikeLogging" entrypoints/ utils/`
Expected: no matches.

- [ ] **Step 3: USER VERIFICATION — real browser**

Ask the user to reload the extension, refresh a Udemy/YouTube video, and check:
1. Toggle Skip Silence on → during quiet stretches playback visibly speeds up,
   then returns to their chosen speed when talking resumes.
2. The flash badge does **not** strobe during automatic speed changes.
3. Changing speed manually still works, and skip-silence returns to that new
   speed (not 1×).
4. Sensitivity slider changes how aggressively it skips.
5. Toggling off returns playback to normal permanently.

- [ ] **Step 4: Suggested commit** (user runs this)

```
chore: verify Skip Silence end to end
```

---

## Notes for the implementer

- **Task 2 is a gate.** If the spike fails (amplitude pinned at zero, or audio
  muted), STOP and report. Everything after it assumes Web Audio works on the
  target sites.
- **`connect()` is irreversible.** Never call it without `checkSupport()`
  passing or an explicit user `force`.
- **Don't flash the badge on automatic rate changes** — `setEffectiveRate` must
  stay separate from `setUserSpeed`.
- **Skip Silence state is ephemeral this step.** Do not read or write
  `SiteProfile` — persistence is gated on the license system in step 5.
