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
These are not waived studio failures: studio and collaboration unit tests (23), smoke-verdict tests (40),
the isolated studio browser checks (20), the clip / drag checks (13) and the
two-person collaboration checks (16) must pass. The agent-browser CLI used by
the studio check occasionally drops its CDP connection on macOS; rerun once.

Deploy the branch through the repository's normal Vercel flow. Roll back the
deployment to the prior version if needed. Download a project before changing
storage schemas; do not clear users' browser storage as a migration.

## GitHub Pages

`.github/workflows/pages.yml` builds `npm run build:pages` (static client in
`dist-pages/`, base `/<repo>/`) and deploys on every push to `main` (merged PRs)
or manual dispatch. Site: <https://actofrod.github.io/Kiln/>. Preview locally
with `npm run build:pages && npm run preview:pages` (port 8082, path `/Kiln/`).
The `github-pages` environment only accepts `main`.

CI installs with Node 22 (npm 10) using `npm ci`. npm 11 drops some
optional-peer entries that npm 10 requires, which breaks `npm ci` in CI. After
changing dependencies, run `npx -y npm@10 install --package-lock-only` and
confirm `npx -y npm@10 ci --dry-run` succeeds before merging.

## Live collaboration (Supabase)

1. Schema: `supabase/migrations/20261020130000_kiln_collaboration.sql`
   (idempotent). It was applied to project `nfcgdbmasvoamdmykjwp` on
   2026-10-20. Re-apply with `supabase link --project-ref nfcgdbmasvoamdmykjwp`
   then `supabase db push`, or run the file in the SQL editor.
2. Browser configuration (public, not secret): repository **variables**
   `VITE_SUPABASE_URL` (set) and `VITE_SUPABASE_PUBLISHABLE_KEY` (Dashboard →
   Project Settings → API Keys → publishable / anon key). Without the key the
   Pages site shows "Live collaboration isn't configured". For local cloud
   testing put both in an untracked `.env.local`.
3. Never put the database password or a service-role key in the app, repo or
   workflow. **Rotate the database password** if it has been shared in chat or
   tickets (Dashboard → Database → Reset password).
4. Realtime must allow public channels (Supabase default). Rooms are secured by
   the secret-derived channel name and the secret-checking functions.
5. Cleanup: `select public.kiln_purge_rooms(interval '180 days');` (maintainer
   role only) deletes idle rooms and their audio.
6. End-to-end cloud check (production build, real Supabase, three isolated
   browsers, 14 checks):
   `VITE_SUPABASE_URL=… VITE_SUPABASE_PUBLISHABLE_KEY=… npm run build:pages && node scripts/collab-cloud-check.mjs`.
   It creates a real "Ember Queen" room; delete test rooms afterwards with the
   maintainer role. Manual check after deploy: Share, open the link in a private
   window, confirm avatars, cursor, an edit, an audio drag-in and rejoin.
7. "Client presence rate limit exceeded" closes a Realtime channel. Keep
   presence updates slow (`PRESENCE_INTERVAL`) and put frequent state in
   broadcasts; the client reconnects and re-merges automatically.

`node scripts/collab-browser-check.mjs` runs the same two-person flow in dev
against the local BroadcastChannel backend (used automatically when no
publishable key is configured in dev). `node scripts/clip-browser-check.mjs`
covers Clip View, drag-and-drop, fades, rendering of clip settings and portable
per-clip audio. `node scripts/instrument-browser-check.mjs` swaps every
instrument and drum kit in the UI and verifies each renders audibly in exports.

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
| Pages site 404 / unstyled           | Confirm the workflow ran on `main`, `PAGES_BASE` matches the repository name, and assets load under `/Kiln/`                       |
| "Collaboration isn't configured"    | Add the `VITE_SUPABASE_PUBLISHABLE_KEY` repository variable and redeploy                                                           |
| Share link "not found or invalid"   | Link truncated or room purged; the secret after `#` must be complete                                                               |
| Live shows Offline                  | Network / Realtime outage or rate limit; KILN reconnects within seconds and merges edits — keep working                            |
| Collaborator can't hear new audio   | Upload still running (panel shows "Sharing audio…"), file > 60 MB, or room over its 300 MB audio limit                             |

## Ownership and data maintenance

The repository maintainer owns application changes; the browser user owns
projects and local audio. There are no warehouse refresh jobs, backfills or
data-quality SLOs. Source duration is measured when imported, not inferred from
file names. Library favorites / tags do not affect audio rendering.

Keep samples needed by undo; deleting project files or library entries is not
currently an audio garbage collection mechanism. Long-running use can accumulate
orphaned track buffers. A future cleanup feature must account for undo, current
projects and portable backups before removing any data.

Lineage now covers the two Supabase tables, their three writer functions
(saved SQL is the migration itself) and the collaboration consumer; browser
stores stay in `browser_stores`. The strict gate remains partial for two
recorded gaps: the generator has no Postgres snapshot origin (the live capture
is evidence in `docs/lineage/evidence/`), and the Realtime path still needs an
end-to-end test once the publishable key is configured. Do not invent tables or
relabel the capture to pass. After any schema change: re-capture metadata
read-only, update `lineage.json`, then `lineage.py review`, `render`, `check`.
