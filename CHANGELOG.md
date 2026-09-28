# Changelog

All notable changes to **ContentOS** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to commit history located in `git log`.

---

## [Unreleased]

### Cross-tab duplicate publishing
The auto-publish loop runs in **every open browser tab** and its in-flight guard is per-tab, so two
tabs ticking on the same due post published it twice (observed live: two identical Facebook posts
sharing one `created_time`). A client-only lock cannot fix this, so the guard moved server-side.

#### `api/publish_lock.php` (new)
- **Filesystem lock keyed by `platform:contentId`** — 120 s in-flight TTL, 900 s success dedupe
  window. Deliberately filesystem-based rather than MySQL: `publish.php` is an unauthenticated
  same-origin proxy with no database handle, and a temp file needs no configuration.
- **Atomic acquisition** via `fopen(…, 'x')` (`O_EXCL`), so only one process wins the race.
  Empty or unsafe keys disable locking rather than collapsing every post into one lock.
- **A deduped request still returns success** plus the original post id, so a late tab converges on
  the same state instead of retrying forever.
- The `expires` stamp this writes was **initially never read** — see the stale-receipt fix below.
- Verified: 8 concurrent requests for one post produced exactly 1 send and 7 suppressed.

#### `api/tests/publish_lock_test.php` (new)
16 checks: first/second acquire, live vs expired state, cross-key isolation, release, empty and
hostile keys, and sweep behaviour.

### `src/utils/proxy.ts`
- **`contentId` added to the publish payload** so the server can key the lock on a specific item.
  Without it there is no safe way to tell a duplicate from two genuinely identical posts.

### Approval and scheduling
#### `src/utils/calendar-helpers.ts` — fully-approved posts never auto-published
- **The Approval tab and the publish scheduler were two independent writers to `status`**, and only
  one was honoured. Approving a post set `status` to `"approved"`/`"review"`, which the scheduler's
  filter excluded — so clicking Approve silently made a scheduled post *unpublishable* and the timer
  could never reach it again. Nothing promoted it back to `"scheduled"`.
- **`isAutoPublishable(item)`** replaces the bare `status === "scheduled"` check: a post qualifies if
  it is explicitly scheduled, **or** fully approved through the 4-stage flow *and* carries a time.
- **`rescheduleRevivePatch(item)`** (new) — moving the time of an already-published post returns it to
  `"scheduled"` and clears `publishedAt` / `externalPostId`. See the reschedule fix below.

#### `src/types.ts`
- Added `approvalStage?: number` and `approvalLog?: ApprovalLogEntry[]` so approval progress is
  persisted and readable, not inferred from a status string.

### `src/utils/content-ops.ts` (new)
Bulk approve/reject **silently discarded every write but the last**. A `for` loop over ids called
`setContent` with a value computed from a stale render, so each iteration overwrote the previous
one and only the final post kept the new status.
- **`patchItem(list, id, patch)`** and **`patchItems(list, patches)`** apply updates as pure
  list transformations, so callers compose a single state update instead of racing.
- **`handleApprovalAction`** now computes the next item and persists inside one functional
  `setContent` updater.
- **`scheduleStampFor()`** is shared by the single and bulk status paths, so a dateless post moved to
  `"scheduled"` gets a real timestamp in both cases. Without it such a post had no parseable date and
  the queue skipped it forever.
- **`localPushStarted`** module guard prevents React StrictMode's double-mount from pushing local
  content to the API twice.
- **`inFlightRef`** was a plain `useState` local, rebuilt whenever the auto-publish effect re-ran
  (i.e. on every toggle). Flipping the switch mid-publish emptied the set while a send was still
  awaiting, letting the next tick publish the same post again.
- 8 new tests in `src/utils/content-ops.test.ts`.

### Stale publish receipts (the "re-publish did nothing" bug)
**A post that had already been published could never be published again, and the app reported success
when it did nothing.** Observed live: a post edited and re-published 46 minutes later showed the
*original* post id and the *original* publish time, while Facebook kept the old caption.

#### `api/publish_lock.php` — the lock expiry was never checked
- **A confirmed publish wrote an `expires` stamp that nothing ever read.** The only cleanup was the
  hourly file sweep, so a lock outlived its own window by up to 45 minutes and the real dedupe window
  was an hour rather than the documented 15.
- On that hit `publish.php` echoed the lock's stored `at` / `external_id` back as a **success**, and
  `recordPublished` only overwrote when a value was present — so a stale receipt stuck permanently.
- **`contentos_publish_lock_is_live()`** (new) and a reclaim branch in `acquire()` treat a record past
  its own window as available.
- A `contented_` / `contentos_` typo had left the whole expiry block unreachable, which is why this
  never ran.
