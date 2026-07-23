# Keyboard Shortcut Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Project git rule:** This user does ALL commits themselves. "Suggested commit" blocks are message suggestions only — do NOT run `git commit`/`git push`.

**Goal:** Let the user reassign each Kinetik keyboard shortcut from the options page, with press-to-record capture and conflict rejection.

**Architecture:** `utils/shortcuts.ts` owns action definitions, defaults, key validation, conflict detection, and persistence. The content script's hardcoded `switch (e.code)` becomes a bindings lookup, so only bound keys are intercepted and remapping genuinely frees the old key. Bindings are watched so a remap applies live to already-open tabs.

**Tech Stack:** TypeScript, WXT (`storage.defineItem` + `.watch()`), Vitest.

Spec: `docs/superpowers/specs/2026-07-22-shortcuts-design.md`

**File structure:**

| File | Responsibility |
|---|---|
| `utils/shortcuts.ts` (new) | Actions, defaults, validation, conflicts, persistence, watch. |
| `utils/shortcuts.test.ts` (new) | Unit tests for the above. |
| `entrypoints/content/index.ts` (modify) | Bindings lookup replacing the `switch`. |
| `entrypoints/options/index.html` (modify) | Shortcuts table markup. |
| `entrypoints/options/main.ts` (modify) | Shortcuts table rendering + capture mode. |
| `entrypoints/options/style.css` (modify) | Shortcut row styling. |

---

### Task 1: The shortcuts module + tests

**Files:**
- Create: `utils/shortcuts.ts`
- Create: `utils/shortcuts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `utils/shortcuts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  isBindableKey,
  findConflict,
  resolveAction,
  getBindings,
  saveBinding,
  resetBindings,
  formatKeyCode,
} from './shortcuts';

describe('isBindableKey', () => {
  it('accepts letters and digits', () => {
    expect(isBindableKey('KeyA')).toBe(true);
    expect(isBindableKey('KeyZ')).toBe(true);
    expect(isBindableKey('Digit0')).toBe(true);
    expect(isBindableKey('Digit9')).toBe(true);
  });

  it('rejects keys reserved by the page or the browser', () => {
    expect(isBindableKey('Space')).toBe(false);
    expect(isBindableKey('Escape')).toBe(false);
    expect(isBindableKey('Tab')).toBe(false);
    expect(isBindableKey('Enter')).toBe(false);
    expect(isBindableKey('ShiftLeft')).toBe(false);
    expect(isBindableKey('')).toBe(false);
  });
});

describe('formatKeyCode', () => {
  it('renders codes human-readably', () => {
    expect(formatKeyCode('KeyS')).toBe('S');
    expect(formatKeyCode('Digit1')).toBe('1');
  });

  it('falls back to the raw code for anything else', () => {
    expect(formatKeyCode('F1')).toBe('F1');
  });
});

describe('findConflict', () => {
  it('reports the action already using a key', () => {
    expect(findConflict(DEFAULT_BINDINGS, 'KeyD', 'speedDown')).toBe('speedUp');
  });

  it('returns null for a free key', () => {
    expect(findConflict(DEFAULT_BINDINGS, 'KeyQ', 'speedDown')).toBeNull();
  });

  it('does not treat an action keeping its own key as a conflict', () => {
    expect(findConflict(DEFAULT_BINDINGS, 'KeyS', 'speedDown')).toBeNull();
  });
});

describe('resolveAction', () => {
  it('maps a bound key to its action', () => {
    expect(resolveAction(DEFAULT_BINDINGS, 'KeyD')).toBe('speedUp');
    expect(resolveAction(DEFAULT_BINDINGS, 'KeyN')).toBe('note');
  });

  it('returns null for an unbound key', () => {
    expect(resolveAction(DEFAULT_BINDINGS, 'KeyQ')).toBeNull();
  });
});

describe('ACTIONS', () => {
  it('has a default binding for every action', () => {
    for (const action of ACTIONS) {
      expect(DEFAULT_BINDINGS[action.id]).toBeTruthy();
    }
  });
});

