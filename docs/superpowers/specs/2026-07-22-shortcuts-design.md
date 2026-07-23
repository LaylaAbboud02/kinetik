# Step 5b — Keyboard Shortcut Customization

**Date:** 2026-07-22
**Build order step:** 5b of 7 (see CLAUDE.md §7 — step 5 split into 5a profiles, 5b shortcuts)
**Status:** Approved, ready for implementation plan

## Goal

Let the user reassign each Kinetik keyboard shortcut to a different key from the
options page.

## Motivation

Kinetik currently intercepts **S, D, R, Z, X, V, L, N** on every site, in the
capture phase, and calls `stopPropagation()` so the page never sees them. That
is guaranteed to collide with some sites' own shortcuts, and today the user has
no way out. Remapping is the escape hatch.

## Decisions Made During Brainstorming

1. **Remap only.** No "disable a shortcut" and no modifier combos.
   - Remapping alone resolves conflicts: the new handler only intercepts keys
     that have a binding, so moving an action off `N` gives `N` back to the
     site. A separate disable feature is not needed for the stated problem.
   - Modifier combos were rejected because supporting them means reworking the
     guard that currently ignores *all* modifier keypresses to protect browser
     shortcuts like Cmd+R — risk in verified code, for a case remapping already
     covers.
2. **Press-to-record capture.** Click "Change", then press the key. Captures
   `e.code` directly, which is exactly what the handler matches on, so there is
   no translation layer between what is recorded and what is matched.
3. **Conflicts are rejected with a warning**, not resolved by stealing the key.
   Exactly one action per key keeps the lookup well-defined and prevents an
   action silently ending up with no shortcut.

## Scope

**In scope**
- `utils/shortcuts.ts` — action definitions, default bindings, key validation,
  conflict detection, code→action resolution, and persistence.
- Refactor the content script's keydown handler from a hardcoded `switch` to a
  bindings lookup.
- Live-apply binding changes without a page reload.
- Options page: a shortcuts table with press-to-record editing and a reset.

**Out of scope**
- Disabling a shortcut entirely — rejected above.
- Modifier combos — rejected above.
- Per-site shortcut overrides. Bindings are global. No evidence this is needed,
  and it would multiply the storage and UI complexity.
- Pro-gating — step 7. `L` and `N` are Pro actions per CLAUDE.md §2 but ship
  ungated like every other Pro feature until then.

## Data Model

```ts
type ActionId =
  | 'speedDown' | 'speedUp' | 'reset' | 'rewind'
  | 'advance'   | 'toggleOverlay' | 'loop' | 'note';

interface ShortcutAction {
  id: ActionId;
  label: string;      // shown in the options page, e.g. "Increase speed"
}

type Bindings = Record<ActionId, string>;   // ActionId -> KeyboardEvent.code
```

Defaults preserve today's behaviour exactly:

| Action | Label | Default |
|---|---|---|
| `speedDown` | Decrease speed | `KeyS` |
| `speedUp` | Increase speed | `KeyD` |
| `reset` | Reset to 1× | `KeyR` |
| `rewind` | Rewind 10 seconds | `KeyZ` |
| `advance` | Advance 10 seconds | `KeyX` |
| `toggleOverlay` | Show/hide speed badge | `KeyV` |
| `loop` | A-B loop | `KeyL` |
| `note` | Add note | `KeyN` |

## Storage

A single synced item, consistent with site profiles:

```
key:      sync:shortcuts
type:     Partial<Bindings>
default:  {}
```

**Stored bindings are merged over the defaults on read.** Only customised
entries are persisted. This means a future version can add a new action and
existing users pick up its default with no migration.

## Module API — `utils/shortcuts.ts`

```ts
/** Every action, in display order. */
export const ACTIONS: ShortcutAction[]

/** Default key for each action. */
export const DEFAULT_BINDINGS: Bindings

/** Is this a key we allow binding to? Letters and digits only. */
export function isBindableKey(code: string): boolean

/**
 * Which OTHER action already uses this key, if any.
 * Re-assigning an action to the key it already holds is not a conflict.
 */
export function findConflict(
  bindings: Bindings, code: string, actionId: ActionId,
): ActionId | null

/** Which action a pressed key triggers, or null if unbound. */
export function resolveAction(bindings: Bindings, code: string): ActionId | null

/** Stored bindings merged over defaults. */
export function getBindings(): Promise<Bindings>

/** Persist one binding. */
export function saveBinding(actionId: ActionId, code: string): Promise<void>

/** Clear all customisations, returning to defaults. */
export function resetBindings(): Promise<void>

/** Call `onChange` whenever bindings change in storage. */
export function watchBindings(cb: (bindings: Bindings) => void): () => void
```

