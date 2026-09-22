# Changelog

All notable changes to **ContentOS** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to commit history located in `git log`.

---

## [Unreleased]

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