# Studio decisions

## 2026-10-19: Desktop first, not a native host yet

Keep TanStack / React / Web Audio and the existing installable PWA runtime.
Invest in a persistent desktop workspace rather than a native wrapper around
the phone UI. Native drivers, signed installers and plug-in hosting need a
separate runtime decision. Revisit when external hardware / plug-in requirements
are concrete; a wrapper alone does not solve real-time audio.

## 2026-10-19: Explicit export source and local LAME encoding

Do not guess whether to bounce Session or Arrangement. Let users select source,
bar range, format and tail. Use a maintained ESM LAME package instead of giving
a WAV an `.mp3` filename or uploading private audio to a third-party encoder.
Validate actual MPEG frame headers and decode exported audio in the browser.
Consequence: long exports consume local CPU and RAM; a worker / streaming encoder
is a later optimization.

## 2026-10-19: Independent library and project sources

Store reusable library audio separately from track buffers. Copy source bytes
when adding to a project and embed originals in portable backups. This uses
more disk space but keeps library edits / deletion from breaking songs.
Keep one source per track for backward compatibility; independent region assets
require an explicit project schema migration, not an undocumented shortcut.

## 2026-10-19: Preserve v1 local songs and add validated portable interchange

Retain `kiln-studio-v1` and existing optional-free project shape. Region phase
offset is optional, defaulting to zero. Portable `.kiln` files have a separate
format / version envelope and validated bounds. Re-key imported tracks and
atomically write their audio so restoring a project does not overwrite buffers
needed by the previous song or undo.

## 2026-10-19: No invented analytical lineage

KILN has no application SQL or warehouse datasets. Document browser data flow,
expose it in the UI, and retain a partial machine-readable inventory with the
table-validator applicability gap. It is preferable to an invented Bronze to
Platinum graph that falsely describes a music application.

## 2026-10-20: GitHub Pages, not a Windows executable

The studio is a client-only web app, so it is published as a static build to
GitHub Pages (`vite.pages.config.ts`, `.github/workflows/pages.yml`) on every
push to `main`, alongside the existing Vercel build. A Windows executable was
not built: it would wrap the same browser engine without native audio benefits,
and Chrome / Edge already install the site as a desktop app. Revisit with the
native-host decision above.

## 2026-10-20: Per-clip immutable audio assets (optional field, no migration)

`ArrangeClip.assetId` names an immutable audio source; absent means the legacy
track-level source (`track.id`). Old songs load unchanged, new clips get their
own assets, and portable files store every needed asset. Audio regions now play
continuously like Ableton clips (start / end markers, loop, offset) instead of
retriggering every pattern length — a deliberate behavior change for legacy
audio regions longer than their pattern length.

Clip pitch / warp use sampler-style playback rate (Ableton's Re-Pitch). Pitch-
preserving stretch needs a DSP time-stretcher and was not faked.

## 2026-10-20: Link-shared live sessions on Supabase

Rejected accounts for the first version: the request was Google-Docs-style
sharing, and capability links let anyone with the link edit without sign-up.
Only a SHA-256 of the 256-bit link secret is stored; browsers reach data only
through SECURITY DEFINER functions (tables have RLS with no policies and no
grants). Realtime channel names derive from the secret hash.

Rejected a CRDT library (e.g. Yjs) for now: the song is already an immutable
JSON document, and per-entity last-writer-wins with Lamport stamps gives
deterministic convergence for tracks / regions with a small, testable module.
Trade-off: concurrent edits to the same region's notes resolve at region level.
Revisit with note-level CRDTs if simultaneous piano-roll editing becomes common.

Undo stays personal: remote changes are rebased into the local undo history.
The user's own browser song is never overwritten by joining; autosave is
suspended in a room and the original returns on leave.
