# KILN

A clean, desktop-first music studio for arranging songs, launching clips,
organizing sounds, working on songs together live and sharing finished mixes.

**Open it:** <https://actofrod.github.io/Kiln/> (GitHub Pages, deployed on every
merge to `main`). It is a web app; Chrome / Edge can install it as a desktop
app, so no separate Windows executable is built. Mobile redesign is deferred.

The workspace includes a searchable local sound library, a 32-track arrangement
with drag-and-drop regions, an Ableton-style **Clip View** for audio clips,
piano-roll and MIDI clip tools, session launcher, swappable instruments (grand
and electric piano, organ, strings, pads, plucks, bass and drum kits), track
inspector, mixer, undo / redo, portable projects, **live collaboration** and
**real MP3 / WAV exports**. See the [Ableton feature inventory](docs/features.md) for implemented
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
npm run build:pages   # static GitHub Pages bundle in dist-pages/
```

`startup.sh` is the idempotent restart entrypoint. It starts the npm dev script
on all interfaces at port 8080. `KILN_FOREGROUND=1 sh startup.sh` is available
for process supervisors. No auth or database is enabled for the studio.

For render checks, install Chromium with `npm exec -- playwright install
chromium`, then run `node scripts/browser-smoke.mjs http://127.0.0.1:8080/
screenshots/dev.png`. The interactive regression command is
`node scripts/studio-browser-check.mjs`; it uses an isolated agent-browser
session and may download the pinned CLI on first use. Clip / drag and
two-person collaboration checks: `node scripts/clip-browser-check.mjs` and
`node scripts/collab-browser-check.mjs`.

## Use the studio

Start with **Ember Queen** (a dark cinematic demo in D minor), press Play, and use the ruler to seek. Drag library
patterns or sounds onto a track, or onto the empty area below the tracks for a
new track; you can also drop audio files straight from your computer. Click a
region to open its clip: audio clips show start / end markers, loop, reverse,
gain, transpose, detune, warp (Re-Pitch) and fades; MIDI clips show the piano
roll with transpose, velocity, reverse, invert and speed tools. Drag regions
sideways or onto another track, Alt-drag to copy, drag the right edge to resize
and the top corners of audio clips to fade. Double-click an empty MIDI lane to
draw a region. Dragging, resizing or dropping a region past the last bar extends
the song automatically (up to 128 bars). Every track header has a **⋯** button
for renaming, reordering, duplicating and deleting the track — this is how tracks
are managed on phones and tablets, where the inspector is hidden.

The library, inspector and clip editor are resizable: drag the divider at their
edge (or focus it and use the arrow keys; double-click resets it). The expand
button in the clip editor — and in the session step editor — fills the window
for focused note editing, and the grid grows to use the space; press the button
again (or Esc in the clip editor) to restore it. Pane sizes are remembered in
this browser.

Import audio into the library, audition it, then drag it in or use **+** for a
new track. **Import files** puts single sounds in _My samples_; **Folder** imports
a whole folder and keeps its sounds grouped (sub-folders too). Collapse, delete or
move sounds between folders from the library. Name, tag and favorite imported
sounds from their library details.
Every placed clip keeps its own copy of the audio. To change how a track
sounds, open **Instruments** (or the inspector's instrument card) and pick an
instrument — the notes stay the same and you hear a short preview. Microphone recording lives in
**Track sound**. MIDI recording in Instruments writes into the selected **session
scene**, not directly into an arrangement region.

Export explicitly chooses arrangement or launched session clips, inclusive bar
range, MP3 bitrate or WAV, and effect tail. Arrangement export ignores session
overrides. Sessions repeat from bar 1. Audio plays at original sample rate;
there is no tempo-aware stretching.

## Work together live

Press **Share**, enter your name and **Start live session**, then send the link.
Everyone with the link edits the same song in real time and sees each other's
avatars, cursors, selections and playheads; undo only affects your own edits.
Leaving returns your own browser song (or keeps the shared version). Details:
[collaboration](docs/collaboration.md). The cloud part uses Supabase; its public
URL and publishable key are repository variables read at build time (see the
runbook).

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

- [Live collaboration](docs/collaboration.md)
- [Architecture and local data flow](docs/architecture.md)
- [Runbook and failure recovery](docs/runbook.md)
- [Design decisions](docs/decisions/README.md)
- [Data Sources & Lineage](docs/lineage/README.md) — also available in the app footer
- [Agent handoff](docs/agent-handoff.md)

Deployment keeps the existing Vercel / TanStack Start setup and platform preview
bridge / branding, plus the static GitHub Pages workflow. The MP3 encoder runs
locally. Audio leaves the browser only when you start or join a live session;
the Supabase schema lives in `supabase/migrations/`. Never put the database
password in the app — browsers use only the public publishable key.

Maintainer: the ActOfRod/Kiln repository owner.
