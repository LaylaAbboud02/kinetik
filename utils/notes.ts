import { storage } from 'wxt/utils/storage';
import type { VideoNote } from './types';

// All notes, keyed by videoKey. Stored in `local` rather than `sync` because
// notes can grow well past sync's per-item quota (CLAUDE.md §3). A single map
// mirrors the site-profiles design and makes "show every note" trivial later.
const videoNotes = storage.defineItem<Record<string, VideoNote[]>>(
  'local:videoNotes',
  { fallback: {}, version: 1 },
);

/** Notes for one video, sorted by timestamp ascending. */
export async function getNotes(videoKey: string): Promise<VideoNote[]> {
  const all = await videoNotes.getValue();
  const notes = all[videoKey] ?? [];
  // Sort a copy so stored order is never mutated in place.
  return [...notes].sort((a, b) => a.timestamp - b.timestamp);
}

/** Create a note. Generates id and createdAt so records can't be malformed. */
export async function addNote(
  videoKey: string,
  timestamp: number,
  text: string,
): Promise<VideoNote> {
  const note: VideoNote = {
    id: crypto.randomUUID(),
    videoKey,
    timestamp,
    text,
    createdAt: Date.now(),
  };
  const all = await videoNotes.getValue();
  const existing = all[videoKey] ?? [];
  await videoNotes.setValue({ ...all, [videoKey]: [...existing, note] });
  return note;
}

/** Remove one note. No-op when the video or the id is unknown. */
export async function deleteNote(videoKey: string, id: string): Promise<void> {
  const all = await videoNotes.getValue();
  const existing = all[videoKey];
  if (!existing) return;
  const remaining = existing.filter((note) => note.id !== id);
  if (remaining.length === existing.length) return; // nothing matched
  await videoNotes.setValue({ ...all, [videoKey]: remaining });
}
