import { getAllProfiles, saveProfile, deleteProfile } from '@/utils/storage';
import { MAX_SPEED, MIN_SPEED, type SiteProfile } from '@/utils/types';
import './style.css';

// The options page is an extension page with no associated tab, so unlike the
// popup there is no content script to message — it reads and writes storage
// directly.

const tbody = document.querySelector<HTMLTableSectionElement>('#profiles-body')!;
const table = document.querySelector<HTMLTableElement>('#profiles-table')!;
const empty = document.querySelector<HTMLParagraphElement>('#profiles-empty')!;

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
