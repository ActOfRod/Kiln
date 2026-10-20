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
