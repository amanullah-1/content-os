<?php
// ContentOS health check endpoint
// GET /api/health.php
// Returns system status for uptime monitoring

header('Content-Type: application/json');
http_response_code(200);

$checks = [];

// Database check
try {
    require __DIR__ . '/bootstrap.php';
    $pdo = db();
    $stmt = $pdo->query('SELECT 1');
    $checks['database'] = [
        'status' => 'healthy',
        'message' => 'Database connection OK',
        'timestamp' => date('c'),
    ];
} catch (Throwable $e) {
    http_response_code(503);
    $checks['database'] = [
        'status' => 'unhealthy',
        'message' => 'Database connection failed: ' . $e->getMessage(),
        'timestamp' => date('c'),
    ];
}

// PHP version check
$checks['php'] = [
    'status' => version_compare(PHP_VERSION, '8.1.0', '>=') ? 'healthy' : 'warning',
    'version' => PHP_VERSION,
    'message' => version_compare(PHP_VERSION, '8.1.0', '>=') 
        ? 'PHP version OK (8.1+)' 
        : 'PHP version below recommended 8.1.0',
];

// Memory limit check
$checks['memory'] = [
    'status' => (int) ini_get('memory_limit') > 128 * 1024 * 1024 ? 'healthy' : 'warning',
    'limit' => ini_get('memory_limit'),
    'message' => (int) ini_get('memory_limit') > 128 * 1024 * 1024 
        ? 'Memory limit OK' 
        : 'Memory limit below 128MB',
];

// GD extension check (for image generation)
$checks['gd'] = [
    'status' => extension_loaded('gd') ? 'healthy' : 'warning',
    'loaded' => extension_loaded('gd'),
    'message' => extension_loaded('gd') ? 'GD extension loaded' : 'GD extension not loaded',
];

// JSON extension (required)
$checks['json'] = [
    'status' => extension_loaded('json') ? 'healthy' : 'unhealthy',
    'loaded' => extension_loaded('json'),
    'message' => extension_loaded('json') ? 'JSON extension loaded' : 'JSON extension not loaded',
];

// MySQL version
try {
    $stmt = $pdo->query('SELECT VERSION() as version');
    $row = $stmt->fetch();
    $checks['mysql'] = [
        'status' => 'healthy',
        'version' => $row['version'],
        'message' => 'MySQL version: ' . $row['version'],
    ];
} catch (Throwable $e) {
    $checks['mysql'] = [
        'status' => 'unknown',
        'message' => 'Could not determine MySQL version',
    ];
}

$response = [
    'status' => http_response_code() === 200 ? 'healthy' : 'degraded',
    'timestamp' => date('c'),
    'checks' => $checks,
];

echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
exit;
