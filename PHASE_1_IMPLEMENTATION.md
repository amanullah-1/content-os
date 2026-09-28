# Phase 1: Production Hardening

**Status**: Integrated and committed — this describes the code as it exists on `revamped-contentos`
**Original date**: 2026-09-22

> The `_new` / `_OLD` staging files this document used to reference (`api/auth_new.php`,
> `api/bootstrap_new.php`, `src/api_new.ts`, `api/auth_OLD.php`, `src/api_OLD.ts`) were never
> committed. The integration they described was completed directly into the real files and the
> staging copies were deleted. The file names below are the ones that actually exist.

---

## 1. HTTP-Only Cookie Auth + Refresh Tokens

**Files:**
- `api/auth.php` — auth endpoint, refresh rotation, session revocation
- `src/api.ts` — frontend client, access token held in memory (never `localStorage`)

**Behaviour:**
- Access tokens: 30 minutes, in-memory only
- Refresh tokens: 7 days, HTTP-only cookie
- Automatic refresh before expiry via `needsTokenRefresh()` / `apiRefresh()`
- `apiRevokeAllSessions()` for security incidents
- Rotation: every refresh invalidates the previous refresh token

### Required migration

`sessions.is_refresh` is **not** part of `schema_relational.sql`, and `api/auth.php:110` inserts
into it. If you create the database from the schema files alone, login will fail on an unknown
column. Run this before first use:

```bash
mysql -u root contented < api/migrations/001_add_is_refresh_to_sessions.sql
```

---

## 2. Database Migrations

All four are committed and must be applied in order. There is no migration runner — these are
manual steps.

| # | File | Effect |
|---|---|---|
| 001 | `001_add_is_refresh_to_sessions.sql` | `sessions.is_refresh` + index. **Required**, see above. |
| 002 | `002_add_content_templates.sql` | `content_templates` table |
| 003 | `003_add_approval_state.sql` | approval columns on `content_items` |
| 004 | `004_add_publish_provenance.sql` | publish provenance columns on `content_items` |

### Not done: performance indexes

An earlier draft of this document specified a `002_add_performance_indexes.sql` adding indexes to
`content_items`, `brand_members`, `brands` and `sessions`. **That file was never created**, and the
number `002` is already taken by `002_add_content_templates.sql`. The index work remains undone; the
original SQL is preserved at the bottom of this document if you want to apply it under a new number
such as `005_add_performance_indexes.sql`.

---

## 3. Structured Logging

**File:** `api/logger.php`

- Logs to `storage/logs/contentos-YYYY-MM-DD.log`
- 8 log levels (DEBUG → EMERGENCY)
- JSON context support
- Auto-catches exceptions and PHP errors
- Request context (IP, method, URI, user agent)

```php
require_once __DIR__ . '/logger.php';

log_info('User logged in', ['user_id' => $userId]);
log_error('Payment failed', ['order_id' => $orderId, 'error' => $e->getMessage()]);
log_debug('Query executed', ['sql' => $sql, 'time' => $time]);
```

---

## 4. Rate Limiting

**File:** `api/ratelimit.php` — Redis with automatic SQLite fallback.

**Limits as actually applied:**

| Endpoint | Call | Limit |
|---|---|---|
| `api/auth.php:139` | `rate_limit_by_ip(20, 60 * 5)` | 20 per IP per 5 min |
| `api/brands.php:97` | `rate_limit_by_user($user['id'], 120, 60)` | 120/min per user |
| `api/content.php:84` | `rate_limit_by_user($user['id'], 130, 60)` | 130/min per user |
| `api/templates.php:57` | `rate_limit_by_user($user['id'], 130, 60)` | 130/min per user |

These are the real values, which are far looser than the limits originally proposed in this
document. Tightening them means editing the call sites above.

Emits `X-RateLimit-*` headers and returns HTTP 429 with `Retry-After`.

---

## 5. Health Check

**File:** `api/health.php` — checks database, PHP version, memory limit, extensions (GD, JSON) and
MySQL version.

```bash
curl http://localhost/ContentOS/api/health.php
```

```json
{
  "status": "healthy",
  "timestamp": "2026-09-22T07:27:58+00:00",
  "checks": {
    "database": { "status": "healthy", "message": "..." },
    "php": { "status": "healthy", "version": "8.3.0" }
  }
}
```

---

## 6. Audit Logging

