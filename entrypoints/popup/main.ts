import { sendToActiveTab } from '@/utils/messaging';
import { DEFAULT_SPEED, type GetSpeedResponse } from '@/utils/types';
import './style.css';

// The popup is a tiny web page that opens when you click the toolbar icon. It
// has its own short-lived DOM and JS context (it's destroyed when closed), so
// it holds no long-lived state — it asks the content script for the current
// speed on open, and sends updates as the user interacts.

const slider = document.querySelector<HTMLInputElement>('#speed-slider')!;
const readout = document.querySelector<HTMLSpanElement>('#speed-readout')!;
const resetBtn = document.querySelector<HTMLButtonElement>('#reset-btn')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;

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

// On open: ask the content script what speed the video is currently at, so the
// popup opens in sync with reality rather than always showing 1×.
async function init(): Promise<void> {
  const res = await sendToActiveTab<GetSpeedResponse>({ type: 'GET_SPEED' });
  if (res) {
    reflect(res.speed);
  } else {
    // No content script answered: not a normal web page, or no tab access.
    reflect(DEFAULT_SPEED);
    status.textContent = 'No controllable video on this page.';
  }
}

// 'input' fires continuously as the slider is dragged — instant feedback.
slider.addEventListener('input', () => {
  void setSpeed(Number(slider.value));
});

resetBtn.addEventListener('click', () => {
  void setSpeed(DEFAULT_SPEED);
});

void init();
