<?php
// ContentOS auth API — HTTP-only cookie session + refresh token rotation.
//
// POST api/auth.php?action=login          { email, password, remember?: bool }
// POST api/auth.php?action=signup         { name, email, password }
// POST api/auth.php?action=google         { credential }  (Google ID token)
// POST api/auth.php?action=refresh        (refresh token from cookie)
// POST api/auth.php?action=logout         (access token in body, refresh in cookie)
// POST api/auth.php?action=revoke-all     (invalidate all user sessions)
// GET  api/auth.php?action=me             (access token from cookie or header)
// POST api/auth.php?action=change-password { current, next }
// POST api/auth.php?action=update-profile  { name?, avatarColor?, role? }
//
// Flow:
//   1. Login/signup returns short-lived access token (30 min) in response body
//   2. Browser receives HTTP-only cookie: `contentos_refresh=...` (7 days)
//   3. Frontend stores access token in memory; adds to each request header
//   4. When access token expires, frontend calls /refresh (refresh cookie auto-sent)
//   5. Refresh rotates tokens (old refresh invalidated, new issued)

require __DIR__ . '/bootstrap.php';
cors();

const ACCESS_LIFETIME = 30 * 60;  // 30 minutes
const REFRESH_LIFETIME = 7 * 24 * 60 * 60;  // 7 days
const AVATAR_COLORS = ['#6366f1','#7c3aed','#0ea5e9','#10b981','#f97316','#ec4899','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

// --- Helper functions (also used by bootstrap.php for public_user, role_id) ---

function seed_master(PDO $pdo): void
{
    $count = (int) $pdo->query('SELECT COUNT(*) FROM `users`')->fetchColumn();
    if ($count > 0) return;
    $email = getenv('CONTENTOS_MASTER_EMAIL') ?: 'admin@contentos.app';
    $password = getenv('CONTENTOS_MASTER_PASSWORD') ?: 'ChangeMe123!';
    $roleId = role_id($pdo, 'super_admin');
    $stmt = $pdo->prepare(
        'INSERT INTO `users` (`id`, `email`, `name`, `avatar_color`, `role_id`, `pw_hash`)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        'master_admin_001', $email, 'Super Admin', '#4f46e5', $roleId,
        password_hash($password, PASSWORD_DEFAULT),
    ]);
}

function user_row(PDO $pdo, string $userId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT u.`id`, u.`email`, u.`name`, u.`avatar_color`, r.`slug` AS `role`,
                r.`sees_all`, u.`created_at`
         FROM `users` u JOIN `roles` r ON r.`id` = u.`role_id`
         WHERE u.`id` = ?'
    );
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if ($row === false) return null;
    $row['sees_all'] = (int) $row['sees_all'];
    return $row;
}

