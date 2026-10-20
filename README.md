# KILN

A clean, desktop-first music studio for arranging songs, launching clips,
organizing sounds and sharing finished mixes. The browser / installed desktop
PWA is the current runtime; a native executable and mobile redesign are outside
this release.

The workspace includes a searchable local sound library, a 32-track arrangement
with region and piano-roll editing, session launcher, synths and drum machine,
track inspector, mixer, undo / redo, portable projects and **real MP3 / WAV
exports**. See the [Ableton feature inventory](docs/features.md) for implemented
capabilities and explicit limitations.

## Run and verify

Use Node 22.18+ (or Node 24) and npm.

```sh
npm install
npm run dev
npm run typecheck
npm run test:studio
npm test
npm run build
```

`startup.sh` is the idempotent restart entrypoint. It starts the npm dev script
on all interfaces at port 8080. `KILN_FOREGROUND=1 sh startup.sh` is available
for process supervisors. No auth or database is enabled for the studio.

For render checks, install Chromium with `npm exec -- playwright install
chromium`, then run `node scripts/browser-smoke.mjs http://127.0.0.1:8080/
screenshots/dev.png`. The interactive regression command is
`node scripts/studio-browser-check.mjs`; it uses an isolated agent-browser
session and may download the pinned CLI on first use.

## Use the studio

Start with **Night Drive**, press Play, and use the ruler to seek. Click or drag
a library pattern into a compatible track; an incompatible selected instrument
gets a new matching track when inserting by click. Double-click an empty MIDI
lane or a region to open the piano roll. Select a region to duplicate, split at
the playhead or delete it; drag its right edge to resize.

Import audio into the library, audition it, then use **+** to add an independent
copy to the song. Name, tag and favorite imported sounds from their library
details. Each audio track currently has one source file; use separate tracks
for different files. Microphone recording and source trim live in **Track
sound**. MIDI recording in Instruments writes into the selected **session
scene**, not directly into an arrangement region.

Export explicitly chooses arrangement or launched session clips, inclusive bar
range, MP3 bitrate or WAV, and effect tail. Arrangement export ignores session
overrides. Sessions repeat from bar 1. Audio plays at original sample rate;
there is no tempo-aware stretching.

## Storage and backups

Songs auto-save to localStorage; imported library audio and project audio use
separate IndexedDB databases. Download a `.kiln` project with **Save** to back
up metadata **and original audio**. Open restores it using new track IDs so
existing audio and undo history are not overwritten. The sound library itself
is not included in a project backup; only the audio used by its tracks is.

Browser storage is not cloud storage or a permanent backup. Clearing site data,
changing browsers or storage eviction can remove local songs and samples. Save
portable projects regularly. Imports are limited to 50 MB per library sound;
portable files are limited to 200 MB. File-format support depends on the browser.

## Architecture and operation

- [Architecture and local data flow](docs/architecture.md)
- [Runbook and failure recovery](docs/runbook.md)
- [Design decisions](docs/decisions/README.md)
- [Data Sources & Lineage](docs/lineage/README.md) — also available in the app footer
- [Agent handoff](docs/agent-handoff.md)

Deployment keeps the existing Vercel / TanStack Start setup and platform preview
bridge / branding. The encoder is dynamically loaded and runs locally. No audio
upload service, credentials or new database migrations are required.

Maintainer: the ActOfRod/Kiln repository owner.
