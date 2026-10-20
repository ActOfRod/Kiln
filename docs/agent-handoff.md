# Desktop studio handoff

Read README, features, architecture, runbook and decisions first. Main code:
`StudioApp.tsx`, `ArrangeView.tsx`, `LibraryBrowser.tsx`, `TrackInspector.tsx`,
`ExportDialog.tsx`; `src/studio/store.ts`, `engine.ts`, `voices.ts`,
`regions.ts`, `project-file.ts`, `library.ts`, `samples.ts`, `export.ts`.

October 19, 2026, macOS / Node 24: the targeted studio tests and TypeScript
check passed (9 studio tests). The isolated browser regression passed all 20 checks, including
decoding a non-silent stereo MP3 and restoring a project containing imported
audio after reload, concurrent library metadata updates, length-preserving
region movement, live graph continuity on track reorder and audible rendering
through the final bar of a 128-bar song, and actionable missing-source errors on
repeated playback attempts. Desktop and 390px render checks showed visible content,
no page / console errors, no outer horizontal overflow and existing custom
branding. See the runbook for commands to reproduce; screenshots are ignored
local artifacts, not deployment inputs.

The smoke-verdict suite passed 40 tests and existing TypeScript library tests
passed 59 tests. Targeted ESLint completed with no errors and four existing-pattern
warnings (PlayView effect dependencies and mixed utility/component exports in
ui.tsx). The complete script suite has 197 tests, 181 passing and 16 failing;
the same 16 failures were reproduced from original HEAD in an isolated archive.
They concern missing ignored `.grok` template assets/config and template branding
expectations, not the desktop changes. Do not claim the full repository suite is green.

The implementation is desktop-first **web / PWA**, not a native executable or
full commercial DAW. Do not infer automation, warping, comping, native plug-ins,
cloud storage or independent audio sources per region from the timeline UI.
The feature inventory is the scope authority.

Extend project contracts and validators together. Keep offline / live rendering
on the same graph. Preserve sample source phase on region splits and partial
range export. Use the existing browser test's HMR-aware module resolution if
inspecting Zustand from devtools; importing an unversioned dev module after HMR
can instantiate a second store and invalidate tests.

The audio graph uses random noise / reverb; compare decoded signal, duration,
format and channel contracts rather than byte hashes. Library import tests use
generated non-copyrighted sine audio. Browser QA must use an isolated named
session, not the default browser shared with other work.

Known limits owned by the maintainer: no track-audio garbage collector, an
in-memory (80 snapshot) undo history, full-buffer offline rendering, one source
per audio track, and fixed 4/4. Mobile-specific UX remains deliberately deferred.
Table-centric strict lineage assurance is not applicable; its explicit partial
inventory must not be represented as warehouse-certified lineage.
