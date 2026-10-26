import { sendToActiveTab } from '@/utils/messaging';
import {
  DEFAULT_SILENCE_THRESHOLD,
  DEFAULT_SPEED,
  type GetSpeedResponse,
  type LoopState,
  type NotesState,
  type SiteContext,
  type SkipSilenceState,
  type VideoNote,
} from '@/utils/types';
import { browser } from 'wxt/browser';
import { formatTime } from '@/utils/loop';
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  formatKeyCode,
  getBindings,
  type ActionId,
  type Bindings,
} from '@/utils/shortcuts';
import './style.css';

// The popup is a tiny web page that opens when you click the toolbar icon. It
// has its own short-lived DOM and JS context (it's destroyed when closed), so
// it holds no long-lived state — it asks the content script for the current
// speed on open, and sends updates as the user interacts.

const emptyState = document.querySelector<HTMLElement>('#empty-state')!;
const controls = document.querySelector<HTMLDivElement>('#controls')!;
const slider = document.querySelector<HTMLInputElement>('#speed-slider')!;
const readout = document.querySelector<HTMLSpanElement>('#speed-readout')!;
const presetButtons = [
  ...document.querySelectorAll<HTMLButtonElement>('.chip[data-speed]'),
];
const skipToggle =
  document.querySelector<HTMLInputElement>('#skip-silence-toggle')!;
const skipDetails = document.querySelector<HTMLDivElement>('#skip-details')!;
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
const loopReadout = document.querySelector<HTMLSpanElement>('#loop-readout')!;
const clearLoopBtn =
  document.querySelector<HTMLButtonElement>('#clear-loop-btn')!;
const notesList = document.querySelector<HTMLUListElement>('#notes-list')!;
const profileReadout =
  document.querySelector<HTMLSpanElement>('#profile-readout')!;
const saveProfileBtn =
  document.querySelector<HTMLButtonElement>('#save-profile-btn')!;
const removeProfileBtn =
  document.querySelector<HTMLButtonElement>('#remove-profile-btn')!;
const openOptionsBtn =
  document.querySelector<HTMLButtonElement>('#open-options-btn')!;
const shortcutList =
  document.querySelector<HTMLUListElement>('#shortcut-list')!;

// The meter's full width represents this amplitude. It matches the sensitivity
// slider's max so the threshold marker lines up with the slider position.
const METER_MAX = 0.1;

// The user's current key bindings. Hints like "Press L to start" read from
// this, so they stay correct after a shortcut is remapped.
let bindings: Bindings = DEFAULT_BINDINGS;

/** The key currently bound to an action, for use in hint text, e.g. "L". */
function keyFor(action: ActionId): string {
  return formatKeyCode(bindings[action]);
}

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

/**
 * Update the slider, readout, and preset highlight to reflect a speed, without
 * sending a message.
 */
