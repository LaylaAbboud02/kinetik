# Step 4b — Timestamped Notes

**Date:** 2026-07-21
**Build order step:** 4b of 7 (see CLAUDE.md §7 — step 4 split into 4a A-B Loop, 4b Notes)
**Status:** Approved, ready for implementation plan

## Goal

Let the user attach a short text note to the current moment in a video with the
`N` key, and later jump back to that moment by clicking the note. Notes persist
per video.

Notes are a Pro feature, but license gating does not exist until step 5. This
step builds the feature fully working and **ungated**, consistent with the
decisions made for Skip Silence (step 3) and A-B Loop (step 4a).

## Decisions Made During Brainstorming

CLAUDE.md §8 explicitly left the note-input UX open for the build session. It is
now decided:

1. **Inline on-page input.** Pressing `N` opens a small focused text box over
   the video. Rejected `prompt()` (force-exits fullscreen in Chrome, blocks the
   page, looks unpolished for a paid feature) and popup-only input (pulls the
   user out of the video; high friction for a quick action).
2. **Pause while typing, resume after.** At the playback speeds this extension
   encourages, several seconds of typing loses meaningful content. Playback
   resumes only if it was playing when `N` was pressed.
3. **Notes list lives in the popup.** An on-page notes panel was rejected for
   this step as a second full UI surface; the options page (step 6) can add
   cross-video management later.

## Scope

**In scope**
- `utils/video-key.ts` — pure video key derivation.
- `utils/notes.ts` — notes persistence in `chrome.storage.local`.
- `entrypoints/content/note-input.ts` — the inline text box.
- `N` key binding, pause/resume, and message handling in the content script.
- Popup: notes list for the current video with jump-to and delete.

