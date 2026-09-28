<?php
// Cross-process publish lock.
//
// The auto-publish loop runs inside every open browser tab, and its in-flight
// guard is per-tab. Two tabs ticking on the same due post therefore published it
// twice (observed live: two identical Facebook posts with the same created_time).
//
// This lock is shared by every request hitting this server, so it dedupes across
// tabs, windows and devices. It is deliberately filesystem-based rather than
// MySQL: publish.php is an unauthenticated same-origin proxy with no database
// handle, and a temp file needs no configuration.
//
// Design note: a *second* request for a post that is already published returns
// success plus the original post id rather than an error. That is what makes the
// two tabs converge - the late tab still records the post as published instead
// of retrying forever.

const CONTENTOS_LOCK_TTL = 120;      // seconds an in-flight publish blocks others
const CONTENTOS_LOCK_DEDUPE = 900;   // seconds a confirmed publish blocks re-posts

function contentos_publish_lock_dir(): string
{
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'contentos-publish-locks';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return $dir;
}

/** Filesystem-safe key. Empty keys disable locking rather than locking everything together. */
function contentos_publish_lock_path(string $key): ?string
{
    $key = trim($key);
    if ($key === '') return null;
    $safe = preg_replace('/[^A-Za-z0-9_.-]+/', '_', $key);
    if ($safe === '' || $safe === '_') return null;
    return contentos_publish_lock_dir() . DIRECTORY_SEPARATOR . $safe . '.lock';
}

function contentos_publish_lock_read(string $key): ?array
{
    $path = contentos_publish_lock_path($key);
    if ($path === null || !is_file($path)) return null;
    $raw = @file_get_contents($path);
    if ($raw === false) return null;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

/**
 * Is this record still within the window it was written for?
 *
 * Records carry an "expires" stamp. It has to be consulted here: the sweep only
 * clears files older than an hour, so without this check a lock outlives its own
 * window by up to 45 minutes.
 */
function contentos_publish_lock_is_live(array $record): bool
{
    $expires = (int) ($record['expires'] ?? 0);
    if ($expires <= 0) return true; // no stamp: treat as live rather than steal it
    return $expires > time();
}

/**
 * Try to take the lock.
 *
 * @return array|null null when the lock was acquired, otherwise the existing
 *                    record explaining who holds it.
 */
function contentos_publish_lock_acquire(string $key, int $ttl = CONTENTOS_LOCK_TTL): ?array
{
    $path = contentos_publish_lock_path($key);
    if ($path === null) return null;

    $handle = @fopen($path, 'x'); // O_EXCL: fails if another process won the race
    if ($handle === false) {
        $existing = contentos_publish_lock_read($key);
        if ($existing === null) {
            // File vanished between the two calls - retry once.
            $handle = @fopen($path, 'x');
            if ($handle === false) return contentos_publish_lock_read($key);
        } elseif (!contentos_publish_lock_is_live($existing)) {
            // The holder's window has closed. The old code returned this record
            // anyway and reported a *successful* publish using the previous
            // post's id and timestamp, so editing a post and re-publishing it
            // silently did nothing: the caller saw success, the platform never
            // received the new content. Take the lock over instead.
            @unlink($path);
            $handle = @fopen($path, 'x');
            if ($handle === false) return contentos_publish_lock_read($key);
        } else {
            return $existing;
        }
    }

    fwrite($handle, json_encode([
        'state' => 'publishing',
        'external_id' => null,
        'at' => time(),
        'expires' => time() + $ttl,
    ]));
    fclose($handle);
    return null;
}

/** Record a confirmed publish so later attempts are deduped, not re-run. */
function contentos_publish_lock_commit(string $key, ?string $externalId, int $window = CONTENTOS_LOCK_DEDUPE): void
{
    $path = contentos_publish_lock_path($key);
    if ($path === null) return;
    @file_put_contents($path, json_encode([
        'state' => 'published',
        'external_id' => $externalId,
        'at' => time(),
        'expires' => time() + $window,
    ]));
}

/** Drop the lock so a genuine retry can proceed (used when publishing failed). */
function contentos_publish_lock_release(string $key): void
{
    $path = contentos_publish_lock_path($key);
    if ($path === null) return;
    @unlink($path);
}

/** Remove expired lock files so the temp directory does not grow without bound. */
function contentos_publish_lock_sweep(int $maxAge = 3600): void
{
    foreach ((array) @glob(contentos_publish_lock_dir() . DIRECTORY_SEPARATOR . '*.lock') as $file) {
        if (is_file($file) && filemtime($file) < time() - $maxAge) @unlink($file);
    }
}
