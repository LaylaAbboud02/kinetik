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
const storedBindings = storage.defineItem<Partial<Bindings>>('sync:shortcuts', {
  fallback: {},
  version: 1,
});

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
