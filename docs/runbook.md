# Studio runbook

## Environments and release

Local: `npm run dev`, no credentials. Production: existing Vercel build
(`npm run build`) and platform environment wrapper. The studio does not require
`DATABASE_URL`, auth or xAI. Do not enable auth just to persist browser-local music.

Before release run `npm run typecheck`, `npm run test:studio`, `npm test`, and
`npm run build`. Run the browser smoke on dev (desktop and narrow screens),
inspect both screenshots, then smoke the built preview with the dev verdict
as `--baseline`. `npm run preview` serves the built application; on macOS start
it with `-- --host 127.0.0.1 --port 8081`. The existing `preview:restart` helper
uses Linux `/proc` process ownership and is intended for the platform sandbox.

`node scripts/studio-browser-check.mjs` runs the dev-only integration check
against isolated browser storage. It exercises library search / favorites,
regions, note editing, playback, sample import / audition / insertion,
portable audio backup / restore, autosave, actual MP3 / WAV downloads and
lineage navigation. Fixtures and screenshots go to ignored `screenshots/`.

Known baseline: the script stage of `npm test` reports 181 passing / 16 failing
out of 197 tests, identically on the original HEAD and this change. Failures
depend on absent ignored `.grok` assets / app-env configuration and template
branding fixtures. Its `&&` prevents the TypeScript library stage from running;
run the explicit library test command from `package.json` separately (59 pass).
These are not waived studio failures: studio tests (9), smoke-verdict tests (40)
and the isolated studio browser checks (20) must pass.

Deploy the branch through the repository's normal Vercel flow. Roll back the
deployment to the prior version if needed. Download a project before changing
storage schemas; do not clear users' browser storage as a migration.

## Failure diagnosis

| Symptom                             | Investigation / recovery                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| No sound                            | Start playback with a user gesture; check track mute / solo, master level and browser audio permission                             |
| Missing audio warning               | Restore a portable project, or reimport the original source through Track sound; retrying does not bypass the missing-source check |
| Library import rejected             | Check supported browser codec and 50 MB size limit; prior successfully imported files remain in IndexedDB                          |
| Microphone denied                   | Check browser permissions and secure origin; importing audio remains available                                                     |
| Auto-save failed                    | Browser quota or private-mode restriction; download a portable backup immediately                                                  |
| Project rejected                    | Version / shape / bounds or embedded audio invalid; active project is not replaced before validation completes                     |
| Very slow export                    | Large song / many voices consume CPU and RAM locally; export a shorter range and close other resource-heavy applications           |
| Short / long audio after tempo edit | No time stretching exists; original-rate source and musical region lengths are different contracts                                 |
| Deleted library sound still plays   | Expected: project audio is an independent copy                                                                                     |
| White production page               | Check actual built preview and JS module responses; do not rely on a dev-only render                                               |

## Ownership and data maintenance

The repository maintainer owns application changes; the browser user owns
projects and local audio. There are no warehouse refresh jobs, backfills or
data-quality SLOs. Source duration is measured when imported, not inferred from
file names. Library favorites / tags do not affect audio rendering.

Keep samples needed by undo; deleting project files or library entries is not
currently an audio garbage collection mechanism. Long-running use can accumulate
orphaned track buffers. A future cleanup feature must account for undo, current
projects and portable backups before removing any data.

The table-centric lineage validator cannot certify a browser-only object-store
app without fabricating tables. The partial manifest records that applicability
gap explicitly. Do not invent warehouse tables / SQL or weaken the validator.
Review source changes, regenerate the technical inventory and retain the
in-app local-flow explanation when changing storage or audio behavior.
