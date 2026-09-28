# figma-make-app

React + Vite + Tailwind CSS project running inside Figma Make.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Primary application component and the usual starting point for UI work
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

## Code quality

- Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings. An unescaped apostrophe in a single-quoted string breaks the build.
- Ensure JSX tags are closed and braces are balanced.
- Export components as default exports.

## Session handoff (Sep 24 2026)

### CRITICAL rules
- **NEVER run `npx oxfmt` on `src/App.tsx`** — it destroyed ~700–960 lines of uncommitted work via a subsequent `git checkout -- src/App.tsx` revert to HEAD `44af7c5`. oxfmt is safe only on small util files. `App.tsx` is now 6192 lines hand-rebuilt from the compiled bundle.
- Two copies stay in sync: source of truth = Desktop `ContentOS` (Vite dev `:8443`); served copy = `C:\laragon\www\ContentOS` (Apache `http://localhost/ContentOS/`). Sync `dist\*` (delete old hashed assets via `Remove-Item -Path ...\dist\assets\* -Force`, NOT `-LiteralPath`) and PHP files to Laragon; `src` is NOT normally synced.
- Dev server: `npm run dev` (`--host 0.0.0.0`, port 8443). Tests: `npm run test` (73/73). Typecheck: `npx tsc --noEmit`. Build: `npm run build`.

### Recovery context
- Lost uncommitted approval/bulk/auto-publish UI work was fully re-implemented from the pre-incident bundle `dist/assets/index-Bwr3XraA.js` (minified, no sourcemap = ground truth). Source-level recovery was definitively exhausted; re-implementation was user-approved.
- Import aliases in `src/App.tsx` to avoid colliding with a local `reject` (image-promise ~line 1392): `approveStage`, `rejectStage`, `resubmitStage`, `addComment`, `approvalStageLabel`, `isFullyApproved`, `APPROVAL_STAGES`, `type ApprovalLogEntry`, `runAutoPublish`.

### Completed (all verified: tsc clean, 73/73 tests, vite build ok, dist synced to Laragon)
- `CommentComposer` + multi-stage Approval Flow stepper + Activity thread in `PostDetailPanel`.
- `ApprovalView` rework: multi-stage stepper, Comments & History, per-tab actions, bulk approve/reject.
- `ContentView` bulk mode: Bulk toggle, select-all, Set-status Apply, Reschedule modal, Delete confirm.
- `App` handlers: `handleApprovalAction`, `handleDeleteManyContent`, `handleStatusManyContent`, `handleRescheduleManyContent`.
- Auto-publish loop: `contentOS_autoPublish` toggle, content/brands refs, 45s `runAutoPublish` tick, CalendarView ON/OFF toggle.
- Render-props wired throughout. Fixed latent syntax error `src/utils/approval.ts:52` (missing `;` → `{ state: ApprovalState; done: boolean }`).
- Temp extraction files `.approval-segment.txt` / `.en-segment.txt` deleted.

### Pending (Phase 2.5 backlog)
1. #4 — notifications.
2. X (Twitter) live post still user-blocked: attach X dev app to a Project at developer.x.com (Basic tier), then retry real tweet via `publish.php` (kv_store creds) and confirm auto-publish flips status. MySQL is manual-start.

### Session handoff (Sep 28 2026) — #3 publish queue / partial failures

**Status: complete.** `tsc --noEmit` clean, 100/100 tests (73 + 27 new), `vite build` ok, `dist` synced to Laragon. No PHP changed, so no `api/` sync was needed.

#### New — `src/utils/publish-queue.ts` (pure engine, fully unit-tested)
- `PublishState` = `queued | publishing | success | failed | blocked | skipped`, with `PublishEntry` (attempts history) and `PublishAttempt` (1-based, timestamp, `blocked` flag).
- `buildQueue(existing, content, now, isConnected, options)` merges a fresh view of due posts into the live queue. `options: "preserve"` (default) keeps attempt history, `"reset"` re-queues failures. **This replaces the old `useEffect(() => setResults({}), [open])` reset that wiped the run history on every re-render, and fixes the stale-closure bug where the first auto-publish failure re-queued every scheduled post as brand-new.**
- `runPublishQueue(opts, handlers, onPatch)` — resolves the queue oldest-first, one row at a time, emitting `start / attempt / skip / circuit / progress / report` patches so the caller owns the state. Never throws: a rejected publisher becomes a failed row and the run continues.
- Failure classification: `isNonRetryableMessage()` (401/403/invalid token/not connected) → `blocked` = "Needs setup", no retry. Everything else → `failed`, retryable up to `MAX_PUBLISH_ATTEMPTS` (3), then "gave up after 3 attempts".
- **Circuit breaker**: 4 consecutive failures with no success in between → the rest of the run is skipped rather than hammering a downed API.
- Cancel resolves whatever is already in flight (a post published upstream must always flip its status, or the next tick double-publishes) and skips only the not-yet-started rows.
- `canRetry` / `retryableIds` / `resetEntries` / `countByState` / `makeQueueEntry` / `summarizeReport` for the UI.

