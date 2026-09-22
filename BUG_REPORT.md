# Bug Report

Status of issues identified and resolved against **ContentOS** `main`.

Legend:
- **Fixed** — resolved in this branch, pending review/merge.
- **Open** — reproducible, still needs a fix.

---

## Resolved

### BUG-01 — Image generation silently fails when Pollinations blocks browser requests
- **Severity:** High (image thumbnails never render)
- **Status:** Fixed
- **Affected area:** `src/App.tsx` → `generateImagePollinations()`
- **Symptom:** Pollinations gates raw browser `<img>` requests behind a Cloudflare
  Turnstile check. A plain image load can't send a Turnstile token, so generation
  either came back as HTTP 403 or a silent broken image with no explanation.
- **Root cause:** The app trusted Pollinations as the default image provider and had
  no way to detect the bot-gate before or after the request.
- **Fix:** Added a `HEAD` probe before the image is loaded; a 403 response whose body
  mentions Turnstile throws an actionable error advising the user to switch to
  Stable Horde or Hugging Face. Providers are also now tried in
  keyless/Turnstile-free-first order (Stable Horde → Hugging Face → fal.ai →
  Replicate → Pollinations), so Pollinations is only a last resort.

### BUG-02 — Hugging Face generation throws an opaque error when the browser can't reach the host
- **Severity:** Medium (confusing dead end for users on Firefox)
- **Status:** Fixed
- **Affected area:** `src/App.tsx` → `generateImageHuggingFace()`
- **Symptom:** Firefox reports `NetworkError when attempting to fetch resource` and
  the app says image generation "failed" with no usable guidance. Cold-starting
  models also produced a terse raw error.
- **Root cause:** The `fetch()` promise rejection was unhandled and generic provider
  errors were surfaced verbatim; free inference hosts commonly reject browser
  requests or take time to cold-load a model.
- **Fix:** Wrapped the fetch in `try/catch` and rethrew a clear message covering
  network-level blocking and cold models; added explicit HTTP 401/403 "token
  rejected" handling; sent `x-wait-for-model: true` so cold models block server-side
  until ready instead of erroring mid-flight.

### BUG-03 — "Connected" indicator showed for integrations with invalid/wrong credentials
- **Severity:** Medium (misleading status, silent generation failures later)
- **Status:** Fixed
- **Affected area:** `src/App.tsx` → `IntegrationConfigPanel`, `verifyProviderConnection()`
- **Symptom:** An integration was marked "Connected" the moment its field was filled,
  even with a bad API key/token, so the first real image call would fail later.
- **Root cause:** `handleSave` only checked that fields were non-empty.
- **Fix:** Saving now runs a live connection probe (`verifyProviderConnection()`) against
  the provider's real API. The integration is only marked "Connected" when the probe
  succeeds; failures keep the card unconnected and reopen the setup guide. A new
  "Test connection" button gives users an explicit, non-destructive way to check
  credentials first.

### BUG-04 — `npm install` / `npm test` not reproducible (lockfile out of sync)
- **Severity:** Low (developer ergonomics)
- **Status:** Fixed
- **Affected area:** `package-lock.json`
- **Symptom:** `package.json` declared `vitest`, `jsdom`, `@testing-library/*`, etc.,
  but `package-lock.json` did not contain them, so `npm ci` failed and `npm test`
  could not resolve.
- **Root cause:** Lockfile (`package-lock.json`) drifted from `package.json`
  `devDependencies` (the repo also carries a `pnpm-lock.yaml`).
- **Fix:** Regenerated/synced `package-lock.json` so all declared dev dependencies and
  their transitive packages are locked and installable.

---

## Open / Investigate

- **No open issues recorded.** (GitHub repo shows 0 open issues.)

---

## Reproduction checks performed

- `git diff` of `src/App.tsx` reviewed top-to-bottom; all branches in
  `verifyProviderConnection()` hit documented, read-only provider endpoints.
- Provider order confirmed in `handleGenerateImage` (lines ~1617–1621).
- No `.env*` secrets or keys are introduced by this change (all credentials remain
  user-supplied at runtime).