function reflect(speed: number): void {
  slider.value = String(speed);
  readout.textContent = format(speed);
  for (const button of presetButtons) {
    const active = Math.abs(Number(button.dataset.speed) - speed) < 0.001;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

/** Push a new speed to the content script and update the UI. */
async function setSpeed(speed: number): Promise<void> {
  reflect(speed);
  await sendToActiveTab({ type: 'SET_SPEED', speed });
}

/**
 * Coerce a loop reply into a usable shape. Same reasoning as the skip-silence
 * normalizer: an older content script (version skew after an extension update)
 * may not know about these fields, and must not be able to crash the popup.
 */
function normalizeLoopState(
  raw: Partial<LoopState> | undefined,
): LoopState | null {
  if (!raw) return null;
  return {
    pointA: Number.isFinite(raw.pointA) ? (raw.pointA as number) : null,
    pointB: Number.isFinite(raw.pointB) ? (raw.pointB as number) : null,
    enabled: Boolean(raw.enabled),
  };
}

/**
 * Show the loop range, or a hint for what to press next. The Clear button only
 * appears once there is something to clear.
 */
function reflectLoop(state: LoopState): void {
  const active =
    state.enabled && state.pointA !== null && state.pointB !== null;
  if (active) {
    loopReadout.textContent = `${formatTime(state.pointA as number)} – ${formatTime(state.pointB as number)}`;
  } else if (state.pointA !== null) {
    loopReadout.textContent = `From ${formatTime(state.pointA)} · press ${keyFor('loop')}`;
  } else {
    loopReadout.textContent = `Press ${keyFor('loop')} to start`;
  }
  clearLoopBtn.hidden = !active && state.pointA === null;
}

/**
 * Coerce a notes reply into a usable shape. Same reasoning as the other
 * normalizers: an older content script must not be able to crash the popup.
 */
function normalizeNotesState(
  raw: Partial<NotesState> | undefined,
): NotesState | null {
  if (!raw) return null;
  return {
    videoKey: typeof raw.videoKey === 'string' ? raw.videoKey : '',
    notes: Array.isArray(raw.notes) ? (raw.notes as VideoNote[]) : [],
  };
}

/** Show whether this site has a saved profile, and which buttons apply. */
function reflectSiteContext(context: SiteContext | undefined): void {
  const profile = context?.profile ?? null;
  if (profile) {
    profileReadout.textContent = `Saved · ${format(profile.speed)}`;
    saveProfileBtn.textContent = 'Update for this site';
    removeProfileBtn.hidden = false;
  } else {
    profileReadout.textContent = context?.hostKey || 'Not saved';
    saveProfileBtn.textContent = 'Save for this site';
    removeProfileBtn.hidden = true;
  }
}

/** Fetch this site's profile state and render it. */
async function refreshSiteContext(): Promise<void> {
  const context = await sendToActiveTab<SiteContext>({
    type: 'GET_SITE_CONTEXT',
  });
  reflectSiteContext(context);
}

/** Rebuild the notes list. Clicking a note seeks; the × deletes it. */
function reflectNotes(notes: VideoNote[]): void {
  notesList.replaceChildren();

  if (notes.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'notes__empty';
    empty.textContent = `Press ${keyFor('note')} while watching to add a note.`;
    notesList.appendChild(empty);
    return;
  }

  for (const note of notes) {
    const item = document.createElement('li');
    item.className = 'note';

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'note__jump';

    const time = document.createElement('span');
    time.className = 'note__time';
    time.textContent = formatTime(note.timestamp);

    const text = document.createElement('span');
    text.className = 'note__text';
    // textContent, never innerHTML: note text is user input and must not be
    // able to inject markup into the popup.
    text.textContent = note.text;

    jump.append(time, text);
    jump.addEventListener('click', () => {
      void sendToActiveTab({ type: 'SEEK_TO', timestamp: note.timestamp });
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'note__delete';
    del.textContent = '×';
    del.title = 'Delete note';
    del.addEventListener('click', async () => {
      await sendToActiveTab({ type: 'DELETE_NOTE', id: note.id });
      await refreshNotes();
    });

    item.append(jump, del);
    notesList.appendChild(item);
  }
}

/** Fetch the current video's notes and render them. */
async function refreshNotes(): Promise<void> {
  const state = normalizeNotesState(
    await sendToActiveTab<Partial<NotesState>>({ type: 'GET_NOTES' }),
  );
  reflectNotes(state?.notes ?? []);
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

/** Show a skip-silence warning or hint, collapsing the line when there's none. */
function setSkipNote(text: string): void {
  skipNote.textContent = text;
  skipNote.hidden = text === '';
}

/** Render the Skip Silence section from the content script's state. */
function reflectSkipSilence(state: SkipSilenceState): void {
  skipToggle.checked = state.enabled;
  // Tuning controls are noise while the feature is off.
  skipDetails.hidden = !state.enabled;
  thresholdSlider.value = String(state.threshold);
  reflectThreshold(state.threshold);
  reflectLevel(state.amplitude, state.enabled);
  if (!state.supported) {
    setSkipNote(
      'This site streams video from another domain. Enabling may mute audio until you reload.',
    );
  } else if (state.contextSuspended) {
    setSkipNote('Click the video once, then toggle again.');
  } else {
    setSkipNote('');
  }
}

/** Fill the help panel with each action and the key it's currently bound to. */
function reflectShortcuts(): void {
  shortcutList.replaceChildren(
    ...ACTIONS.map((action) => {
      const item = document.createElement('li');
      const key = document.createElement('kbd');
      key.textContent = keyFor(action.id);
      const label = document.createElement('span');
      label.textContent = action.label;
      item.append(key, label);
      return item;
    }),
  );
}

/** Poll the live audio level so the meter animates while the popup is open. */
function startLevelPolling(): void {
  // The popup is destroyed when it closes, which stops this automatically.
  setInterval(async () => {
    const state = normalizeSkipSilenceState(
      await sendToActiveTab<Partial<SkipSilenceState>>({
        type: 'GET_SKIP_SILENCE_STATE',
      }),
    );
    if (state) reflectLevel(state.amplitude, state.enabled);
  }, 150);
}

// On open: ask the content script what speed the video is currently at, so the
// popup opens in sync with reality rather than always showing 1×.
async function init(): Promise<void> {
  // Load the user's key bindings first: the loop and notes hints name keys.
  // If storage can't be read, the defaults stay — still useful.
  try {
    bindings = await getBindings();
  } catch {
    // keep DEFAULT_BINDINGS
  }
  reflectShortcuts();

  const res = await sendToActiveTab<Partial<GetSpeedResponse>>({
    type: 'GET_SPEED',
  });
  if (!res || !Number.isFinite(res.speed)) {
    // No frame in the tab owns a video (or it's a page extensions can't run
    // on). Every control would be inert, so show one clear message instead.
    controls.hidden = true;
    emptyState.hidden = false;
    return;
  }
  reflect(res.speed as number);

  const skipState = normalizeSkipSilenceState(
    await sendToActiveTab<Partial<SkipSilenceState>>({
      type: 'GET_SKIP_SILENCE_STATE',
    }),
  );
  if (skipState) reflectSkipSilence(skipState);

  const loopState = normalizeLoopState(
    await sendToActiveTab<Partial<LoopState>>({ type: 'GET_LOOP_STATE' }),
  );
  reflectLoop(loopState ?? { pointA: null, pointB: null, enabled: false });

  await refreshNotes();
  await refreshSiteContext();
  startLevelPolling();
}

// 'input' fires continuously as the slider is dragged — instant feedback.
slider.addEventListener('input', () => {
  void setSpeed(Number(slider.value));
});

for (const button of presetButtons) {
  button.addEventListener('click', () => {
    void setSpeed(Number(button.dataset.speed));
  });
}

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
  skipDetails.hidden = !skipToggle.checked;
});

saveProfileBtn.addEventListener('click', async () => {
  await sendToActiveTab({ type: 'SAVE_SITE_PROFILE' });
  await refreshSiteContext();
});

removeProfileBtn.addEventListener('click', async () => {
  await sendToActiveTab({ type: 'REMOVE_SITE_PROFILE' });
  await refreshSiteContext();
});

openOptionsBtn.addEventListener('click', () => {
  void browser.runtime.openOptionsPage();
});

clearLoopBtn.addEventListener('click', async () => {
  await sendToActiveTab({ type: 'CLEAR_LOOP' });
  reflectLoop({ pointA: null, pointB: null, enabled: false });
});

thresholdSlider.addEventListener('input', () => {
  const threshold = Number(thresholdSlider.value);
  reflectThreshold(threshold); // instant feedback, no round-trip needed
  void sendToActiveTab({ type: 'SET_SILENCE_THRESHOLD', threshold });
});

// Render the default shortcuts immediately so the help panel is never empty
// while init() waits on storage.
reflectShortcuts();
void init();
