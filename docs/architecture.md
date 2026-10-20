# Desktop studio architecture

## Why this shape

The old touch-first, mutually exclusive screens constrained desktop editing.
The desktop shell now keeps the browser and track inspector beside a shared
workspace, with transport and project controls always visible. Arrangement,
Session, Mixer and Instruments still operate on one project and one audio
engine. Preserving that contract avoids two independently evolving DAWs and
retains browser-local v1 projects.

`StudioApp` owns shell / dialogs. `LibraryBrowser` owns library UI, metadata and
audition. `ArrangeView` owns region selection and piano-roll UI.
`TrackInspector` shares the existing device parameters. `store.ts` is the
authoritative project mutation / undo layer. `regions.ts` implements splitting
and bounds; `project-file.ts` validates interchange with Zod.

## Data and signal flow

```text
factory.ts patterns / manual notes --> Project.tracks[].clips or arrangement
local audio files --> kiln-library.sounds (independent original audio + metadata)
library add / microphone --> kiln-samples.buffers[trackId] --> decoded sampleBank
Project + launch state --> engine Performer --> per-track voices / sample source
  --> drive --> filter --> dry + delay + reverb --> volume --> pan
  --> master gain --> compressor --> speakers or OfflineAudioContext
offline stereo PCM --> WAV writer / lazy-loaded LAME MP3 encoder --> download
Project edits --> Zustand persist --> localStorage[kiln-studio-v1]
Project + original track audio --> versioned portable .kiln download
```

These are browser object stores and application objects, **not** relational
tables or Bronze / Silver / Gold / Platinum warehouse datasets. The existing
auth / database helpers are platform scaffolding, not studio consumers. No
application SQL or remote business tables are used.

## Contracts

Time values are quarter-note beats; 4 beats per bar, inclusive export bar
numbers, sample trim in seconds, velocity / volume in 0–1 and pan in −1–1.
Synth note duration converts beats to seconds at scheduling time. Library
`addedAt` is Unix milliseconds, used only for descending local import order.
IDs, not names, identify tracks, notes, clips, regions and library sounds.
Duplicate names are valid; portable imports reject duplicate track IDs.

An audio track owns one original source. Regions refer to it through their
track ID, not to library records. Deleting a library record cannot break
project playback. Replacing a track's source deliberately affects all its
regions. MIDI regions own their note arrays; a split keeps a pattern-phase
offset so the right half does not restart from the first beat.
Region movement clamps position without truncating its length. Reordering or
adding tracks preserves existing live audio graphs. Library metadata changes
are field patches applied in one read/write transaction, so simultaneous name,
tag and favorite edits cannot overwrite one another's independent fields.

Regions are additive if placed on top of each other; there is no take-priority
system. MIDI region length controls looping / clipping, while pattern length
controls note repetition. There is no audio warping: a tempo change affects
region boundaries and repetition, not source playback rate.

Undo retains at most 80 metadata snapshots in memory; pointer drags are grouped.
Project audio is retained under old track IDs for undo rather than aggressively
garbage-collected. Undo / redo history is not persisted or backed up.

The export source is explicit, never inferred from whether arrangement material
exists. Offline rendering uses the live voice / effects implementation with no
metronome. Selected ranges resume sustained notes / samples at the range start.
Instrument envelopes restart when seeking into a sustain; this is not a
sample-exact replay of audio before the seek point. Random synthesized percussion
and reverb impulses mean two renders need not be bit-identical.

## Access, errors and safe extension

Everything musical is local. Microphone access is user-initiated. No accounts
or shared world-writable database are added. Public lineage information is
sanitized application structure, not user audio, metadata or local file paths.

Storage, codec, microphone and export failures have visible messages. Import
validates project structure and decodes embedded audio before switching the
active project; a single IndexedDB transaction writes the new audio set.
Missing sources fail playback / export instead of silently producing incomplete
mixes. An empty unused audio track is permitted.

New editing operations belong in `store.ts` and pure region helpers. New DSP
belongs in `voices.ts` / `engine.ts` so offline export and playback stay aligned.
Before implementing independent region sources, introduce a versioned asset ID
and migrate project interchange, persistence, library insertion, sample restore,
undo retention and export together. Do not hide it behind a UI-only control.
