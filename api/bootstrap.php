<?php
// ContentOS API bootstrap — shared by auth.php, brands.php, content.php,
// members.php. Provides: CORS, PDO, JSON I/O, token auth, access scoping.
//
// Access rule (enforced here):
//   roles.sees_all = 1  -> super admin: all brands + all content.
//   otherwise           -> only brands in brand_members for that user;
//                          content inherits access via content_items.brand_id.

function cors(): void
{
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Content-Type: application/json; charset=utf-8');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

/** @return never */
function respond($data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** @return never */
function fail(string $message, int $status = 500): void
{
    respond(['success' => false, 'message' => $message], $status);
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    $cfg = require __DIR__ . '/config.php';
    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
        $cfg['host'],
        $cfg['port'],
        $cfg['name']
    );
    try {
        $pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    } catch (Throwable $e) {
        fail('DB connection failed: ' . $e->getMessage());
    }
    return $pdo;
}

/** Decoded JSON body (empty array when none/invalid). */
function body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode((string) $raw, true);
    return is_array($data) ? $data : [];
}

/** Bearer token from the Authorization header, or ''. */
function bearer_token(): string
{
    // NOTE: under Apache the header is NOT in $_SERVER (no CGI pass set),
    // so fall back to getallheaders()/apache_request_headers().
    $candidates = [
        $_SERVER['HTTP_AUTHORIZATION'] ?? '',
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '',
    ];
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    foreach ($headers as $name => $value) {
        if (strtolower((string) $name) === 'authorization') $candidates[] = (string) $value;
    }
    foreach ($candidates as $h) {
        if (stripos((string) $h, 'Bearer ') === 0) return trim(substr((string) $h, 7));
    }
    return '';
}

/**
 * Authenticated user row (+role) or null. Expired sessions are purged lazily.
 * @return array{id:string,email:string,name:string,avatar_color:string,role:string,sees_all:int,created_at:string}|null
 */
function auth_user(): ?array
{
    $token = bearer_token();
    if ($token === '') return null;
    $pdo = db();
    $pdo->prepare('DELETE FROM `sessions` WHERE `expires_at` < NOW()')->execute();
    $stmt = $pdo->prepare(
        'SELECT u.`id`, u.`email`, u.`name`, u.`avatar_color`, r.`slug` AS `role`,
                r.`sees_all`, u.`created_at`
         FROM `sessions` s
         JOIN `users` u ON u.`id` = s.`user_id`
         JOIN `roles` r ON r.`id` = u.`role_id`
         WHERE s.`token_hash` = ? AND s.`expires_at` >= NOW()'
    );
    $stmt->execute([hash('sha256', $token)]);
    $row = $stmt->fetch();
    if ($row === false) return null;
    $row['sees_all'] = (int) $row['sees_all'];
    return $row;
}

/** @return array the authenticated user or exits 401. */
function require_auth(): array
{
    $user = auth_user();
    if ($user === null) fail('Not authenticated.', 401);
    return $user;
}

/** @return never unless the user is a super admin (403 otherwise). */
function require_super_admin(array $user): void
{
    if (empty($user['sees_all'])) fail('Super admin only.', 403);
}

/**
 * Brand ids visible to the user. null = unrestricted (super admin).
 * @return int[]|null
 */
function visible_brand_ids(array $user): ?array
{
    if (!empty($user['sees_all'])) return null;
    $stmt = db()->prepare('SELECT `brand_id` FROM `brand_members` WHERE `user_id` = ?');
    $stmt->execute([$user['id']]);
    return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

function can_access_brand(array $user, int $brandId): bool
{
    if (!empty($user['sees_all'])) return true;
    $stmt = db()->prepare(
        'SELECT 1 FROM `brand_members` WHERE `brand_id` = ? AND `user_id` = ?'
    );
    $stmt->execute([$brandId, $user['id']]);
    return $stmt->fetchColumn() !== false;
}

/** Owner-level (or super admin): required for brand deletion. */
function is_brand_owner(array $user, int $brandId): bool
{
    if (!empty($user['sees_all'])) return true;
    $stmt = db()->prepare(
        "SELECT 1 FROM `brand_members`
         WHERE `brand_id` = ? AND `user_id` = ? AND `member_role` = 'owner'"
    );
    $stmt->execute([$brandId, $user['id']]);
    return $stmt->fetchColumn() !== false;
}

// --- Password hashing -------------------------------------------------------
// Stored formats (oldest -> newest):
//   ''                       Google-only account, no password login.
//   <short hex>              legacy JS FNV-1a simpleHash(password + userId).
//   <64 hex chars>           PBKDF2-SHA256(password, salt 'contentos-'+userId,
//                            100000 iterations) — matches the browser hasher.
//   $2y$... / $argon...      modern bcrypt/argon2 via password_hash().
// On any successful legacy login the hash is upgraded to password_hash().

function fnv1a_hex(string $s): string
{
    // Match the browser simpleHash() over UTF-16 code units.
    $utf16 = mb_convert_encoding($s, 'UTF-16LE', 'UTF-8');
    $h = 0x811c9dc5;
    $len = strlen($utf16);
    for ($i = 0; $i < $len; $i += 2) {
        $code = ord($utf16[$i]) | (ord($utf16[$i + 1]) << 8);
        $h ^= $code;
        $h = ($h * 0x01000193) & 0xFFFFFFFF;
    }
    return dechex($h);
}

function verify_password(string $password, string $userId, string $stored): bool
{
    if ($stored === '') return false;
    if (str_starts_with($stored, '$2y$') || str_starts_with($stored, '$argon')) {
        return password_verify($password, $stored);
    }
    if (strlen($stored) === 64 && ctype_xdigit($stored)) {
        $calc = hash_pbkdf2('sha256', $password, 'contentos-' . $userId, 100000);
        return hash_equals($stored, $calc);
    }
    return hash_equals($stored, fnv1a_hex($password . $userId));
}

function needs_rehash(string $stored): bool
{
    return !str_starts_with($stored, '$2y$') && !str_starts_with($stored, '$argon');
}

/** Session token lifetime: 30 days. */
function issue_token(PDO $pdo, string $userId): string
{
    $token = bin2hex(random_bytes(32));
    $stmt = $pdo->prepare(
        'INSERT INTO `sessions` (`token_hash`, `user_id`, `expires_at`)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))'
    );
    $stmt->execute([hash('sha256', $token), $userId]);
    return $token;
}

/** Public user shape returned to the frontend (never includes pw_hash). */
function public_user(array $row, array $brandIds = []): array
{
    return [
        'id' => $row['id'],
        'email' => $row['email'],
        'name' => $row['name'],
        'avatarColor' => $row['avatar_color'],
        'role' => role_label($row['role'] ?? ''),
        'roleSlug' => $row['role'] ?? '',
        'seesAll' => !empty($row['sees_all']),
        'brandIds' => $brandIds,
        'createdAt' => $row['created_at'],
    ];
}

function role_label(string $slug): string
{
    static $map = [
        'super_admin' => 'Super Admin', 'admin' => 'Admin',
        'brand_manager' => 'Brand Manager', 'content_manager' => 'Content Manager',
        'editor' => 'Editor', 'business' => 'Business',
        'client' => 'Client', 'viewer' => 'Viewer',
    ];
    return $map[$slug] ?? ucfirst(str_replace('_', ' ', $slug));
}

function role_id(PDO $pdo, string $slug): ?int
{
    $stmt = $pdo->prepare('SELECT `id` FROM `roles` WHERE `slug` = ?');
    $stmt->execute([$slug]);
    $id = $stmt->fetchColumn();
    return $id === false ? null : (int) $id;
}
