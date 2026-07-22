import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { getNotes, addNote, deleteNote } from './notes';

const KEY_A = 'youtube:abc123';
const KEY_B = 'www.udemy.com/course/ml/learn/lecture/15862912';

describe('notes storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns an empty list for a video with no notes', async () => {
    expect(await getNotes(KEY_A)).toEqual([]);
  });

  it('saves a note and reads it back', async () => {
    const saved = await addNote(KEY_A, 83, 'gradient descent explained');
    const notes = await getNotes(KEY_A);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('gradient descent explained');
    expect(notes[0].timestamp).toBe(83);
    expect(notes[0].videoKey).toBe(KEY_A);
    expect(notes[0].id).toBe(saved.id);
  });

  it('generates an id and createdAt for each note', async () => {
    const first = await addNote(KEY_A, 10, 'one');
    const second = await addNote(KEY_A, 20, 'two');
    expect(first.id).not.toBe(second.id);
    expect(first.createdAt).toBeGreaterThan(0);
  });

  it('returns notes sorted by timestamp, not insertion order', async () => {
    await addNote(KEY_A, 300, 'later');
    await addNote(KEY_A, 60, 'earlier');
    await addNote(KEY_A, 120, 'middle');
    expect((await getNotes(KEY_A)).map((n) => n.text)).toEqual([
      'earlier',
      'middle',
      'later',
    ]);
  });

  it('keeps notes for different videos isolated', async () => {
    await addNote(KEY_A, 10, 'youtube note');
    await addNote(KEY_B, 20, 'udemy note');
    expect((await getNotes(KEY_A)).map((n) => n.text)).toEqual(['youtube note']);
    expect((await getNotes(KEY_B)).map((n) => n.text)).toEqual(['udemy note']);
  });

  it('deletes only the targeted note', async () => {
    const keep = await addNote(KEY_A, 10, 'keep me');
    const remove = await addNote(KEY_A, 20, 'delete me');
    await deleteNote(KEY_A, remove.id);
    const notes = await getNotes(KEY_A);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(keep.id);
  });

  it('is a no-op when deleting an unknown id', async () => {
    await addNote(KEY_A, 10, 'note');
    await expect(deleteNote(KEY_A, 'no-such-id')).resolves.toBeUndefined();
    expect(await getNotes(KEY_A)).toHaveLength(1);
  });
});
