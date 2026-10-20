# Desktop studio handoff

Read README, features, collaboration, architecture, runbook and decisions first.
Main code: `StudioApp.tsx`, `ArrangeView.tsx`, `ClipView.tsx`,
`Collaboration.tsx`, `LibraryBrowser.tsx`, `TrackInspector.tsx`,
`ExportDialog.tsx`; `src/studio/store.ts`, `engine.ts`, `audio-clip.ts`,
`regions.ts`, `project-file.ts`, `library.ts`, `samples.ts`, `export.ts`;
`src/collab/doc.ts`, `session.ts`, `supabase-backend.ts`, `local-backend.ts`;
`supabase/migrations/`.

## State on 2026-10-20

- Clip View: clicking an audio clip opens Ableton-style controls (markers,
  loop, reverse, gain, transpose, detune, Re-Pitch warp, fades). MIDI clips get
  transpose / velocity / reverse / invert / speed / duplicate-loop tools.
- Drag and drop: regions move between compatible tracks, Alt-drag copies, fade
  handles, library sounds and computer audio files drop onto lanes or the empty
  area (new track). Per-clip immutable `assetId` audio.
- Live collaboration via Supabase: share links, presence (avatars, cursors,
  selections, playheads), per-entity Lamport LWW sync, shared audio chunks,
  offline merge, personal undo. The migration is applied to project
  `nfcgdbmasvoamdmykjwp` and was exercised as the `anon` role.
- GitHub Pages workflow deploys `dist-pages` on push to `main`. Repository
  variable `VITE_SUPABASE_URL` is set; **`VITE_SUPABASE_PUBLISHABLE_KEY` is not**
  (the agent had no dashboard access). Until it is added, the Pages site shows
  collaboration as not configured.
- The database password was shared in chat; the owner should rotate it. It is
  not stored anywhere in the repository.

## Verification (macOS, Node 24)

Typecheck, `npm run test:studio` (23 unit tests incl. merge convergence),
smoke-verdict (40), existing library tests (59), studio browser check (20),
`scripts/clip-browser-check.mjs` (13) and `scripts/collab-browser-check.mjs`
(16, two pages, local backend) passed. Production Vercel build and the Pages
build were smoke-tested with clean consoles. The full script suite keeps the
same 16 template failures reproduced on the original HEAD.

## Known limits

Same-region note edits merge at region level; no accounts / view-only links /
revocation; Realtime untested end to end until the key is added; no
pitch-preserving warp; no audio garbage collection; in-memory undo; fixed 4/4.
Mobile-specific UX remains deferred. Lineage is partial with two recorded gaps.
