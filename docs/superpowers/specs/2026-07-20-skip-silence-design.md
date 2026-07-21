# Step 3 — Skip Silence

**Date:** 2026-07-20
**Build order step:** 3 of 7 (see CLAUDE.md §7)
**Status:** Approved, ready for implementation plan

## Goal

Detect dead air in a playing video in real time and skip past it by temporarily
raising `playbackRate`, with a user-adjustable sensitivity slider.

Skip Silence is a Pro feature, but license gating does not exist until step 5.
This step builds it fully working and **ungated**; gating is applied later.

## Decisions Made During Brainstorming

1. **Skip method: speed up through silence** (not seek/jump). Temporarily raise
   `playbackRate` during silence and restore the user's speed when audio
   returns. Chosen because seeking on streamed video causes rebuffering
   stutters and can overshoot into speech.
2. **CORS-unsafe sites: warn, let the user choose.** Show a warning with an
   "enable anyway" option rather than silently blocking or silently breaking.
3. **Sensitivity slider range corrected.** CLAUDE.md §2 specifies a 0.0–1.0
   normalized scale with default 0.02. The stored value keeps that scale, but
   the slider spans 0–0.1; a linear 0–1 slider would compress the entire useful
   range into its first ~5%.

## Critical Technical Constraint (researched, not assumed)

Per the Web Audio spec, if a media element's resource is "CORS-cross-origin,"
`MediaElementAudioSourceNode` outputs **pure silence** — Chrome logs
*"MediaElementAudioSource outputs zeroes due to CORS access restrictions."*
This both blinds our detection and mutes the user's audio.

Two aggravating facts (open spec issue WebAudio/web-audio-api#2453):
- There is **no API to detect** CORS restriction before connecting.
- There is **no way to undo** `createMediaElementSource`. Once connected, muted
  audio persists until page reload.

**Mitigating fact:** YouTube, Udemy, and Mux (Laracasts) all use Media Source
Extensions, feeding video from a `blob:` URL created by the page's own script.
Per the MSE spec such a blob URL carries the page's origin, so it is
same-origin and *not* CORS-cross-origin. The feature should work on the primary
target sites. The failure case is a plain cross-origin file source.

**Therefore:** a pre-flight check on `video.currentSrc` runs *before* any audio
node is created:
- `blob:` or same-origin → safe, connect without prompting.
- cross-origin → surface a warning in the popup with an explicit "enable
  anyway" affordance (per decision 2).

## Correction to CLAUDE.md §5

CLAUDE.md says the `AudioContext` must be created "in response to a user gesture
(e.g. a click in the popup)." This is imprecise: the popup and the page are
separate documents, and a click in the popup does **not** grant the page's
document user activation. In practice the page is usually already activated
(the user clicked play). Design accordingly: attempt `resume()`, and if the
context remains `suspended`, surface an actionable message rather than failing
silently.

## Architecture

New module `entrypoints/content/skip-silence.ts`. The content script owns the
video and the speed; skip-silence owns the audio graph and detection loop and
calls back into the content script to adjust rate.

**Audio graph**
```
MediaElementSource → AnalyserNode → AudioDestination
```
Connecting through to the destination is mandatory; omitting it silences the
video.

**Detection loop**
- A ~50ms timer reads `analyser.getFloatTimeDomainData(buffer)`.
- Compute RMS amplitude over the buffer, normalized to 0–1.
- Compare against the current threshold (default 0.02).

**Hysteresis (fast attack, slow release)**
- Require silence sustained for ~200ms before boosting speed.
- Restore normal speed **immediately** when amplitude rises above threshold.

Without this, natural pauses in speech cause constant speed flip-flopping.

**Two speeds, not one — the key integration point with step 1**

The content script must separate:
- **user speed** — set via slider/keyboard; the source of truth.
- **effective `playbackRate`** — temporarily boosted during silence.

Requirements:
- On audio return, restore the *user's* speed (not 1.0).
- Skip-silence's automatic rate changes must **not** trigger the flash overlay
  (it would strobe constantly).
- Skip-silence's rate changes must **not** overwrite the stored user speed.

This means step 1's `applySpeed()` needs to grow a distinction between a
user-initiated change (updates stored speed, flashes badge) and an automatic
one (sets `playbackRate` only).

## Messaging

Extend the `Message` union in `utils/types.ts`:

```ts
| { type: 'TOGGLE_SKIP_SILENCE'; enabled: boolean; threshold?: number }
| { type: 'GET_SKIP_SILENCE_STATE' }
```

Response type for the popup to render its state:

```ts
interface SkipSilenceState {
  enabled: boolean;
  threshold: number;
  supported: boolean;      // false when pre-flight says cross-origin
  contextSuspended: boolean;
}
```

## Popup UI

- A Skip Silence on/off toggle.
- A sensitivity slider (slider range 0–0.1, stored value on the 0–1 scale,
  default 0.02).
- Warning text + "enable anyway" when `supported === false`.
- Actionable message when `contextSuspended === true`.

## State & Persistence

Skip Silence state is **ephemeral this step** — it resets on reload. Persisting
it per site is a Pro behavior gated in step 5. The `SiteProfile` model built in
step 2 already carries `skipSilence` and `silenceThreshold` for that purpose;
this step does not read or write them.

## Testing

Two categories:

1. **Pure logic — unit tested with Vitest (no browser needed).** Extract the
   decision logic so it is testable in isolation:
   - RMS computation from a sample buffer.
   - The silence state machine: below-threshold for < 200ms → not yet silent;
     sustained ≥ 200ms → silent; any sample above threshold → immediately not
     silent.
   - Cross-origin pre-flight classification of a `currentSrc` string
     (`blob:` / same-origin / cross-origin).
2. **Real-browser feasibility — manual.** Web Audio behavior with real media
   cannot be unit tested. A spike task verifies on an actual Udemy/YouTube
   video that the analyser reads non-zero amplitude and audio is not muted.

## Verification / Definition of Done

- `npm run compile`, `npm test`, `npm run build` all pass.
- Spike confirms non-zero amplitude readings and audible video on a real site.
- Toggling Skip Silence in the popup speeds through silence and restores the
  user's chosen speed on audio return.
- The flash badge does not strobe during automatic speed changes.
- A cross-origin site surfaces the warning instead of silently breaking audio.

## Risks

- **Irreversible connection.** The pre-flight check is the only protection;
  once connected, a bad site's audio is muted until reload. This is why the
  check runs before node creation.
- **Threshold tuning is subjective.** The 0.02 default is a starting point;
  expect to adjust after real listening.
- **Spike may invalidate assumptions.** If the analyser reads zeros on the
  target sites despite the MSE reasoning, the feature's approach must be
  reconsidered before building the rest. That is why the spike is task 1.
