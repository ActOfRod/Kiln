# KILN desktop studio: Data Sources & Lineage

> Generated from lineage.json and saved SQL. Do not hand-edit.

Browser-local music creation: factory and user notes plus imported audio feed project tracks, the shared Web Audio mixer, and local MP3/WAV downloads. There are no application SQL transformations or warehouse tables.

**Assurance: PARTIAL** | Environment: Browser-local KILN; repository inspection, no warehouse
Scope: Studio project metadata, library object store, track-source object store, Web Audio rendering and file downloads. Platform auth/database helpers are not studio data consumers.

Reviewed: 2026-10-19T19:17:20Z by GitHub Copilot
Review: Final desktop studio review: 20 isolated browser checks cover atomic library metadata, independent audio copies, portable project restoration, audible stereo MP3/WAV, 128-bar rendering, region phase and movement, live graph continuity, actionable missing-source retries and lineage navigation. Data remains browser-local; no warehouse tables, columns or SQL exist. Non-tabular strict-certification gap remains explicit.
Source fingerprint: `87d02dc309914fb44b45d1451d6e87f052e0eeff1d692533e107bc865dae2437`

[Interactive investigation](index.html) | [Manifest](lineage.json) | [Schema snapshot](<schema-snapshot.json>)

This is a recorded evidence view, not a live warehouse certification.

## Gaps and limitations

- Assurance is partial: complete the recorded gaps before release
- No tables are recorded; this is not a complete application inventory
- No application-serving Platinum dataset is declared; classify the actual serving contract
- Application has no recorded data consumers
- Gap non-tabular-applicability \(Table-centric strict lineage assurance\): This application uses browser object stores, not relational or analytical tables. There is no real Platinum dataset, SQL transformation, warehouse schema snapshot or table-access consumer to certify.; owner: Repository maintainer and lineage-tool maintainer
- Schema snapshot: missing or empty file docs/lineage/schema-snapshot.json
- The table-centric validator has no browser-object-store applicability mode. Its table/Platinum/consumer/snapshot requirements are intentionally not satisfied with fabricated analytical datasets.
- No warehouse schema snapshot or transformation SQL exists because the studio has no warehouse or application SQL.
- Audio remains local and is not inspected in deployed users' browsers. Browser storage retention is not guaranteed.
- non-tabular-applicability: Define an approved non-tabular applicability contract before requesting strict table-lineage certification. Until then retain partial assurance, documented browser flow and executable application tests; do not invent tables or SQL. (owner: Repository maintainer and lineage-tool maintainer)

## Complete table source matrix

| Layer | Dataset / meaning | Owner / grain / refresh | Immediate inputs | Consumers / outputs | SQL |
| --- | --- | --- | --- | --- | --- |

## Platinum column source matrix (transitive)

Sources include value and row/control roles; `* [rowset]` is a row-count dependency, not a wildcard column mapping.

| Platinum column | Bronze | Silver | Gold | External / Platinum | Origins | Recorded trace |
| --- | --- | --- | --- | --- | --- | --- |

## Every column and every writer


## Transformations and saved SQL

## Application consumers

| Consumer / implementation | Purpose | Reads | Writes |
| --- | --- | --- | --- |

App section: Data Sources &amp; Lineage at / \(Data Sources &amp; Lineage footer dialog\).
Implementation: [src/components/studio/StudioApp.tsx](<../../src/components/studio/StudioApp.tsx>); smoke test: [scripts/studio-browser-check.mjs](<../../scripts/studio-browser-check.mjs>).
Access control: Public sanitized application structure only. No user project names, tags, audio, credentials or filesystem paths are exposed by the documentation view.

## Evidence register

| ID | Kind | Observed | Reference / summary |
| --- | --- | --- | --- |
| project-contract | repository\_inspection | 2026-10-19T18:42:31Z | [src/studio/project-file.ts](<../../src/studio/project-file.ts>)<br>Project metadata, numeric bounds, track/clip/region contracts and embedded sample envelope are validated before import. |
| browser-library | repository\_inspection | 2026-10-19T18:42:31Z | [src/studio/library.ts](<../../src/studio/library.ts>)<br>Library originals and metadata are stored in kiln-library.sounds. Project originals are copied into kiln-samples.buffers under new track IDs. |
| audio-render | repository\_inspection | 2026-10-19T18:42:31Z | [src/studio/engine.ts](<../../src/studio/engine.ts>)<br>Project notes and decoded source audio feed per-track effects and the stereo master. Offline rendering uses the same graph and downloads encoded PCM or MP3. |
| browser-regressions | test | 2026-10-19T18:42:31Z | [scripts/studio-browser-check.mjs](<../../scripts/studio-browser-check.mjs>)<br>20 isolated browser checks verified library search/favorites and concurrent metadata updates, project-audio copy and backup roundtrip, reload persistence, decoded non-silent stereo MP3/WAV, 128-bar rendering, region movement and phase-preserving splitting, live graph continuity, missing-source retries and visible lineage navigation. |