### Allowed keys

`isBindableKey` accepts only `KeyA`–`KeyZ` and `Digit0`–`Digit9`.

Rejected, deliberately:
- Modifier keys — the handler ignores modified keypresses entirely, so a
  modifier binding could never fire.
- `Space` — play/pause on virtually every video player; hijacking it globally
  would break a core page interaction.
- `Escape` — reserved to cancel capture mode.
- `Tab`, `Enter` — required for page navigation and form submission.

## Content Script Changes

The keydown handler currently switches on `e.code` with hardcoded cases. It
becomes:

```
on keydown:
  if shouldIgnoreKey(e) -> return          (unchanged: modifiers, typing)
  action = resolveAction(bindings, e.code)
  if action is null -> return              (leave the key to the page)
  run handler for action
  preventDefault(); stopPropagation()
```

Two consequences:

- **Only bound keys are intercepted.** Previously the `switch` decided; now the
  bindings do. This is what makes remapping a genuine conflict fix — the old
  key stops being captured.
- **Bindings load asynchronously at startup.** Until they resolve, the module
  holds `DEFAULT_BINDINGS`, so shortcuts work immediately at their defaults and
  are replaced once storage answers.

Binding changes are applied live via `watchBindings`, so a remap takes effect
in already-open tabs without a reload. This matters because the natural flow is
"open options in one tab, change a key, go back to the video tab".

Action handlers live in a `Record<ActionId, () => void>` in the content script,
which already has all the functions they call (`setUserSpeed`, `cycleLoop`,
`captureNote`, etc.).

## Options Page

A "Keyboard shortcuts" section below the profiles table.

- One row per action: label, current key, **Change** button.
- Keys are shown human-readably: `KeyS` renders as `S`, `Digit1` as `1`.
- Clicking **Change** enters capture mode: the button reads "Press a key…" and
  a document-level keydown listener takes the next keypress.
- On capture:
  - `Escape` cancels.
  - A non-bindable key shows "Use a letter or number".
  - A conflict shows "E is already used by Increase speed."
  - Otherwise the binding is saved and the table re-renders.
- Only one row can be in capture mode at a time; entering capture on another
  row cancels the first.
- A **Reset to defaults** button clears all customisations.

## Testing

**Unit (Vitest, `utils/shortcuts.test.ts`)**
- `isBindableKey`: accepts `KeyA`, `KeyZ`, `Digit0`; rejects `Space`, `Escape`,
  `ShiftLeft`, `Tab`, `Enter`, and an empty string.
- `findConflict`: returns the owning action for a taken key; returns null for a
  free key; returns null when the key belongs to the action being edited.
- `resolveAction`: maps a bound code to its action; returns null when unbound.
- `getBindings`: returns defaults when nothing is stored; merges a partial
  stored record over defaults.
- `saveBinding`: persists and is reflected by the next `getBindings`.
- `resetBindings`: returns everything to defaults.

**Manual (real browser)**
- All eight shortcuts still work at their defaults — the regression check for
  the handler refactor, done BEFORE testing any remapping.
- Remapping an action works, and the old key is released back to the page.
- Conflict and invalid-key messages appear.
- A remap applies to an already-open tab without reloading it.
- Reset restores the defaults.

## Verification / Definition of Done

- `npm run compile`, `npm test`, `npm run build` all pass.
- Default shortcuts behave exactly as before the refactor.
- Remapping works, is persisted, and applies live.
- Conflicts and non-bindable keys are rejected with a clear message.
- Reset to defaults works.
- Speed control, Skip Silence, A-B Loop, Notes, and profiles all still work.

## Risks

- **The keydown handler is load-bearing and already verified.** Every feature
  routes through it. The manual verification therefore re-tests all eight
  defaults before touching remapping.
- **Live updates could desync.** If `watchBindings` fires while a key is held,
  the worst case is one keypress resolved against the previous bindings —
  harmless and self-correcting.