describe('bindings storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns the defaults when nothing is stored', async () => {
    expect(await getBindings()).toEqual(DEFAULT_BINDINGS);
  });

  it('merges a saved binding over the defaults', async () => {
    await saveBinding('speedUp', 'KeyE');
    const bindings = await getBindings();
    expect(bindings.speedUp).toBe('KeyE');
    // Everything else is untouched.
    expect(bindings.speedDown).toBe(DEFAULT_BINDINGS.speedDown);
  });

  it('resets back to the defaults', async () => {
    await saveBinding('speedUp', 'KeyE');
    await resetBindings();
    expect(await getBindings()).toEqual(DEFAULT_BINDINGS);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — cannot resolve `./shortcuts`.

- [ ] **Step 3: Write the implementation**

Create `utils/shortcuts.ts`:

```ts
import { storage } from 'wxt/utils/storage';

// Keyboard shortcut configuration: which key triggers which action.
//
// Keys are stored as KeyboardEvent.code values ("KeyS"), not key characters,
// because the content script matches on e.code — that is the physical key,
// independent of shift state and keyboard layout.

export type ActionId =
  | 'speedDown'
  | 'speedUp'
  | 'reset'
  | 'rewind'
  | 'advance'
  | 'toggleOverlay'
  | 'loop'
  | 'note';

export interface ShortcutAction {
  id: ActionId;
  label: string;
}

export type Bindings = Record<ActionId, string>;

/** Every action, in the order the options page lists them. */
export const ACTIONS: ShortcutAction[] = [
  { id: 'speedDown', label: 'Decrease speed' },
  { id: 'speedUp', label: 'Increase speed' },
  { id: 'reset', label: 'Reset to 1×' },
  { id: 'rewind', label: 'Rewind 10 seconds' },
  { id: 'advance', label: 'Advance 10 seconds' },
  { id: 'toggleOverlay', label: 'Show/hide speed badge' },
  { id: 'loop', label: 'A-B loop' },
  { id: 'note', label: 'Add note' },
];

/** Defaults mirror Video Speed Controller, per CLAUDE.md §2. */
export const DEFAULT_BINDINGS: Bindings = {
  speedDown: 'KeyS',
  speedUp: 'KeyD',
  reset: 'KeyR',
  rewind: 'KeyZ',
  advance: 'KeyX',
  toggleOverlay: 'KeyV',
  loop: 'KeyL',
  note: 'KeyN',
};

// Only customised bindings are stored; getBindings merges them over the
// defaults. That way adding a new action in a later version needs no migration.
const storedBindings = storage.defineItem<Partial<Bindings>>(
  'sync:shortcuts',
  { fallback: {}, version: 1 },
);

/**
 * Letters and digits only.
 *
 * Space is play/pause on nearly every player, Escape cancels capture mode, and
 * Tab/Enter are needed for page navigation — binding any of them would break
 * something the user needs more than a shortcut.
 */
export function isBindableKey(code: string): boolean {
  return /^(Key[A-Z]|Digit[0-9])$/.test(code);
}

/** "KeyS" -> "S", "Digit1" -> "1"; anything else is shown as-is. */
export function formatKeyCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

/**
 * Which OTHER action already uses this key, or null if it is free.
 * An action keeping the key it already has is not a conflict.
 */
export function findConflict(
  bindings: Bindings,
  code: string,
  actionId: ActionId,
): ActionId | null {
  for (const action of ACTIONS) {
    if (action.id === actionId) continue;
    if (bindings[action.id] === code) return action.id;
  }
  return null;
}

/** Which action a pressed key triggers, or null when the key is unbound. */
export function resolveAction(
  bindings: Bindings,
  code: string,
): ActionId | null {
  for (const action of ACTIONS) {
    if (bindings[action.id] === code) return action.id;
  }
  return null;
}

/** Stored customisations merged over the defaults. */
export async function getBindings(): Promise<Bindings> {
  const stored = await storedBindings.getValue();
  return { ...DEFAULT_BINDINGS, ...stored };
}

/** Persist one action's key. */
export async function saveBinding(
  actionId: ActionId,
  code: string,
): Promise<void> {
  const stored = await storedBindings.getValue();
  await storedBindings.setValue({ ...stored, [actionId]: code });
}

/** Clear every customisation, returning to defaults. */
export async function resetBindings(): Promise<void> {
  await storedBindings.setValue({});
}

/** Run `cb` whenever the bindings change in storage. Returns an unwatch fn. */
export function watchBindings(cb: (bindings: Bindings) => void): () => void {
  return storedBindings.watch((stored) => {
    cb({ ...DEFAULT_BINDINGS, ...(stored ?? {}) });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS — 50 existing + 15 new = 65 tests.

- [ ] **Step 5: Suggested commit** (user runs this)

```
feat: add keyboard shortcut bindings module
```

---

### Task 2: Replace the content script's hardcoded switch

**Files:**
- Modify: `entrypoints/content/index.ts`

- [ ] **Step 1: Add the imports**

In `entrypoints/content/index.ts`, add below the existing
`import { getProfile, saveProfile, deleteProfile } from '@/utils/storage';`
line:

```ts
import {
  DEFAULT_BINDINGS,
  resolveAction,
  getBindings,
  watchBindings,
  type ActionId,
  type Bindings,
} from '@/utils/shortcuts';
```

- [ ] **Step 2: Add bindings state and the action handler map**

In `entrypoints/content/index.ts`, add immediately before the
`function shouldIgnoreKey(e: KeyboardEvent): boolean {` line:

```ts
    // Start from the defaults so shortcuts work immediately, then swap in the
    // user's bindings once storage answers.
    let bindings: Bindings = DEFAULT_BINDINGS;

    void getBindings()
      .then((loaded) => {
        bindings = loaded;
      })
      .catch((error) => {
        console.error('[Kinetik] failed to load shortcuts', error);
      });

    // Apply remaps live, so changing a key in the options tab takes effect in
    // already-open video tabs without a reload.
    watchBindings((next) => {
      bindings = next;
    });

    /** What each action does. Keys come from `bindings`, not hardcoded. */
    const actionHandlers: Record<ActionId, () => void> = {
      speedDown: () => setUserSpeed(userSpeed - KEYBOARD_SPEED_STEP),
      speedUp: () => setUserSpeed(userSpeed + KEYBOARD_SPEED_STEP),
      reset: () => setUserSpeed(DEFAULT_SPEED),
      rewind: () => {
        if (video) video.currentTime -= 10;
      },
      advance: () => {
        if (video) video.currentTime += 10;
      },
      toggleOverlay: () => {
        toggleOverlay();
      },
      loop: () => cycleLoop(),
      note: () => void captureNote(),
    };
```

- [ ] **Step 3: Replace the switch with a bindings lookup**

In `entrypoints/content/index.ts`, replace the entire body of `onKeyDown`
(the `let handled = true;` line through the closing `}` of the `if (handled)`
block) with:

```ts
      const action = resolveAction(bindings, e.code);
      // Unbound key: leave it entirely alone so the page can use it. This is
      // what makes remapping a real fix for shortcut conflicts.
      if (!action) return;

      actionHandlers[action]();

      // We acted on the key, so stop the page reacting to it too.
      e.preventDefault();
      e.stopPropagation();
```

The resulting function should read:

```ts
    function onKeyDown(e: KeyboardEvent): void {
      if (shouldIgnoreKey(e)) return;

      const action = resolveAction(bindings, e.code);
      // Unbound key: leave it entirely alone so the page can use it. This is
      // what makes remapping a real fix for shortcut conflicts.
      if (!action) return;

      actionHandlers[action]();

      // We acted on the key, so stop the page reacting to it too.
      e.preventDefault();
      e.stopPropagation();
    }
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit; echo "compile: $?"` — expected `compile: 0`.
Run: `npx vitest run` — expected 65 tests passing.
Run: `npx wxt build` — expected success.

- [ ] **Step 5: Suggested commit** (user runs this)

```
refactor: drive keyboard shortcuts from stored bindings
```

---

### Task 3: Options page shortcuts table

**Files:**
- Modify: `entrypoints/options/index.html`
- Modify: `entrypoints/options/style.css`
- Modify: `entrypoints/options/main.ts`

- [ ] **Step 1: Add the markup**

In `entrypoints/options/index.html`, insert immediately before the closing
`</main>` tag:

```html
      <section class="section">
        <div class="section__header">
          <h2 class="section__title">Keyboard shortcuts</h2>
          <button id="reset-shortcuts" class="delete-btn" type="button">
            Reset to defaults
          </button>
        </div>
        <table class="profiles">
          <thead>
            <tr>
              <th>Action</th>
              <th>Key</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="shortcuts-body"></tbody>
        </table>
        <p id="shortcut-message" class="empty"></p>
      </section>
```

- [ ] **Step 2: Add the styles**

Append to `entrypoints/options/style.css`:

```css
.section {
  margin-top: 40px;
}

.section__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section__title {
  margin: 0;
  font-size: 16px;
}

.key-cap {
  display: inline-block;
  min-width: 28px;
  padding: 3px 8px;
  border: 1px solid rgba(127, 127, 127, 0.5);
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  text-align: center;
}

.key-cap--recording {
  border-style: dashed;
  opacity: 0.8;
}
```

- [ ] **Step 3: Add imports and element lookups**

In `entrypoints/options/main.ts`, add these imports below the existing ones:

```ts
import {
  ACTIONS,
  formatKeyCode,
  findConflict,
  isBindableKey,
  getBindings,
  saveBinding,
  resetBindings,
  type ActionId,
  type Bindings,
} from '@/utils/shortcuts';
```

Add these element lookups below the existing ones:

```ts
const shortcutsBody =
  document.querySelector<HTMLTableSectionElement>('#shortcuts-body')!;
const shortcutMessage =
  document.querySelector<HTMLParagraphElement>('#shortcut-message')!;
const resetShortcutsBtn =
  document.querySelector<HTMLButtonElement>('#reset-shortcuts')!;
```

- [ ] **Step 4: Add the shortcuts rendering and capture mode**

Append to `entrypoints/options/main.ts`:

```ts
// --- Keyboard shortcuts ------------------------------------------------

// Which action is currently waiting for a keypress, and how to stop waiting.
let capturingAction: ActionId | null = null;
let cancelCapture: (() => void) | null = null;

function setMessage(text: string): void {
  shortcutMessage.textContent = text;
}

/** Stop waiting for a keypress and restore the table. */
function endCapture(): void {
  cancelCapture?.();
  cancelCapture = null;
  capturingAction = null;
  void renderShortcuts();
}

/**
 * Wait for the next keypress and bind it to `actionId`.
 *
 * The listener is on `document` in the capture phase so it sees the key before
 * anything else on the page, and it swallows the event so a stray keypress
 * cannot also trigger browser find-as-you-type or similar.
 */
function beginCapture(actionId: ActionId, bindings: Bindings): void {
  // Only one row can be recording at a time.
  if (capturingAction) endCapture();
  capturingAction = actionId;
  setMessage('Press a key… (Escape to cancel)');
  void renderShortcuts();

  const onKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.code === 'Escape') {
      setMessage('');
      endCapture();
      return;
    }
    if (!isBindableKey(e.code)) {
      setMessage('Use a letter or a number.');
      return; // stay in capture mode so the user can try again
    }
    const conflict = findConflict(bindings, e.code, actionId);
    if (conflict) {
      const label = ACTIONS.find((a) => a.id === conflict)?.label ?? conflict;
      setMessage(`${formatKeyCode(e.code)} is already used by ${label}.`);
      return;
    }

    void saveBinding(actionId, e.code).then(() => {
      setMessage('');
      endCapture();
    });
  };

  document.addEventListener('keydown', onKeyDown, { capture: true });
  cancelCapture = () =>
    document.removeEventListener('keydown', onKeyDown, { capture: true });
}