function memberships(PDO $pdo, string $userId): array
{
    $stmt = $pdo->prepare('SELECT `brand_id` FROM `brand_members` WHERE `user_id` = ?');
    $stmt->execute([$userId]);
    return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

/** Set HTTP-only refresh token cookie (host-only, no Domain attr). */
function set_refresh_cookie(string $token, int $lifetime = REFRESH_LIFETIME): void
{
    $options = [
        'expires' => time() + $lifetime,
        'path' => '/',
        'secure' => isset($_SERVER['HTTPS']),
        'httponly' => true,
        'samesite' => 'Strict',
    ];
    setcookie('contentos_refresh', $token, $options);
}

/** Clear refresh token cookie. */
function clear_refresh_cookie(): void
{
    setcookie('contentos_refresh', '', [
        'expires' => time() - 3600,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

/** Decode Google ID token payload (same trust level as original flow). */
function decode_google_credential(string $credential): ?array
{
    $parts = explode('.', $credential);
    if (count($parts) !== 3) return null;
    $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true);
    if (!is_array($payload) || empty($payload['email'])) return null;
    return $payload;
}

/** Create session and return access token + refresh token pair. */
function create_session(PDO $pdo, string $userId, bool $remember = false): array
{
    $access = bin2hex(random_bytes(32));
    $refresh = bin2hex(random_bytes(32));
    
    $accessStmt = $pdo->prepare(
        'INSERT INTO `sessions` (`token_hash`, `user_id`, `expires_at`, `is_refresh`)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), 0)'
    );
    $accessStmt->execute([
        hash('sha256', $access),
        $userId,
        ACCESS_LIFETIME,
    ]);
    
    $refreshStmt = $pdo->prepare(
        'INSERT INTO `sessions` (`token_hash`, `user_id`, `expires_at`, `is_refresh`)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), 1)'
    );
    $refreshStmt->execute([
        hash('sha256', $refresh),
        $userId,
        REFRESH_LIFETIME,
    ]);
    
    return ['access' => $access, 'refresh' => $refresh];
}

try {
    $pdo = db();
    seed_master($pdo);
    $action = $_GET['action'] ?? body()['action'] ?? '';
    $in = body();

    // Auth endpoints: tight rate limit per IP to stall brute-force attempts.
    rate_limit_by_ip(20, 60 * 5);

    if ($action === 'login') {
        $email = trim((string) ($in['email'] ?? ''));
        $password = (string) ($in['password'] ?? '');
        $remember = !empty($in['remember']);
        
        $stmt = $pdo->prepare('SELECT * FROM `users` WHERE `email` = ?');
        $stmt->execute([$email]);
        $found = $stmt->fetch();
        
        if ($found === false) fail('No account found with that email.', 200);
        if (!verify_password($password, $found['id'], (string) $found['pw_hash'])) {
            fail('Incorrect password.', 200);
        }
        if (needs_rehash((string) $found['pw_hash'])) {
            $pdo->prepare('UPDATE `users` SET `pw_hash` = ? WHERE `id` = ?')
                ->execute([password_hash($password, PASSWORD_DEFAULT), $found['id']]);
        }
        
        $row = user_row($pdo, $found['id']);
        $tokens = create_session($pdo, $found['id'], $remember);
        
        set_refresh_cookie($tokens['refresh']);
        
        respond([
            'success' => true,
            'user' => public_user($row, memberships($pdo, $found['id'])),
            'token' => $tokens['access'],
        ]);
    }

    if ($action === 'signup') {
        $name = trim((string) ($in['name'] ?? ''));
        $email = trim((string) ($in['email'] ?? ''));
        $password = (string) ($in['password'] ?? '');
        
        if ($name === '' || $email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            fail('Name and a valid email are required.', 200);
        }
        if (strlen($password) < 8) fail('Password must be at least 8 characters.', 200);
        
        $exists = $pdo->prepare('SELECT 1 FROM `users` WHERE `email` = ?');
        $exists->execute([$email]);
        if ($exists->fetchColumn() !== false) fail('An account with that email already exists.', 200);
        
        $isFirst = ((int) $pdo->query('SELECT COUNT(*) FROM `users`')->fetchColumn()) === 0;
        $slug = $isFirst ? 'super_admin' : 'business';
        $id = bin2hex(random_bytes(16));
        $count = (int) $pdo->query('SELECT COUNT(*) FROM `users`')->fetchColumn();
        
        $pdo->prepare(
            'INSERT INTO `users` (`id`, `email`, `name`, `avatar_color`, `role_id`, `pw_hash`)
             VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([
            $id, $email, $name, AVATAR_COLORS[$count % count(AVATAR_COLORS)],
            role_id($pdo, $slug), password_hash($password, PASSWORD_DEFAULT),
        ]);
        
        $row = user_row($pdo, $id);
        $tokens = create_session($pdo, $id, false);
        
        set_refresh_cookie($tokens['refresh']);
        
        respond([
            'success' => true,
            'user' => public_user($row, []),
            'token' => $tokens['access'],
        ]);
    }

    if ($action === 'google') {
        $payload = decode_google_credential((string) ($in['credential'] ?? ''));
        if ($payload === null) fail('Google sign-in failed. Please try again.', 200);
        
        $email = strtolower(trim((string) $payload['email']));
        $stmt = $pdo->prepare('SELECT * FROM `users` WHERE `email` = ?');
        $stmt->execute([$email]);
        $found = $stmt->fetch();
        
        if ($found === false) {
            $id = 'google_' . preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($payload['sub'] ?? bin2hex(random_bytes(8))));
            $count = (int) $pdo->query('SELECT COUNT(*) FROM `users`')->fetchColumn();
            $pdo->prepare(
                'INSERT INTO `users` (`id`, `email`, `name`, `avatar_color`, `role_id`, `pw_hash`)
                 VALUES (?, ?, ?, ?, ?, ?)'
            )->execute([
                $id, $email, (string) ($payload['name'] ?? $email),
                AVATAR_COLORS[$count % count(AVATAR_COLORS)], role_id($pdo, 'business'), '',
            ]);
            $found = ['id' => $id];
        }
        
        $row = user_row($pdo, $found['id']);
        $tokens = create_session($pdo, $found['id'], false);
        
        set_refresh_cookie($tokens['refresh']);
        
        respond([
            'success' => true,
            'user' => public_user($row, memberships($pdo, $found['id'])),
            'token' => $tokens['access'],
        ]);
    }

    if ($action === 'refresh') {
        $refreshToken = $_COOKIE['contentos_refresh'] ?? '';
        if ($refreshToken === '') fail('No refresh token found.', 401);
        
        $stmt = $pdo->prepare(
            'SELECT s.`user_id` FROM `sessions` s
             WHERE s.`token_hash` = ?
               AND s.`expires_at` >= NOW()
               AND s.`is_refresh` = 1
             ORDER BY s.`expires_at` DESC
             LIMIT 1'
        );
        $stmt->execute([hash('sha256', $refreshToken)]);
        $row = $stmt->fetch();
        
        if ($row === false) {
            clear_refresh_cookie();
            fail('Refresh token invalid or expired.', 401);
        }
        
        // Rotate tokens
        $stmt = $pdo->prepare('DELETE FROM `sessions` WHERE `user_id` = ?');
        $stmt->execute([$row['user_id']]);
        
        $tokens = create_session($pdo, $row['user_id'], false);
        set_refresh_cookie($tokens['refresh']);
        
        $user = user_row($pdo, $row['user_id']);
        $memberships = memberships($pdo, $row['user_id']);
        
        respond([
            'success' => true,
            'user' => public_user($user, $memberships),
            'token' => $tokens['access'],
        ]);
    }

    if ($action === 'logout') {
        $user = require_auth();
        
        // Invalidate current access token
        $pdo->prepare('DELETE FROM `sessions` WHERE `token_hash` = ?')
            ->execute([hash('sha256', bearer_token())]);
        
        clear_refresh_cookie();
        
        respond(['success' => true]);
    }

    if ($action === 'revoke-all') {
        $user = require_auth();
        
        // Invalidate all user sessions
        $pdo->prepare('DELETE FROM `sessions` WHERE `user_id` = ?')
            ->execute([$user['id']]);
        
        clear_refresh_cookie();
        
        respond(['success' => true, 'message' => 'All sessions revoked. Please log in again.']);
    }

    $user = require_auth();

    if ($action === 'me') {
        $row = user_row($pdo, $user['id']);
        respond(['success' => true, 'user' => public_user($row, memberships($pdo, $user['id']))]);
    }

    if ($action === 'change-password') {
        $current = (string) ($in['current'] ?? '');
        $next = (string) ($in['next'] ?? '');
        
        $stmt = $pdo->prepare('SELECT `pw_hash` FROM `users` WHERE `id` = ?');
        $stmt->execute([$user['id']]);
        $stored = (string) $stmt->fetchColumn();
        
        if (!verify_password($current, $user['id'], $stored)) {
            fail('Current password is incorrect.', 200);
        }
        if (strlen($next) < 8) fail('New password must be at least 8 characters.', 200);
        
        $pdo->prepare('UPDATE `users` SET `pw_hash` = ? WHERE `id` = ?')
            ->execute([password_hash($next, PASSWORD_DEFAULT), $user['id']]);
        
        // Invalidate all sessions for security
        $pdo->prepare('DELETE FROM `sessions` WHERE `user_id` = ?')
            ->execute([$user['id']]);
        
        respond(['success' => true, 'message' => 'Password changed. Please log in again.']);
    }

    if ($action === 'update-profile') {
        $sets = [];
        $params = [];
        
        if (isset($in['name']) && trim((string) $in['name']) !== '') {
            $sets[] = '`name` = ?';
            $params[] = trim((string) $in['name']);
        }
        if (isset($in['avatarColor'])) {
            $sets[] = '`avatar_color` = ?';
            $params[] = (string) $in['avatarColor'];
        }
        if (isset($in['role'])) {
            if (empty($user['sees_all'])) fail('Only a super admin can change roles.', 403);
            $slug = strtolower(str_replace(' ', '_', trim((string) $in['role'])));
            $rid = role_id($pdo, $slug);
            if ($rid === null) fail('Unknown role.', 200);
            $sets[] = '`role_id` = ?';
            $params[] = $rid;
        }
        
        if ($sets === []) fail('Nothing to update.', 200);
        
        $params[] = $user['id'];
        $pdo->prepare('UPDATE `users` SET ' . implode(', ', $sets) . ' WHERE `id` = ?')
            ->execute($params);
        
        $row = user_row($pdo, $user['id']);
        respond(['success' => true, 'user' => public_user($row, memberships($pdo, $user['id']))]);
    }

    fail('Unknown action.', 404);
} catch (Throwable $e) {
    fail($e->getMessage());
}
