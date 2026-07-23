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