**Out of scope**
- Pro-gating / upgrade prompt — step 5.
- Cross-video note management (list every video's notes) — options page, step 6.
- Editing an existing note's text. Delete and re-add covers it for now (YAGNI).
- An on-page notes panel — rejected above.

## Deviation from CLAUDE.md §4

CLAUDE.md's structure lists `utils/storage.ts` as the storage module and a
combined `entrypoints/content/ab-loop-notes.ts`. This step instead adds
`utils/notes.ts` and `entrypoints/content/note-input.ts`.

Reason: notes use a different storage area (`local`, not `sync`) and a different
data shape than site profiles, so folding them into `storage.ts` would give one
file two unrelated jobs. The `ab-loop-notes.ts` split was already made in 4a.

## Video Key Derivation

Notes must be tied to a specific video, not just a page. Per CLAUDE.md §5,
special-case known sites and fall back to the URL.

The function takes a URL **string** rather than reading `window.location`
directly, so it can be unit-tested:

```ts
deriveVideoKey(url: string): string
```

Rules, in order:
1. `youtube.com` with a `v` query param → `youtube:<id>`
2. `vimeo.com` with a numeric path segment → `vimeo:<id>`
3. Fallback → `<host><pathname>`, **query string and hash dropped**

Dropping the query in the fallback is essential: a Udemy lecture reached as
`.../lecture/15862912?start=360#overview` and as `.../lecture/15862912` must
produce the same key, or notes would appear and disappear depending on how the
user navigated there.

A malformed URL returns the raw input string, so a note is never silently
attached to an empty key.

## Data Model

Per CLAUDE.md §5:

```ts
interface VideoNote {
  id: string;          // crypto.randomUUID()
  videoKey: string;
  timestamp: number;   // seconds into the video
  text: string;
  createdAt: number;   // Date.now()
}
```

Storage: a single item `local:videoNotes` holding
`Record<videoKey, VideoNote[]>`.

- **`local`, not `sync`** — per CLAUDE.md §3. Notes can grow well past
  `sync`'s per-item quota; `local` has room.
- **Single map** — consistent with the site-profiles decision in step 2, and it
  makes the step 6 options page's "show all notes" trivial.

## Module API — `utils/notes.ts`

Takes a plain `videoKey` string; no DOM dependency, so it stays unit-testable.

```ts
getNotes(videoKey: string): Promise<VideoNote[]>          // sorted by timestamp
addNote(videoKey: string, timestamp: number, text: string): Promise<VideoNote>
deleteNote(videoKey: string, id: string): Promise<void>   // no-op if absent
```

`addNote` generates `id` and `createdAt` itself so callers cannot create
inconsistent records. Results from `getNotes` are sorted by `timestamp`
ascending so the popup list reads in video order regardless of creation order.

## The N Flow

1. `N` pressed (and not ignored by the existing modifier/typing guards).
2. If the video is playing, pause it and remember that it was playing.
3. Show the inline input, focused, over the video.
4. **Enter** saves; **Escape** cancels; empty or whitespace-only text cancels.
5. Remove the input; resume playback only if it was playing at step 2.
6. On save, flash `Note saved 1:23`.

### Keystroke isolation (critical)

Every `keydown` inside the note input calls `stopPropagation()`. Without it,
typing "s" would trigger YouTube's own keyboard shortcuts while the user is
writing a note.

Our *own* shortcuts are already safe: `shouldIgnoreKey` in the content script
ignores events whose target is an `INPUT`, and the note box is an `<input>`.

### Fullscreen

The input is re-parented into `document.fullscreenElement` when present, the
same technique already used by the flash overlay and the loop badge. Without
this it would be invisible during fullscreen playback.

## Messaging

Extend the `Message` union in `utils/types.ts`:

```ts
| { type: 'GET_NOTES' }
| { type: 'DELETE_NOTE'; id: string }
| { type: 'SEEK_TO'; timestamp: number }
```

Response type for `GET_NOTES`:

```ts
interface NotesState {
  videoKey: string;
  notes: VideoNote[];
}
```

The content script mediates all three. The popup never touches notes storage
directly, because the content script is the only context that knows the current
video's key and can seek the video. One owner for that logic.

## Popup

- A "Notes" section listing the current video's notes as `1:23 — text`.
- Clicking a note sends `SEEK_TO` with its timestamp.
- A delete control per note sends `DELETE_NOTE`, then re-renders the list.
- Empty state: "No notes for this video."
- Long note text is truncated with CSS ellipsis so one note cannot blow out the
  popup's width.
- Note text is inserted with `textContent`, never `innerHTML`, so text typed by
  the user cannot inject markup into the popup.
- Replies pass through a normalizer with safe fallbacks, matching the pattern
  used for skip-silence and loop state — an older content script (version skew
  after an extension update) must not be able to crash the popup.

## Testing

**Unit (Vitest)** — the pure and storage logic:

`utils/video-key.test.ts`
- YouTube watch URL with `v` → `youtube:<id>`.
- YouTube URL without `v` → falls back to host + path.
- Vimeo numeric path → `vimeo:<id>`.
- Udemy lecture URL with and without query/hash → identical keys.
- Unknown host → host + pathname.
- Malformed input → returns the input unchanged.

`utils/notes.test.ts`
- `getNotes` returns `[]` for a video with no notes.
- `addNote` then `getNotes` returns the note, with generated `id`/`createdAt`.
- Notes come back sorted by `timestamp`, not insertion order.
- Notes for different `videoKey`s stay isolated.
- `deleteNote` removes only the target and leaves the others.
- `deleteNote` with an unknown id is a no-op and does not throw.

**Manual (real browser)** — what cannot be unit tested: the inline input
appearing and focusing, keystrokes not leaking to the host page, pause/resume,
fullscreen visibility, and the popup list's jump and delete.

## Verification / Definition of Done

- `npm run compile`, `npm test`, `npm run build` all pass.
- Pressing `N` pauses, shows a focused input; Enter saves and resumes.
- Escape cancels without saving and still resumes.
- Typing letters that are Kinetik or site shortcuts does not trigger them.
- The input is visible and usable in fullscreen.
- The popup lists notes in timestamp order; clicking jumps the video; delete
  removes the note.
- Notes survive a page reload and are scoped to the correct video.
- Speed control, Skip Silence, and A-B Loop all still work.

## Risks

- **Key derivation on unknown sites** relies on the URL path being stable. Sites
  that encode the video only in a query param (other than the YouTube case) will
  group notes per page rather than per video. Acceptable; revisit if a target
  site behaves this way.
- **This is the largest step since step 1** — four new files plus popup work.
  Task ordering puts the tested, pure pieces first so failures surface early.
