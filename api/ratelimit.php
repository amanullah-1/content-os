<?php
// ContentOS rate limiting system
// Usage: Call rate_limit_check($key, $maxRequests, $windowSeconds)
// Returns: ['allowed' => bool, 'remaining' => int, 'reset' => int]
//
// Rate limits are stored in Redis if available, otherwise SQLite fallback

// Redis connection (optional - for distributed rate limiting)
function redis(): ?Redis
{
    static $redis = null;
    if ($redis !== null) return $redis;
    
    if (!extension_loaded('redis')) {
        return null;
    }
    
    try {
        $redis = new Redis();
        $redis->connect(
            getenv('REDIS_HOST') ?: '127.0.0.1',
            (int) (getenv('REDIS_PORT') ?: 6379)
        );
        return $redis;
    } catch (Throwable $e) {
        return null;
    }
}

// SQLite fallback for rate limiting
function get_rate_limit_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    
    $dbDir = __DIR__ . '/../storage';
    if (!is_dir($dbDir)) {
        mkdir($dbDir, 0755, true);
    }
    
    $dbPath = $dbDir . '/rate_limits.sqlite';
    $pdo = new PDO("sqlite:{$dbPath}");
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // Create rate limits table if not exists
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rate_limits (
            key TEXT PRIMARY KEY,
            count INTEGER DEFAULT 1,
            reset_time INTEGER NOT NULL
        )
    ");
    
    return $pdo;
}

// Check and increment rate limit
function rate_limit_check(string $key, int $maxRequests, int $windowSeconds): array
{
    $redis = redis();
    
    if ($redis !== null) {
        return rate_limit_redis($redis, $key, $maxRequests, $windowSeconds);
    }
    
    return rate_limit_sqlite($key, $maxRequests, $windowSeconds);
}

// Redis-based rate limiting
function rate_limit_redis(Redis $redis, string $key, int $maxRequests, int $windowSeconds): array
{
    $redisKey = "rate_limit:{$key}";
    $current = $redis->get($redisKey);
    
    if ($current === false) {
        $redis->setex($redisKey, $windowSeconds, 1);
        return [
            'allowed' => true,
            'remaining' => $maxRequests - 1,
            'reset' => $windowSeconds,
        ];
    }
    
    if ((int) $current >= $maxRequests) {
        return [
            'allowed' => false,
            'remaining' => 0,
            'reset' => $redis->ttl($redisKey),
        ];
    }
    
    $redis->incr($redisKey);
    
    return [
        'allowed' => true,
        'remaining' => $maxRequests - (int) $current - 1,
        'reset' => $redis->ttl($redisKey),
    ];
}

// SQLite fallback for rate limiting
function rate_limit_sqlite(string $key, int $maxRequests, int $windowSeconds): array
{
    $pdo = get_rate_limit_db();
    $now = time();
    
    $stmt = $pdo->prepare('SELECT count, reset_time FROM rate_limits WHERE key = ?');
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    
    if ($row === false) {
        // New rate limit window
        $stmt = $pdo->prepare(
            'INSERT INTO rate_limits (key, count, reset_time) VALUES (?, 1, ?)'
        );
        $stmt->execute([$key, $now + $windowSeconds]);
        
        return [
            'allowed' => true,
            'remaining' => $maxRequests - 1,
            'reset' => $windowSeconds,
        ];
    }
    
    if ($now >= (int) $row['reset_time']) {
        // Window expired, reset
        $stmt = $pdo->prepare(
            'UPDATE rate_limits SET count = 1, reset_time = ? WHERE key = ?'
        );
        $stmt->execute([$now + $windowSeconds, $key]);
        
        return [
            'allowed' => true,
            'remaining' => $maxRequests - 1,
            'reset' => $windowSeconds,
        ];
    }
    
    if ((int) $row['count'] >= $maxRequests) {
        // Rate limited
        return [
            'allowed' => false,
            'remaining' => 0,
            'reset' => (int) $row['reset_time'] - $now,
        ];
    }
    
    // Increment counter
    $stmt = $pdo->prepare(
        'UPDATE rate_limits SET count = count + 1 WHERE key = ?'
    );
    $stmt->execute([$key]);
    
    return [
        'allowed' => true,
        'remaining' => $maxRequests - (int) $row['count'] - 1,
        'reset' => (int) $row['reset_time'] - $now,
    ];
}

// Rate limit middleware for API endpoints
function rate_limit_middleware(string $key, int $maxRequests = 100, int $windowSeconds = 60): void
{
    $result = rate_limit_check($key, $maxRequests, $windowSeconds);
    
    // Set response headers
    header('X-RateLimit-Limit: ' . $maxRequests);
    header('X-RateLimit-Remaining: ' . $result['remaining']);
    header('X-RateLimit-Reset: ' . $result['reset']);
    
    if (!$result['allowed']) {
        http_response_code(429);
        header('Retry-After: ' . $result['reset']);
        header('Content-Type: application/json');
        
        echo json_encode([
            'success' => false,
            'message' => 'Rate limit exceeded. Try again in ' . $result['reset'] . ' seconds.',
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        
        exit;
    }
}

// Rate limit by IP address (for auth endpoints)
function rate_limit_by_ip(int $maxRequests = 10, int $windowSeconds = 60): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    rate_limit_middleware("auth:ip:{$ip}", $maxRequests, $windowSeconds);
}

// Rate limit by user (for all authenticated requests)
function rate_limit_by_user(string $userId, int $maxRequests = 60, int $windowSeconds = 60): void
{
    rate_limit_middleware("user:{$userId}", $maxRequests, $windowSeconds);
}

// Rate limit by endpoint
function rate_limit_by_endpoint(string $path, int $maxRequests = 100, int $windowSeconds = 60): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    rate_limit_middleware("endpoint:{$ip}:{$path}", $maxRequests, $windowSeconds);
}
