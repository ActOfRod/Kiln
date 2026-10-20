# Live collaboration

KILN lets several people work on one song at the same time, the way a shared
Google or Microsoft 365 document works: you see who is in the song, where their
cursor is, which region they have selected and where they are playing, and every
edit appears for everyone within a fraction of a second.

## The sharing process

1. **Share.** Press **Share** in the header, enter the name collaborators will
   see, and choose **Start live session**. KILN uploads a snapshot of the open
   song and the audio files it uses, then shows a share link.
2. **Invite.** Copy the link and send it. Anyone with the link can open and edit
   the song — there are no accounts. The secret part of the link sits after `#`,
   so it is never sent to web servers.
3. **Join.** Opening the link shows _Join a live session_. The visitor enters a
   name and joins. Their own browser song is set aside, untouched, while they work
   in the shared song.
4. **Work together.**
   - Header avatars show who is here; **Live** turns red if you go offline.
   - In the arrangement, collaborators' mouse cursors move with name tags, the
     regions they have selected are outlined in their colour, a dot marks the
     track each person is on, and a coloured playhead shows where they are
     listening.
   - The Live session panel describes what each person is doing ("Arrangement ·
     Night bass on Bass · playing at 5.1.1") and lists recent activity ("Sam
     edited Stab on Keys").
   - Edits to tracks, regions, clips, notes, mixer and device settings sync
     instantly. Two people can edit different regions or tracks at once without
     overwriting each other. If both change the _same_ thing, the later change
     wins for everyone.
   - **Undo** only undoes your own edits; collaborators' changes stay.
   - Audio you add is uploaded automatically; others download it before it plays.
   - Playback is personal: everyone listens on their own speakers and can export
     MP3 / WAV independently.
5. **Offline and reconnecting.** If the connection drops, keep working. When it
   returns, KILN merges your edits with everyone else's, entity by entity.
6. **Leave.** In the Live session panel choose:
   - **Leave and keep this version** — the shared song becomes your browser song.
   - **Leave and return to my song** — restores exactly what you had before.
     Reloading the share link rejoins with every saved change.
7. **Stop sharing.** A link cannot be revoked yet; start a new session (new link)
   and stop using the old one. Maintainers can delete rooms (see the runbook).

## How it works

```text
your edit → Zustand store → entity diff → Lamport-stamped ops ──▶ Realtime broadcast ──▶ collaborators
                                                   └─▶ debounced save ─▶ kiln_save_room (optimistic revision)
presence (name, colour, view, track, region, cursor, playhead) ──▶ Realtime presence
audio assets ─▶ 512 KiB chunks ─▶ kiln_put_asset_chunk ─▶ kiln_get_asset_chunk ─▶ IndexedDB
```

- **Document model** (`src/collab/doc.ts`): a song is split into entities —
  song settings, track order, each track and each arrangement region. Every
  change carries a Lamport stamp; the newest stamp wins per entity, and deletions
  keep tombstones. All clients converge regardless of message order
  (`src/collab/doc.test.ts`).
- **Persistence**: the room row stores the latest snapshot and every entity's
  stamp. Saves use an expected revision; on conflict the client merges the
  stored snapshot with its own entity by entity and retries.
- **Transport** (`src/collab/supabase-backend.ts`): Supabase Postgres functions
  and Realtime broadcast / presence, using only the public publishable key. The
  channel name is derived from a hash of the link secret.
- **Security**: tables have row-level security with no policies and no grants;
  browsers can only call `kiln_*` functions, each of which checks the secret's
  SHA-256 hash. Songs are capped at 5 MB, audio at 300 MB per room, 60 MB per file.
- **Undo**: incoming changes are rebased into your undo history, so undo cannot
  revert someone else's work.

## Limits

- No accounts, permissions (view-only links) or link revocation yet.
- Realtime cursors appear in the Arrangement; other views show presence in the
  header and panel.
- Concurrent edits to one MIDI region's notes resolve at region level (the later
  edit wins), not note by note.
- Very large single edits (>200 KB, e.g. opening another project) are sent as a
  "reload" signal instead of a live message.
- Unused rooms accumulate until a maintainer runs `kiln_purge_rooms`.