- **Corrected a test that asserted the buggy behaviour** directly beneath a comment saying "An
  expired lock must not block forever" — the stated intent was correct, the assertion enforced the
  opposite.
- **`api/tests/publish_dedupe_test.php`** (new): 4 regression checks covering an expired published
  lock, an expired in-flight lock, and that a *live* lock still suppresses a duplicate.

#### Suppressed sends are no longer reported as publishes
- The proxy already returned `deduplicated: true`, but `publishToConnectedPlatform` dropped it, so
  every response read as a send. It now flows through to both the manual and auto-publish paths,
  which report **"No new post sent — … already has this post"** and
  **"Skipped — … already has this post (nothing sent)"** respectively.
- `success: true` is kept for a genuine two-tab duplicate on purpose: the post *is* live, and failing
  it would make the second tab retry and defeat the lock.

#### Rescheduling a published post no longer strands it
- **`handleRescheduleManyContent`** wrote only the new time, leaving `status: "published"` — which
  `isAutoPublishable` rejects. The new slot could never fire, and the row kept displaying the old
  post's `publishedAt` / `externalPostId` as though that slot were already satisfied. The toast now
  reports how many posts were re-queued.

### Test counts
`125 → 131` JS tests across 7 files; `tsc --noEmit` clean.

### Known limitations
- The `lastDeduplicated` wiring inside the auto-publish tick is a component closure and is not
  unit-tested; it is verified only by inspecting the built bundle.
- `rescheduleRevivePatch` sets `publishedAt`/`externalPostId` to `undefined`, which `JSON.stringify`
  drops on the KV/local path, while the SQL `apiUpdateContent` path sends explicit `null`. The two
  stores therefore differ in shape for an affected item until it is next written.
- The publish lock is per-server filesystem state, so it does not dedupe across multiple hosts.

### `api/publish.php`
#### Facebook page-token exchange (fixes post automation end-to-end)
- **Graph rejects page writes made with a plain *user* token** — `POST /{pageId}/feed` returned
  `(#200) … requires both pages_read_engagement and pages_manage_posts … with page token` even
  though the configured token was valid and carried `pages_manage_posts`. `/me/accounts` was empty
  for that user, but a page token could still be minted for the page.
- **`facebook_page_token()`** exchanges the configured user token for a page token via
  `GET /{pageId}?fields=access_token`, memoised per request.
- **`facebook_feed()`** posts to `/{pageId}/feed` and, on Graph error `#200` (or `#10`/`#190`),
  transparently retries once with the page token. If the exchange fails it surfaces the original
  Graph error, so a genuinely misconfigured page still reports a useful message.
- **Graph API version moved off end-of-life `v19.0` to `v23.0`** for the Facebook and Instagram
  handlers, via a single `$GRAPH` constant. Override with the `CONTENTOS_FB_GRAPH_VERSION` env var.
- Verified live against the appstai.com page (`1665501390368935`): `{"success":true,
  "message":"Published to Facebook — Post 1665501390368935_…"}` through the app's own proxy
  endpoint. The Instagram handler now shares `$GRAPH` but is unverified — no IG credentials are
  configured yet.

### `src/utils/publish-queue.ts` (new)
Publish queue engine with explicit per-item outcomes:
- **`PublishState`** = `queued` → `publishing` → `success` / `failed` / `blocked` / `skipped`, with a
  full `attempts` history per row.
- **`buildQueue()`** merges a fresh view of due posts into the live queue without discarding results.
  Rows that already published, failed or are blocked are never rebuilt; a post that is no longer due
  drops out and one that comes back (e.g. rescheduled into the past) is re-added. This fixes the
  previous behaviour where the queue was reset on every re-render — and the stale-closure bug where a
  single auto-publish failure re-queued every scheduled post as brand new.
- **`runPublishQueue()`** publishes oldest-first, one row at a time, and never throws: a rejected
  publisher becomes a failed row and the run continues. Progress is streamed as
  `start / attempt / skip / circuit / progress / report` patches so the caller owns the state and
  results survive closing the panel.
- **Failure classification** — auth/config problems (`401`, `403`, invalid token, channel not
  connected) are marked `blocked` ("Needs setup") and are not retried; anything else is `failed` and
  can be retried up to `MAX_PUBLISH_ATTEMPTS` (3).
- **Circuit breaker** — 4 consecutive failures with no success in between skips the rest of the run
  instead of hammering a downed API.
- **Cancel** resolves whatever is already in flight (an upstream post must always flip its status or
  the next auto-publish tick publishes it twice) and only skips the not-yet-started rows.

