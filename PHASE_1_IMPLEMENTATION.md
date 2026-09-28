# Phase 1: Production Hardening - Implementation Guide

**Status**: Files created, ready for manual integration and testing  
**Date**: 2026-09-22  
**Branch**: Local only (not committed)

---

## What Was Created

### 1. HTTP-Only Cookie Auth + Refresh Tokens ✅

**Files Created:**
- `api/auth_new.php` - New auth endpoint with refresh token rotation
- `api/bootstrap_new.php` - Updated bootstrap with logging, rate limiting, audit logs
- `api/migrations/001_add_is_refresh_to_sessions.sql` - Database migration
- `src/api_new.ts` - Frontend API client with in-memory token storage

**Changes:**
- Access tokens: 30 minutes (stored in memory)
- Refresh tokens: 7 days (HTTP-only cookie)
- Automatic token refresh before expiry
- `apiRefresh()` endpoint for seamless renewal
- `apiRevokeAllSessions()` for security incidents

**Migration Required:**
```bash
mysql -u root contentos < api/migrations/001_add_is_refresh_to_sessions.sql
```

---

### 2. Database Indexes ⚠️ (Migration needed)

**Create:** `api/migrations/002_add_performance_indexes.sql`

```sql
-- High-priority indexes for performance
ALTER TABLE `content_items`
  ADD INDEX `idx_content_brand_status_scheduled` (`brand_id`, `status`, `scheduled_at`),
  ADD INDEX `idx_content_created_by` (`created_by`);

ALTER TABLE `brand_members`
  ADD INDEX `idx_members_user_role` (`user_id`, `member_role`);

ALTER TABLE `brands`
  ADD INDEX `idx_brands_created_by` (`created_by`);

ALTER TABLE `sessions`
  ADD INDEX `idx_sessions_user_expires` (`user_id`, `expires_at`);

-- Analyze tables after adding indexes
ANALYZE TABLE `content_items`, `brand_members`, `brands`, `sessions`;
```

---

### 3. Structured Logging ✅

**File:** `api/logger.php`

**Features:**
- Logs to `storage/logs/contentos-YYYY-MM-DD.log`
- 8 log levels (DEBUG → EMERGENCY)
- JSON context support
- Auto-catches exceptions and PHP errors
- Request context logging (IP, method, URI, user agent)

**Usage:**
```php
require_once __DIR__ . '/logger.php';

log_info('User logged in', ['user_id' => $userId]);
log_error('Payment failed', ['order_id' => $orderId, 'error' => $e->getMessage()]);
log_debug('Query executed', ['sql' => $sql, 'time' => $time]);
```

---

### 4. Rate Limiting ✅

**File:** `api/ratelimit.php`

**Features:**
- Redis support (falls back to SQLite)
- Per-IP, per-user, per-endpoint limits
- Standard rate limit headers (X-RateLimit-*)
- HTTP 429 responses with Retry-After

**Usage:**
```php
require_once __DIR__ . '/ratelimit.php';

// At the top of auth.php
rate_limit_by_ip(10, 60); // 10 requests per 60 seconds per IP

// At the top of brands.php/content.php
$user = require_auth();
rate_limit_by_user($user['id'], 60, 60); // 60 requests per minute
```

**Default Limits (Recommended):**
- Auth endpoints: 10/min per IP
- Content/brand mutations: 30/min per user
- Image generation: 10/min per user
- Read-only endpoints: 100/min per user

---

### 5. Health Check Endpoint ✅

**File:** `api/health.php`

**Checks:**
- Database connection
- PHP version (8.1+ recommended)
- Memory limit
- Required extensions (GD, JSON)
- MySQL version

**Usage:**
```bash
curl http://localhost/ContentOS/api/health.php
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-09-22T07:27:58+00:00",
  "checks": {
    "database": { "status": "healthy", "message": "..." },
    "php": { "status": "healthy", "version": "8.3.0" },
    ...
  }
}
```

---

### 6. Audit Logging ✅

**Added to:** `api/bootstrap_new.php`

**Creates table:** `audit_logs`
```sql
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` VARCHAR(64) NOT NULL,
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(50) NOT NULL,
  `entity_id` BIGINT UNSIGNED NOT NULL,
  `details` JSON NOT NULL,
  `ip` VARCHAR(45) NOT NULL,
  `user_agent` VARCHAR(255) NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_audit_user` (`user_id`),
  INDEX `idx_audit_entity` (`entity_type`, `entity_id`),
  INDEX `idx_audit_created` (`created_at`)
);
```

**Usage:**
```php
audit_log($pdo, $user['id'], 'brand.created', 'brand', $brandId, [
  'name' => $brandName,
  'industry' => $industry,
]);

audit_log($pdo, $user['id'], 'content.published', 'content', $contentId, [
  'platform' => 'Instagram',
  'scheduled_at' => $scheduledAt,
]);
```

---

## Integration Steps

### Step 1: Run Database Migrations
```bash
cd "C:\Users\Mueed Anim\Desktop\ContentOS"
mysql -u root contentos < api/migrations/001_add_is_refresh_to_sessions.sql
mysql -u root contentos < api/migrations/002_add_performance_indexes.sql
```

### Step 2: Create Storage Directory
```bash
mkdir -p storage/logs
chmod 755 storage
```

