<?php
// ContentOS auth API — server-side identity for the relational model.
//
// POST api/auth.php?action=login          { email, password }
// POST api/auth.php?action=signup         { name, email, password }
// POST api/auth.php?action=google         { credential }  (Google ID token; sub/email/name used as today)
// POST api/auth.php?action=logout         (Bearer token)
// GET  api/auth.php?action=me             (Bearer token)
// POST api/auth.php?action=change-password { current, next }  (Bearer token)
// POST api/auth.php?action=update-profile  { name?, avatarColor?, role? }  (Bearer token; role = super admin only)
//
// Success shape: { success: true, user: {...}, token: "..." }
// The frontend stores the token and sends it as `Authorization: Bearer`.

require __DIR__ . '/bootstrap.php';
cors();

const AVATAR_COLORS = ['#6366f1','#7c3aed','#0ea5e9','#10b981','#f97316','#ec4899','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

/** Ensure the master admin exists on fresh installs (mirrors the old browser seed). */
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

/** Decode a Google ID token payload WITHOUT signature verification (same trust level as the previous client-side flow). */
function decode_google_credential(string $credential): ?array
{
    $parts = explode('.', $credential);
    if (count($parts) !== 3) return null;
    $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true);
    if (!is_array($payload) || empty($payload['email'])) return null;
    return $payload;
}

try {
    $pdo = db();
    seed_master($pdo);
    $action = $_GET['action'] ?? body()['action'] ?? '';
    $in = body();

    // --- login ---
    if ($action === 'login') {
        $email = trim((string) ($in['email'] ?? ''));
        $password = (string) ($in['password'] ?? '');
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
        respond(['success' => true, 'user' => public_user($row, memberships($pdo, $found['id'])), 'token' => issue_token($pdo, $found['id'])]);
    }

    // --- signup (client-level by default; first user ever becomes super admin) ---
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
        respond(['success' => true, 'user' => public_user($row, []), 'token' => issue_token($pdo, $id)]);
    }

    // --- google sign-in (link-or-create, then token) ---
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
        respond(['success' => true, 'user' => public_user($row, memberships($pdo, $found['id'])), 'token' => issue_token($pdo, $found['id'])]);
    }

    // --- everything below requires auth ---
    $user = require_auth();

    if ($action === 'logout') {
        $pdo->prepare('DELETE FROM `sessions` WHERE `token_hash` = ?')
            ->execute([hash('sha256', bearer_token())]);
        respond(['success' => true]);
    }

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
        respond(['success' => true]);
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
