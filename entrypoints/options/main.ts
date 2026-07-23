import { getAllProfiles, saveProfile, deleteProfile } from '@/utils/storage';
import { MAX_SPEED, MIN_SPEED, type SiteProfile } from '@/utils/types';
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
import './style.css';

// The options page is an extension page with no associated tab, so unlike the
// popup there is no content script to message — it reads and writes storage
// directly.

const tbody = document.querySelector<HTMLTableSectionElement>('#profiles-body')!;
const table = document.querySelector<HTMLTableElement>('#profiles-table')!;
const empty = document.querySelector<HTMLParagraphElement>('#profiles-empty')!;
const shortcutsBody =
  document.querySelector<HTMLTableSectionElement>('#shortcuts-body')!;
const shortcutMessage =
  document.querySelector<HTMLParagraphElement>('#shortcut-message')!;
const resetShortcutsBtn =
  document.querySelector<HTMLButtonElement>('#reset-shortcuts')!;

/** Build one table row for a saved profile. */
function renderRow(host: string, profile: SiteProfile): HTMLTableRowElement {
  const row = document.createElement('tr');

  const hostCell = document.createElement('td');
  // textContent, not innerHTML: host strings come from visited pages.
  hostCell.textContent = host;

  const speedCell = document.createElement('td');
  const speedInput = document.createElement('input');
  speedInput.type = 'number';
  speedInput.className = 'speed-input';
  speedInput.min = String(MIN_SPEED);
  speedInput.max = String(MAX_SPEED);
  speedInput.step = '0.05';
  speedInput.value = String(profile.speed);
  speedInput.addEventListener('change', async () => {
    const next = Number(speedInput.value);
    // Ignore nonsense input rather than persisting an unusable speed.
    if (!Number.isFinite(next) || next < MIN_SPEED || next > MAX_SPEED) {
      speedInput.value = String(profile.speed);
      return;
    }
    await saveProfile(host, { ...profile, speed: next });
    await render();
  });
  speedCell.appendChild(speedInput);

  const thresholdCell = document.createElement('td');
  thresholdCell.textContent = profile.silenceThreshold.toFixed(3);

  const actionCell = document.createElement('td');
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'delete-btn';
  del.textContent = 'Delete';
  del.addEventListener('click', async () => {
    await deleteProfile(host);
    await render();
  });
  actionCell.appendChild(del);

  row.append(hostCell, speedCell, thresholdCell, actionCell);
  return row;
}

/** Load every profile and rebuild the table. */
async function render(): Promise<void> {
  const profiles = await getAllProfiles();
  const hosts = Object.keys(profiles).sort();

  tbody.replaceChildren();
  const hasProfiles = hosts.length > 0;
  table.hidden = !hasProfiles;
  empty.hidden = hasProfiles;

  for (const host of hosts) {
    tbody.appendChild(renderRow(host, profiles[host]));
  }
}

void render();

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