### Step 3: Replace Backend Files (one at a time)
```bash
# Backup originals first
cp api/bootstrap.php api/bootstrap_OLD.php
cp api/auth.php api/auth_OLD.php

# Replace with new versions
cp api/bootstrap_new.php api/bootstrap.php
cp api/auth_new.php api/auth.php
```

### Step 4: Update All PHP Endpoints

Add rate limiting to **api/brands.php**:
```php
<?php
require __DIR__ . '/bootstrap.php';
cors();

$user = require_auth();
rate_limit_by_user($user['id'], 30, 60); // 30 requests/min

// ... rest of file
```

Add audit logging to mutations:
```php
// After creating a brand
audit_log($pdo, $user['id'], 'brand.created', 'brand', $brandId, [
  'name' => $data['name'],
]);

// After deleting content
audit_log($pdo, $user['id'], 'content.deleted', 'content', $contentId, []);
```

### Step 5: Replace Frontend API Client
```bash
cp src/api.ts src/api_OLD.ts
cp src/api_new.ts src/api.ts
```

### Step 6: Update App.tsx Auth Flow

Replace localStorage token with in-memory:
```typescript
import { getAccessToken, setAccessToken, clearAccessToken, needsTokenRefresh, apiRefresh } from '@/api';

// On login success
const { user, token } = await apiLogin(email, password);
setAccessToken(token); // Stores in memory, not localStorage
setUser(user);

// On mount - check for refresh
useEffect(() => {
  if (needsTokenRefresh()) {
    apiRefresh()
      .then(({ user, token }) => {
        setAccessToken(token);
        setUser(user);
      })
      .catch(() => {
        // Refresh failed, logout
        clearAccessToken();
        setUser(null);
      });
  }
}, []);

// Auto-refresh before expiry (every 5 minutes check)
useEffect(() => {
  const interval = setInterval(() => {
    if (needsTokenRefresh()) {
      apiRefresh()
        .then(({ user, token }) => {
          setAccessToken(token);
          setUser(user);
        })
        .catch(() => {
          clearAccessToken();
          setUser(null);
        });
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
  
  return () => clearInterval(interval);
}, []);
```

---

## Testing Checklist

### Auth Flow
- [ ] Login creates access token (30 min) + refresh cookie (7 days)
- [ ] Access token stored in memory only (not localStorage)
- [ ] Refresh endpoint rotates both tokens
- [ ] Auto-refresh works before 28-minute mark
- [ ] Logout clears both tokens
- [ ] Expired refresh returns 401 and forces re-login

### Rate Limiting
- [ ] Auth endpoint: 10 login attempts → HTTP 429
- [ ] Content mutations: 30 requests → HTTP 429
- [ ] Headers present: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Logging
- [ ] `storage/logs/contentos-2026-09-22.log` created
- [ ] Login events logged with IP/user agent
- [ ] Errors logged with stack traces
- [ ] No secrets (passwords, tokens) in logs

### Health Check
- [ ] `GET /api/health.php` returns 200
- [ ] All checks show "healthy"

### Audit Logging
- [ ] `audit_logs` table created
- [ ] Brand create/update/delete logged
- [ ] Content publish/delete logged
- [ ] User ID, IP, timestamp captured

### Performance
- [ ] Content list query < 100ms (check with `EXPLAIN`)
- [ ] Brand list < 50ms
- [ ] Session lookup < 10ms

---

## Rollback Plan

If something breaks:
```bash
# Restore originals
cp api/bootstrap_OLD.php api/bootstrap.php
cp api/auth_OLD.php api/auth.php
cp src/api_OLD.ts src/api.ts

# All users will need to re-login (sessions incompatible)
```

---

## Security Notes

1. **Cookie Security**: `contentos_refresh` cookie has:
   - `httponly`: true (no JavaScript access)
   - `secure`: true (HTTPS only in production)
   - `samesite`: Strict (CSRF protection)

2. **Token Rotation**: Every refresh invalidates old refresh token

3. **Rate Limits**: Protect against:
   - Brute force login attacks (10/min per IP)
   - API abuse (30-60/min per user)
   - DDoS via image generation (10/min per user)

4. **Audit Trail**: Every sensitive action logged with:
   - Who (user_id)
   - What (action, entity)
   - When (created_at)
   - Where (IP, user_agent)

---

## Next Steps (Phase 2 Preview)

After Phase 1 is tested and stable:
- Content templates
- Bulk operations (multi-select → delete/schedule)
- Approval workflow implementation
- Email notifications
- Content versioning

---

## Files Created Summary

```
api/
  auth_new.php              (New auth with refresh tokens)
  bootstrap_new.php         (Updated with logging, rate limits, audit)
  health.php                (Health check endpoint)
  logger.php                (Structured logging system)
  ratelimit.php             (Rate limiting with Redis/SQLite fallback)
  migrations/
    001_add_is_refresh_to_sessions.sql
    002_add_performance_indexes.sql (need to create this)

src/
  api_new.ts                (Frontend client with in-memory tokens)
```

**Total Lines Added**: ~1,500 LOC  
**Breaking Changes**: Yes (all users must re-login)  
**Database Changes**: 2 migrations  
**Risk Level**: Medium (test thoroughly before production)