#### Changed — `src/App.tsx`
- `PublishQueuePanel` reworked: rows now show a state badge (Queued / Publishing / Published / Failed / Needs setup / Skipped), `attempt n/3`, per-row **Retry**, **Publish All Due**, **Retry N Failed**, a **Failed** tab, a dismissible run summary, a progress bar with **Cancel**, and **Clear finished**. Failures and successes survive closing the panel.
- `publishToConnectedPlatform(item, brands)` now takes brands instead of a pre-resolved channel/defn and returns a "not connected" result instead of throwing — the channel lookup lives in one place (`canPublishItem`) and one bad channel can't abort a batch.
- Deleted the duplicate local `parseScheduledDate` / `dateKey` / `addDays` / `getWeekStart`; they now come from `src/utils/calendar-helpers.ts` (the queue engine uses the same functions).
- Auto-publish `onFailed` now dispatches `contentos:auto-publish-failed` on `window`; the queue listens so a background failure is recorded instead of being re-queued later.
- `runAutoPublish` wiring: `publish: item => publishToConnectedPlatform(item, brandsRef.current)` (new signature).

#### New tests — `src/utils/__tests__/publish-queue.test.ts` (27)
Queue building (due-window, ordering, connected flag, history preserved, reset, drop/re-add), retry rules, partial failure (published + failed + blocked in one run, thrown errors, auth vs 429 classification, attempt cap, append-on-retry, never republish a success, missing content, cancel, circuit breaker, progress patches) and report summaries.

### Session handoff (Sep 28 2026) — Facebook integration live-tested

**Answer: post automation now works.** Verified end-to-end through the app's own proxy
(`POST http://localhost/ContentOS/api/publish.php`) against the **Lernet** brand's Facebook channel.

- The channel is **not** in the `brand_channels` table (that table is empty) — it lives in the KV
  store, `contentos.kv_store` key `contentOS:brands`, brand **Lernet**, channel `facebook`,
  `connected: true`, config keys `appId` / `pageId` / `appSecret` / `accessToken`. Same for the
  `x` and `youtube` channels. The relational `brands` table only has "Tech Tips" (id 2) — the app
  is running on the KV path, not the API path.
- Page: **appstai.com**, page id `1665501390368935`, app id `1075417298542424`.
  Token = valid **user** token, `is_valid=true`, scopes `pages_show_list, pages_read_engagement,
  pages_read_user_content, pages_manage_posts, pages_manage_engagement, public_profile`,
  `expires_at` ≈ Nov 2026.
- **Bug found and fixed in `api/publish.php`**: it posted to `/{pageId}/feed` with the *user* token
  and Graph rejected every attempt with error **#200**. `handle_facebook` now goes through
  `facebook_feed()`, which mints a page token via `facebook_page_token()` and retries once on
  #200 / #10 / #190. Also moved the FB/IG handlers off EOL Graph `v19.0` to `v23.0`
  (`$GRAPH`, override with `CONTENTOS_FB_GRAPH_VERSION`).
- `php -l` clean; synced to `C:\laragon\www\ContentOS\api\publish.php`; health + devto regression
  re-checked.

**Gotcha for next time — reading these creds from MySQL.** The value in `kv_store` is JSON, and the
path must match the column you selected. `JSON_TABLE(..., c JSON PATH '$.config')` then needs
`c->>'$.accessToken'`, **not** `c->>'$.config.accessToken'` (returns NULL). In PowerShell, write the
SQL in a single-quoted string with doubled `''` quotes, and note that MySQL in default mode treats
`"..."` as a string literal — JSON paths need **single** quotes. Also `Set-Content -Encoding UTF8`
emits a BOM in Windows PowerShell 5.1, which makes `json_decode(php://input)` fail with
"Body must be JSON" — use `[System.IO.File]::WriteAllText($p, $json, (New-Object System.Text.UTF8Encoding($false)))`.

**Still untested:** Instagram (no IG credentials configured, and the handler shares `$GRAPH` now),
LinkedIn, TikTok, WooCommerce. Two test posts were left on appstai.com
(`…_1829662188922788`, `…_1829663122256028`) unless the user asked for them to be removed.


