<?php
// ContentOS structured logging system
// Usage:
//   log_info('User logged in', ['user_id' => $userId]);
//   log_error('Database connection failed', ['error' => $e->getMessage()]);
//   log_debug('Query executed', ['sql' => $sql, 'time' => $time]);
//
// Logs are written to: storage/logs/contentos-YYYY-MM-DD.log
//
// Log levels (priority order):
//   100 - debug
//   200 - info
//   300 - notice
//   400 - warning
//   500 - error
//   600 - critical
//   700 - alert
//   800 - emergency

function log_level_name(int $level): string
{
    static $names = [
        100 => 'DEBUG',
        200 => 'INFO',
        300 => 'NOTICE',
        400 => 'WARNING',
        500 => 'ERROR',
        600 => 'CRITICAL',
        700 => 'ALERT',
        800 => 'EMERGENCY',
    ];
    return $names[$level] ?? 'UNKNOWN';
}

function log_file_path(): string
{
    $logDir = __DIR__ . '/../storage/logs';
    if (!is_dir($logDir)) {
        mkdir($logDir, 0755, true);
    }
    return $logDir . '/contentos-' . date('Y-m-d') . '.log';
}

function log_write(int $level, string $message, array $context = []): void
{
    $timestamp = date('c');
    $levelName = log_level_name($level);
    
    // Build context string
    $contextStr = empty($context) ? '' : ' [' . json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . ']';
    
    // Format: [timestamp] level: message context
    $line = "[{$timestamp}] {$levelName}: {$message}{$contextStr}" . PHP_EOL;
    
    // Append to log file (atomic write)
    $file = log_file_path();
    file_put_contents($file, $line, FILE_APPEND | LOCK_EX);
}

// Convenience functions
function log_debug(string $message, array $context = []): void
{
    log_write(100, $message, $context);
}

function log_info(string $message, array $context = []): void
{
    log_write(200, $message, $context);
}

function log_notice(string $message, array $context = []): void
{
    log_write(300, $message, $context);
}

function log_warning(string $message, array $context = []): void
{
    log_write(400, $message, $context);
}

function log_error(string $message, array $context = []): void
{
    log_write(500, $message, $context);
}

function log_critical(string $message, array $context = []): void
{
    log_write(600, $message, $context);
}

function log_alert(string $message, array $context = []): void
{
    log_write(700, $message, $context);
}

function log_emergency(string $message, array $context = []): void
{
    log_write(800, $message, $context);
}

// Enhanced logging with context from request
function log_request(string $level, string $message, array $extraContext = []): void
{
    $context = [
        'ip' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        'method' => $_SERVER['REQUEST_METHOD'] ?? 'GET',
        'uri' => $_SERVER['REQUEST_URI'] ?? 'unknown',
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown',
    ];
    
    if (isset($_SESSION) && session_id()) {
        $context['session_id'] = session_id();
    }
    
    $context = array_merge($context, $extraContext);
    
    $fn = "log_{$level}";
    if (function_exists($fn)) {
        $fn($message, $context);
    } else {
        log_write(200, $message, $context);
    }
}

// Log all uncaught exceptions
set_exception_handler(function (Throwable $e): void {
    log_error('Uncaught exception', [
        'class' => get_class($e),
        'message' => $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine(),
        'trace' => $e->getTraceAsString(),
    ]);
    
    // Re-throw for normal error handling
    throw $e;
});

// Log PHP errors (with error_reporting filter)
set_error_handler(function (int $errno, string $errstr, string $errfile, int $errline): bool {
    // Don't log if error_reporting is set to 0
    if (!(error_reporting() & $errno)) {
        return false; // Let PHP handle it
    }
    
    $level = match ($errno) {
        E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR => 'error',
        E_WARNING, E_CORE_WARNING, E_COMPILE_WARNING, E_USER_WARNING => 'warning',
        E_NOTICE, E_USER_NOTICE => 'notice',
        E_STRICT => 'notice',
        E_RECOVERABLE_ERROR => 'error',
        E_DEPRECATED, E_USER_DEPRECATED => 'notice',
        default => 'info',
    };
    
    log_request($level, $errstr, [
        'error_type' => $errno,
        'file' => $errfile,
        'line' => $errline,
    ]);
    
    return false; // Let PHP handle it
});
