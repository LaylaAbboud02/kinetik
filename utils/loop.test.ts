import { describe, it, expect } from 'vitest';
import { advanceLoop, shouldJumpBack, formatTime, EMPTY_LOOP } from './loop';

describe('formatTime', () => {
  it('formats zero', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('pads seconds under ten', () => {
    expect(formatTime(65)).toBe('1:05');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime(83)).toBe('1:23');
  });

  it('includes hours for long videos', () => {
    expect(formatTime(3661)).toBe('1:01:01');
  });
});

describe('advanceLoop', () => {
  it('sets point A from an empty loop', () => {
    const result = advanceLoop(EMPTY_LOOP, 10);
    expect(result.outcome).toBe('set-a');
    expect(result.loop).toEqual({ pointA: 10, pointB: null, enabled: false });
  });

  it('sets point B and enables looping', () => {
    const afterA = advanceLoop(EMPTY_LOOP, 10).loop;
    const result = advanceLoop(afterA, 25);
    expect(result.outcome).toBe('looping');
    expect(result.loop).toEqual({ pointA: 10, pointB: 25, enabled: true });
  });

  it('clears an active loop', () => {
    const afterA = advanceLoop(EMPTY_LOOP, 10).loop;
    const looping = advanceLoop(afterA, 25).loop;
    const result = advanceLoop(looping, 30);
    expect(result.outcome).toBe('cleared');
    expect(result.loop).toEqual(EMPTY_LOOP);
  });

  it('swaps the points when B is before A', () => {
    const afterA = advanceLoop(EMPTY_LOOP, 30).loop;
    const result = advanceLoop(afterA, 10);
    expect(result.outcome).toBe('looping');
    expect(result.loop).toEqual({ pointA: 10, pointB: 30, enabled: true });
  });

  it('rejects a B that is too close to A', () => {
    const afterA = advanceLoop(EMPTY_LOOP, 10).loop;
    const result = advanceLoop(afterA, 10.2);
    expect(result.outcome).toBe('too-short');
    expect(result.loop).toEqual(afterA); // unchanged
  });
});

describe('shouldJumpBack', () => {
  const active = { pointA: 10, pointB: 25, enabled: true };

  it('is true once playback reaches point B', () => {
    expect(shouldJumpBack(active, 25)).toBe(true);
    expect(shouldJumpBack(active, 26)).toBe(true);
  });

  it('is false before point B', () => {
    expect(shouldJumpBack(active, 24.9)).toBe(false);
  });

  it('is false when the loop is disabled', () => {
    expect(shouldJumpBack({ ...active, enabled: false }, 30)).toBe(false);
  });

  it('is false when points are missing', () => {
    expect(shouldJumpBack(EMPTY_LOOP, 30)).toBe(false);
  });
});
