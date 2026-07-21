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
    expect(classifyMediaSource('https://cdn.other.com/video.mp4', origin)).toBe(
      'cross-origin',
    );
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
    gate.update(0.5, 1100); // audio returns, resets
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
