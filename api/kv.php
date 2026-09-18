<?php
// ContentOS local KV API — MySQL-backed drop-in replacement for
// the Supabase `make-server-*/kv/:key` Edge Function.
//
// Frontend contract (see src/db.ts):
//   GET    /kv/:key            -> 200 { "value": <json|null> } | 404 { "value": null }
//   POST   /kv/:key {value}    -> 200 { "ok": true }
//   DELETE /kv/:key            -> 200 { "ok": true }
//
// Apache rewrite (api/.htaccess) maps /api/kv/<key> to kv.php?key=<key>.
// Direct access also works: /api/kv.php?key=contentOS:users

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- Resolve key: ?key=, PATH_INFO, or /kv/<key> fallback ---
$key = isset($_GET['key']) ? (string) $_GET['key'] : '';
if ($key === '' && isset($_SERVER['PATH_INFO'])) {
    $key = ltrim((string) $_SERVER['PATH_INFO'], '/');
}
if ($key === '' && isset($_SERVER['REQUEST_URI'])) {
    $path = parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (preg_match('#/kv/(.+)$#', (string) $path, $m)) {
        $key = urldecode($m[1]);
    }
}
$key = trim($key);

if ($key === '' || strlen($key) > 255) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing or invalid key']);
    exit;
}

try {
    $cfg = require __DIR__ . '/config.php';
    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
        $cfg['host'],
        $cfg['port'],
        $cfg['name']
    );
    $pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB connection failed: ' . $e->getMessage()]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($method === 'GET') {
        $stmt = $pdo->prepare('SELECT `value` FROM `kv_store` WHERE `key` = ?');
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        if ($row === false) {
            http_response_code(404);
            echo json_encode(['value' => null]);
            exit;
        }
        // `value` column is JSON text — decode then re-encode so the
        // response shape matches Supabase: { "value": <original json> }.
        $decoded = json_decode($row['value'], true);
        echo json_encode(['value' => $decoded === null && strtolower(trim((string) $row['value'])) !== 'null' ? $row['value'] : $decoded]);
        exit;
    }

    if ($method === 'POST' || $method === 'PUT') {
        $raw = file_get_contents('php://input');
        $body = json_decode((string) $raw, true);
        if (!is_array($body) || !array_key_exists('value', $body)) {
            http_response_code(400);
            echo json_encode(['error' => 'Body must be JSON like { "value": ... }']);
            exit;
        }
        $valueJson = json_encode($body['value'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $stmt = $pdo->prepare(
            'INSERT INTO `kv_store` (`key`, `value`) VALUES (?, CAST(? AS JSON)) ' .
            'ON DUPLICATE KEY UPDATE `value` = CAST(VALUES(`value`) AS JSON)'
        );
        $stmt->execute([$key, $valueJson]);
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($method === 'DELETE') {
        $stmt = $pdo->prepare('DELETE FROM `kv_store` WHERE `key` = ?');
        $stmt->execute([$key]);
        echo json_encode(['ok' => true]);
        exit;
    }

    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