**Defined in:** `api/bootstrap.php` — `audit_log($pdo, $userId, $action, $entityType, $entityId, $details)`

The `audit_logs` table is **created lazily and idempotently on first write** by
`api/bootstrap.php:275`, so no migration is needed for it.

Wired into 9 mutation sites across `brands.php`, `content.php` and `templates.php`:

```php
audit_log($pdo, $user['id'], 'brand.created', 'brand', $brandId, [
  'name' => $data['name'],
  'industry' => $industry,
]);
```

Covered actions: `brand.created/updated/deleted`, `content.created/updated/deleted`,
`templates.created/updated/deleted`.

---

## Setup for a fresh clone

```bash
git clone -b revamped-contentos <repo-url>
cd ContentOS

# 1. Database
mysql -u root contented < api/schema.sql
mysql -u root contented < api/schema_relational.sql

# 2. Migrations, in order. 001 is mandatory - see section 1.
mysql -u root contented < api/migrations/001_add_is_refresh_to_sessions.sql
mysql -u root contented < api/migrations/002_add_content_templates.sql
mysql -u root contented < api/migrations/003_add_approval_state.sql
mysql -u root contented < api/migrations/004_add_publish_provenance.sql

# 3. Writable storage for logs
mkdir -p storage/logs

# 4. Frontend
npm install
npm run build
```

`storage/` is not currently listed in `.gitignore`. `storage/logs` is empty and untracked, but
add it to `.gitignore` so log files cannot be committed by accident.

---

## Testing Checklist

### Auth
- [ ] Login creates access token (30 min) + refresh cookie (7 days)
- [ ] Access token held in memory only, absent from `localStorage`
- [ ] Refresh rotates both tokens
- [ ] Auto-refresh fires before the 28-minute mark
- [ ] Logout clears both tokens
- [ ] Expired refresh returns 401 and forces re-login
- [ ] Fresh database rejects login until migration 001 is applied

### Rate limiting
- [ ] 21st auth request in 5 min → HTTP 429
- [ ] Brand/content mutation ceiling → HTTP 429
- [ ] `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` present

### Logging
- [ ] `storage/logs/contentos-YYYY-MM-DD.log` created
- [ ] Login events logged with IP and user agent
- [ ] Errors logged with stack traces
- [ ] No passwords or tokens in logs

### Health
- [ ] `GET /api/health.php` returns 200
- [ ] All checks report healthy

### Audit
- [ ] `audit_logs` table auto-created on first write
- [ ] Brand and content create/update/delete logged
- [ ] user_id, IP, timestamp captured

---

## Security Notes

1. **Cookie**: `contentos_refresh` is `httponly`, `secure` in production, `samesite=Strict`
2. **Token rotation**: every refresh invalidates the previous refresh token
3. **Rate limits**: protect against brute force (20 per IP per 5 min) and API abuse
4. **Audit trail**: who, what, when and where (IP + user agent) for every mutation

---

## Shipped since Phase 1

The Phase 2 preview in the original document listed these as upcoming. All have since shipped:

- Content templates → `api/templates.php`, `api/migrations/002_add_content_templates.sql`
- Bulk operations → `src/utils/content-ops.ts` (`patchItem`, `patchItems`, `scheduleStampFor`)
- Approval workflow → `api/migrations/003_add_approval_state.sql`, `isAutoPublishable()` in
  `src/utils/calendar-helpers.ts`
- Publish provenance → `api/migrations/004_add_publish_provenance.sql`

Still not started: email notifications, content versioning.

---

## Appended: original performance-index SQL (never applied)

```sql
ALTER TABLE `content_items`
  ADD INDEX `idx_content_brand_status_scheduled` (`brand_id`, `status`, `scheduled_at`),
  ADD INDEX `idx_content_created_by` (`created_by`);

ALTER TABLE `brand_members`
  ADD INDEX `idx_members_user_role` (`user_id`, `member_role`);

ALTER TABLE `brands`
  ADD INDEX `idx_brands_created_by` (`created_by`);

ALTER TABLE `sessions`
  ADD INDEX `idx_sessions_user_expires` (`user_id`, `expires_at`);

ANALYZE TABLE `content_items`, `brand_members`, `brands`, `sessions`;
```

Note these reference `content_items`, which the current build may no longer use — see the
`contentos.kv_store` note in the README. Verify with `EXPLAIN` before applying.