/** Build one row: action label, its key, and a Change button. */
function renderShortcutRow(
  action: (typeof ACTIONS)[number],
  bindings: Bindings,
): HTMLTableRowElement {
  const row = document.createElement('tr');

  const labelCell = document.createElement('td');
  labelCell.textContent = action.label;

  const keyCell = document.createElement('td');
  const cap = document.createElement('span');
  const recording = capturingAction === action.id;
  cap.className = recording ? 'key-cap key-cap--recording' : 'key-cap';
  cap.textContent = recording ? '…' : formatKeyCode(bindings[action.id]);
  keyCell.appendChild(cap);

  const actionCell = document.createElement('td');
  const change = document.createElement('button');
  change.type = 'button';
  change.className = 'delete-btn';
  change.textContent = recording ? 'Cancel' : 'Change';
  change.addEventListener('click', () => {
    if (recording) {
      setMessage('');
      endCapture();
    } else {
      beginCapture(action.id, bindings);
    }
  });
  actionCell.appendChild(change);

  row.append(labelCell, keyCell, actionCell);
  return row;
}

/** Load the bindings and rebuild the shortcuts table. */
async function renderShortcuts(): Promise<void> {
  const bindings = await getBindings();
  shortcutsBody.replaceChildren();
  for (const action of ACTIONS) {
    shortcutsBody.appendChild(renderShortcutRow(action, bindings));
  }
}

