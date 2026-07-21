# Step 4a — A-B Loop

**Date:** 2026-07-21
**Build order step:** 4a of 7 (see CLAUDE.md §7 — step 4 split into 4a A-B Loop, 4b Notes)
**Status:** Approved, ready for implementation plan

## Goal

Let the user mark two points in a video and loop between them automatically
until cleared, driven by the `L` keyboard shortcut, with on-screen feedback and
a popup status/clear control.

A-B Loop is a Pro feature, but license gating does not exist until step 5. This
step builds it fully working and **ungated**, consistent with the decision made
for Skip Silence in step 3.

## Scope

**In scope**
- `utils/loop.ts` — pure loop state machine and time formatting, unit-tested.
- `entrypoints/content/ab-loop.ts` — `timeupdate` enforcement and the
  persistent looping badge.
- Generalize `entrypoints/content/overlay.ts` to flash arbitrary messages.
- Bind the `L` key in the content script.
- Popup: loop status display and a Clear button.

**Out of scope**
- Timestamped Notes — step 4b, its own spec.
- Pro-gating / upgrade prompt — step 5.
- Persisting loop points across reloads — CLAUDE.md §5 specifies A-B loop state
  is ephemeral and in-memory.

## Decisions Made During Brainstorming

1. **Step 4 split into 4a (A-B Loop) and 4b (Notes).** They share no code; the
   loop is ephemeral and self-contained while notes need key derivation,
   storage, and a list UI. Splitting gives a working feature sooner.
2. **Feedback = flash messages + a persistent badge.** A silently repeating
   loop is confusing if you forget it is on, so an always-visible indicator
   accompanies the transient confirmations.
3. **Popup gets loop status and a Clear button** (not keyboard-only).

## Deviation from CLAUDE.md §4

CLAUDE.md's project structure lists a single `entrypoints/content/ab-loop-notes.ts`.
Because the features are being built separately, this step creates
`entrypoints/content/ab-loop.ts`, and step 4b will create a separate notes
module. Two focused files rather than one file with two unrelated jobs.

## Architecture

Follows the pattern established in step 3: pure decision logic in `utils/`
(unit-testable without a browser), browser/DOM glue in `entrypoints/`.

```
utils/loop.ts                      pure state machine + formatTime
entrypoints/content/ab-loop.ts     timeupdate listener + persistent badge
entrypoints/content/overlay.ts     generalized flashMessage(text)
entrypoints/content/index.ts       binds L, owns loop state, handles messages
entrypoints/popup/                 status text + Clear button
```

## Data Model

Per CLAUDE.md §5, held in memory only:

```ts
interface ABLoop {
  pointA: number | null;
  pointB: number | null;
  enabled: boolean;
}
```

## The L Cycle

| Current state | Press L | Result |
|---|---|---|
| Idle (no A) | set A | `pointA = currentTime` |
| A set (no B) | set B and start | `pointB = currentTime`, `enabled = true` |
| Looping | clear | back to idle, all fields reset |

### Edge cases

- **B before A:** swap the two values automatically rather than rejecting.
  More forgiving, and the user's intent is unambiguous.
- **B within 0.5s of A:** reject. Return a `too-short` result, keep the
  A-set state, and flash "Loop too short". A zero-length loop would jump
  continuously and appear to freeze playback.
- **New video bound (SPA navigation):** clear the loop. The points referred to
  the previous video's timeline.
- **User seeks outside the loop:** allowed. The loop re-engages naturally the
  next time playback passes `pointB`.

## Loop Enforcement

A `timeupdate` listener on the bound video:

```
if (enabled && pointA !== null && pointB !== null && currentTime >= pointB) {
  currentTime = pointA;
}
```

**Known imprecision:** `timeupdate` fires roughly 4 times per second, so
playback can overshoot `pointB` by up to ~250ms before jumping back. This is
the approach CLAUDE.md §2 specifies and is acceptable for study loops. A
higher-frequency timer would tighten it at the cost of constant polling; not
worth it now.

## Feedback

**Flash messages** (transient, reuses the existing overlay):
- Setting A → `Loop start 1:23`
- Setting B → `Looping 1:23 – 2:45`
- Clearing → `Loop cleared`
- Rejected B → `Loop too short`

**Persistent badge** while `enabled` is true: `⟳ 1:23 – 2:45`, in a corner,
re-parented into `document.fullscreenElement` when fullscreen (same technique
the flash overlay already uses). Removed when the loop is cleared.

### Required refactor of `overlay.ts`

`overlay.ts` currently exposes only `flashSpeed(speed: number)`, which formats a
speed and shows it. This step generalizes it:

- Add `flashMessage(text: string)` containing the existing show/fade logic.
- Reduce `flashSpeed(speed)` to a wrapper that formats the speed and calls
  `flashMessage`.
- The `V` toggle (`toggleOverlay`) continues to gate all flashes.

No behavior change to what already exists.

## Messaging

Extend the `Message` union in `utils/types.ts`:

```ts
| { type: 'GET_LOOP_STATE' }
| { type: 'CLEAR_LOOP' }
```

Response type:

```ts
interface LoopState {
  pointA: number | null;
  pointB: number | null;
  enabled: boolean;
}
```

## Popup

- A "Loop" row showing either `1:23 – 2:45` or `No loop set`.
- A **Clear** button, disabled when no loop is set.
- State is fetched when the popup opens and re-fetched after Clear. No polling:
  loop state only changes via the keyboard, which requires the page to have
  focus, which closes the popup.
- Replies pass through a normalizer with safe fallbacks, matching the pattern
  added in step 3 — an older content script (version skew after an extension
  update) must not be able to crash the popup.

## Testing

**Unit (Vitest, `utils/loop.test.ts`)** — the pure logic:
- Idle + press → A set, not enabled.
- A set + press → B set, enabled.
- Looping + press → cleared to idle.
- B earlier than A → values swapped, loop enabled.
- B within 0.5s of A → `too-short` result, state unchanged.
- `shouldJumpBack` true only when enabled and `currentTime >= pointB`.
- `formatTime`: `0 → 0:00`, `83 → 1:23`, `3661 → 1:01:01`.

**Manual (real browser)** — behavior that cannot be unit tested: the loop
actually repeating on a real video, badge visibility including fullscreen, and
popup status/clear.

## Verification / Definition of Done

- `npm run compile`, `npm test`, `npm run build` all pass.
- Pressing L three times cycles set-A → looping → cleared, with correct flashes.
- The video visibly jumps back to A when it reaches B.
- The badge appears while looping and disappears on clear.
- Popup shows the correct points and Clear works.
- Loop clears itself when navigating to a different video.
- Existing speed control, shortcuts, and Skip Silence still work.

## Risks

- **Overshoot at loop end** (~250ms) is inherent to `timeupdate`; accepted.
- **Interaction with Skip Silence:** both features manipulate playback. They are
  independent (one changes `playbackRate`, the other `currentTime`) and should
  not conflict, but the manual verification includes running both at once.
