import { sendToActiveTab } from '@/utils/messaging';
import {
  DEFAULT_SILENCE_THRESHOLD,
  DEFAULT_SPEED,
  type GetSpeedResponse,
  type SkipSilenceState,
} from '@/utils/types';
import './style.css';

// The popup is a tiny web page that opens when you click the toolbar icon. It
// has its own short-lived DOM and JS context (it's destroyed when closed), so
// it holds no long-lived state — it asks the content script for the current
// speed on open, and sends updates as the user interacts.

const slider = document.querySelector<HTMLInputElement>('#speed-slider')!;
const readout = document.querySelector<HTMLSpanElement>('#speed-readout')!;
const resetBtn = document.querySelector<HTMLButtonElement>('#reset-btn')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const skipToggle =
  document.querySelector<HTMLInputElement>('#skip-silence-toggle')!;
const thresholdSlider =
  document.querySelector<HTMLInputElement>('#threshold-slider')!;
const skipNote =
  document.querySelector<HTMLParagraphElement>('#skip-silence-note')!;
const thresholdReadout =
  document.querySelector<HTMLSpanElement>('#threshold-readout')!;
const levelFill = document.querySelector<HTMLDivElement>('#level-fill')!;
const levelMarker = document.querySelector<HTMLDivElement>('#level-marker')!;
const levelReadout =
  document.querySelector<HTMLSpanElement>('#level-readout')!;

// The meter's full width represents this amplitude. It matches the sensitivity
// slider's max so the threshold marker lines up with the slider position.
const METER_MAX = 0.1;

/** Position on the meter (0–100%) for an amplitude, clamped to the meter range. */
function meterPercent(amplitude: number): number {
  return Math.min(100, (amplitude / METER_MAX) * 100);
}

/**
 * Coerce a reply from the content script into a complete, valid state.
 *
 * We cannot assume the content script is the same version as this popup: after
 * an extension update, already-open tabs keep running the OLD content script,
 * which may omit fields added later (e.g. `amplitude`). Reading `.toFixed()`
 * off a missing field would throw, so every field gets a safe fallback.
 */
function normalizeSkipSilenceState(
  raw: Partial<SkipSilenceState> | undefined,
): SkipSilenceState | null {
  if (!raw) return null;
  return {
    enabled: Boolean(raw.enabled),
    threshold: Number.isFinite(raw.threshold)
      ? (raw.threshold as number)
      : DEFAULT_SILENCE_THRESHOLD,
    supported: raw.supported !== false,
    contextSuspended: Boolean(raw.contextSuspended),
    amplitude: Number.isFinite(raw.amplitude) ? (raw.amplitude as number) : 0,
  };
}

/** "2.5×" style label (drops trailing zeros). */
function format(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}

/** Update the slider + readout to reflect a speed, without sending a message. */
function reflect(speed: number): void {
  slider.value = String(speed);
  readout.textContent = format(speed);
}

/** Push a new speed to the content script and update the UI. */
async function setSpeed(speed: number): Promise<void> {
  reflect(speed);
  await sendToActiveTab({ type: 'SET_SPEED', speed });
}

/** Show the threshold number and move the meter's threshold marker. */
function reflectThreshold(threshold: number): void {
  thresholdReadout.textContent = threshold.toFixed(3);
  levelMarker.style.left = `${meterPercent(threshold)}%`;
}

/** Update the live level meter from the latest amplitude reading. */
function reflectLevel(amplitude: number, connected: boolean): void {
  if (!connected) {
    levelFill.style.width = '0%';
    levelReadout.textContent = '—';
    return;
  }
  levelFill.style.width = `${meterPercent(amplitude)}%`;
  levelReadout.textContent = amplitude.toFixed(3);
}

/** Render the Skip Silence section from the content script's state. */
function reflectSkipSilence(state: SkipSilenceState): void {
  skipToggle.checked = state.enabled;
  thresholdSlider.value = String(state.threshold);
  reflectThreshold(state.threshold);
  reflectLevel(state.amplitude, state.enabled);
  if (!state.supported) {
    skipNote.textContent =
      'This site streams video from another domain. Enabling may mute audio until you reload.';
  } else if (state.contextSuspended) {
    skipNote.textContent = 'Click the video once, then toggle again.';
  } else {
    skipNote.textContent = '';
  }
}

// On open: ask the content script what speed the video is currently at, so the
// popup opens in sync with reality rather than always showing 1×.
async function init(): Promise<void> {
  const res = await sendToActiveTab<Partial<GetSpeedResponse>>({
    type: 'GET_SPEED',
  });
  if (res && Number.isFinite(res.speed)) {
    reflect(res.speed as number);
  } else {
    // No content script answered: not a normal web page, or no tab access.
    reflect(DEFAULT_SPEED);
    status.textContent = 'No controllable video on this page.';
  }

  const skipState = normalizeSkipSilenceState(
    await sendToActiveTab<Partial<SkipSilenceState>>({
      type: 'GET_SKIP_SILENCE_STATE',
    }),
  );
  if (skipState) reflectSkipSilence(skipState);
}

// 'input' fires continuously as the slider is dragged — instant feedback.
slider.addEventListener('input', () => {
  void setSpeed(Number(slider.value));
});

resetBtn.addEventListener('click', () => {
  void setSpeed(DEFAULT_SPEED);
});

skipToggle.addEventListener('change', async () => {
  const state = normalizeSkipSilenceState(
    await sendToActiveTab<Partial<SkipSilenceState>>({
      type: 'GET_SKIP_SILENCE_STATE',
    }),
  );
  // On an unsupported (cross-origin) site, connecting mutes audio and cannot
  // be undone without reloading — so require an explicit confirmation.
  const needsConfirm = skipToggle.checked && state?.supported === false;
  const force = needsConfirm
    ? confirm(
        'This site may mute audio when Skip Silence is enabled, until you reload the page. Enable anyway?',
      )
    : false;
  if (needsConfirm && !force) {
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
  const threshold = Number(thresholdSlider.value);
  reflectThreshold(threshold); // instant feedback, no round-trip needed
  void sendToActiveTab({ type: 'SET_SILENCE_THRESHOLD', threshold });
});

// Poll the live audio level while the popup is open so the meter animates.
// The popup is destroyed when it closes, which stops this automatically.
setInterval(async () => {
  const state = normalizeSkipSilenceState(
    await sendToActiveTab<Partial<SkipSilenceState>>({
      type: 'GET_SKIP_SILENCE_STATE',
    }),
  );
  if (state) reflectLevel(state.amplitude, state.enabled);
}, 150);

void init();