resetShortcutsBtn.addEventListener('click', async () => {
  await resetBindings();
  setMessage('Shortcuts reset to defaults.');
  await renderShortcuts();
});

void renderShortcuts();
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit; echo "compile: $?"` — expected `compile: 0`.
Run: `npx vitest run` — expected 65 tests passing.
Run: `npx wxt build` — expected success.

- [ ] **Step 6: Suggested commit** (user runs this)

```
feat: add shortcut customization UI to options page
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Automated checks**

Run: `npx tsc --noEmit; echo "compile: $?"` — expected `compile: 0`.
Run: `npx vitest run` — expected 65 tests passing (50 existing + 15 new).
Run: `npx wxt build` — expected success.

- [ ] **Step 2: USER VERIFICATION — real browser**

Ask the user to reload the extension, refresh a video page, and confirm.

**Regression check FIRST — all eight defaults still work:**
1. `S` / `D` change speed, `R` resets.
2. `Z` / `X` seek backward/forward.
3. `V` toggles the badge.
4. `L` cycles the A-B loop.
5. `N` opens the note input.

**Then the new feature:**
6. Options page → Keyboard shortcuts table lists all eight with their keys.
7. Click **Change** on "Increase speed", press `E` → the row shows `E`.
8. On the video tab **without reloading it**, press `E` → speed increases.
9. Press `D` → nothing happens (the key was released back to the page).
10. Click **Change**, press `S` → message: "S is already used by Decrease speed."
11. Click **Change**, press `Space` → message: "Use a letter or a number."
12. Click **Change**, press `Escape` → capture cancels, key unchanged.
13. **Reset to defaults** → the table returns to S/D/R/Z/X/V/L/N and `D` works
    again.
14. Reload the browser entirely → customised bindings persist.
15. Speed control, Skip Silence, A-B Loop, Notes, and site profiles all work.

- [ ] **Step 3: Suggested commit** (user runs this)

```
chore: verify shortcut customization end to end
```

---

## Notes for the implementer

- **Only bound keys are intercepted now.** That is deliberate and is what makes
  remapping fix conflicts — do not add a catch-all that swallows other keys.
- **Bindings start as DEFAULT_BINDINGS** and are replaced when storage resolves,
  so shortcuts work during the brief async gap at page load.
- **`watchBindings` is what makes remaps apply live.** Without it the user must
  reload every open tab after changing a key.
- **Capture mode listens on `document` in the capture phase** and swallows the
  event, so a recorded keypress cannot leak into the page.
- **Don't gate on Pro yet.** `loop` and `note` are Pro actions per CLAUDE.md §2
  but ship ungated until step 7, like every other Pro feature.