### `src/App.tsx`
#### Publish queue / partial failures
- **`PublishQueuePanel` reworked**: per-row state badge, `attempt n/3`, per-row **Retry**,
  **Publish All Due**, **Retry N Failed**, a **Failed** tab, a dismissible run summary
  (`2 published · 1 failed`), a progress bar with **Cancel**, and **Clear finished**. Results now
  persist across re-renders and panel close/reopen.
- **`publishToConnectedPlatform(item, brands)`** takes the brand list instead of a pre-resolved
  channel + platform definition, and returns a "not connected" result instead of throwing, so one
  unconfigured channel can no longer abort a whole batch. Channel resolution is centralised in
  `canPublishItem()`.
- **Auto-publish failures** now dispatch a `contentos:auto-publish-failed` window event that the open
  queue listens to, so a background failure is recorded instead of being silently re-queued later.
- Removed the duplicated local `parseScheduledDate` / `dateKey` / `addDays` / `getWeekStart` helpers
  in favour of `src/utils/calendar-helpers.ts`, which the queue engine also uses.

### `src/utils/__tests__/publish-queue.test.ts` (new)
27 tests: queue building, retry rules, partial-failure runs (mixed success/failure/blocked, thrown
errors, auth vs rate-limit classification, attempt cap, cancel, circuit breaker), progress patches
and report summaries.

### `src/App.tsx`

#### Image generation reliability
- **Reordered image provider preference** so keyless / Turnstile-free providers run first:
  `Stable Horde → Hugging Face → fal.ai → Replicate → Pollinations (last resort)`.
  Pollinations is now only used when no other provider is configured, because it
  gates raw browser `<img>` requests behind a Cloudflare Turnstile check.
- **Added an HTTP `HEAD` probe** inside `generateImagePollinations()` so a Turnstile
  rejection surfaces as a clear, actionable error instead of a bare 403 or a silent
  broken-image pixel. The probe reads the response body and throws a message that
  tells the user to switch to Stable Horde or Hugging Face.
- **Hardened Hugging Face fetch** with a `try/catch` around the network call so a
  browser-level failure (e.g. Firefox `NetworkError when attempting to fetch
  resource`, or a cold-loading model) reports a useful message instead of a generic
  throw.
- **Added explicit Hugging Face auth failure handling**: HTTP `401`/`403` now reports
  "rejected the token" with the status code, and the cold-model `loading` case keeps
  its friendlier "≈20 seconds" retry hint.
- **Sent `x-wait-for-model: true`** on Hugging Face inference requests so a
  cold-loaded model is blocked server-side until ready rather than returning a
  transient error.
- **Default `black-forest-labs/FLUX.1-schnell`** model id preserved; model-id field is
  now explicitly marked optional in the UI.

#### Integration connection verification
- **Added `verifyProviderConnection()`** — hits each provider's real API with the saved
  credentials so the "Connected" indicator reflects an actually working connection,
  not just a filled form:
  - Groq → `GET /openai/v1/models`
  - Pollinations → `HEAD` probe of the image endpoint (detects the Turnstile 403 gate)
  - Hugging Face → `GET /api/whoami-v2`
  - Stable Horde → `GET /api/v2/users/{key}` (anonymous `0000000000` always valid)
  - fal.ai → key saved without a billable probe; verified on first generation
  - Replicate → `GET /v1/models`
- **Added a "Test connection" button** to `IntegrationConfigPanel` with a live
  `Testing…` state and an inline pass/fail result banner.
- **Save now authenticates before connecting**: clicking Connect runs the live probe,
  and the integration is only marked "Connected" if the probe succeeds; a bad key
  fails the probe, keeps the card unconnected, and opens the setup guide.

### `package-lock.json`
- **Synced lockfile** with `package.json` devDependencies: registers `vitest`,
  `jsdom`, `chai`, `@testing-library/*`, `@vitest/*`, and their transitive packages so
  `npm install` is reproducible and `npm test` resolves cleanly.

---

## [1.0.0] — Initial relational-DB release

Merged via PR #1 (`aman/localdb-to-mysql`).

- Migrated data layer from KV/Supabase-only to a PHP + MySQL relational backend
  (`roles`, `users`, `sessions`, `brands`, `brand_members`, `brand_tones`,
  `brand_pillars`, `brand_platforms`, `brand_channels`, `content_items`,
  `integrations`, `approval_policy`, `settings`).
- Added `api/*.php` endpoints (auth, brands, content, members, kv, publish,
  migrate) built on a shared `bootstrap.php` with token auth and brand-access scoping.
- Added `src/api.ts` typed client; keep `src/db.ts` KV helpers as the fallback path.
- All users/brands/content ship with documented local-setup flow (README §4–§5).