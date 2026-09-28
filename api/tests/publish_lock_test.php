<?php
// Standalone checks for api/publish_lock.php. Run: php api/tests/publish_lock_test.php
require_once __DIR__ . '/../publish_lock.php';

$failures = 0;
function check(string $name, bool $cond, string $detail = ''): void
{
    global $failures;
    if ($cond) {
        echo "  ok   $name\n";
    } else {
        $failures++;
        echo "  FAIL $name" . ($detail !== '' ? " — $detail" : '') . "\n";
    }
}

// Isolate from any real lock files.
$dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'contentos-publish-locks';
foreach ((array) @glob($dir . DIRECTORY_SEPARATOR . '*.lock') as $f) @unlink($f);

echo "publish_lock\n";

$k1 = 'facebook:9001';
$k2 = 'facebook:9002';
contentos_publish_lock_release($k1);
contentos_publish_lock_release($k2);

check('first acquire succeeds', contentos_publish_lock_acquire($k1) === null);
$held = contentos_publish_lock_acquire($k1);
check('second acquire is refused', is_array($held), 'expected the held record');
check('held state is publishing', ($held['state'] ?? '') === 'published' ? false : ($held['state'] ?? '') === 'publishing');

check('a different key is unaffected', contentos_publish_lock_acquire($k2) === null);
contentos_publish_lock_release($k2);

contentos_publish_lock_commit($k1, 'PAGEID_POSTID');
$held = contentos_publish_lock_acquire($k1);
check('committed lock still refuses', is_array($held));
check('committed state is published', ($held['state'] ?? '') === 'published', 'got ' . ($held['state'] ?? 'null'));
check('committed keeps the post id', ($held['external_id'] ?? '') === 'PAGEID_POSTID');
check('committed records a timestamp', ($held['at'] ?? 0) > 0);

contentos_publish_lock_release($k1);
check('release frees the lock', contentos_publish_lock_acquire($k1) === null);
contentos_publish_lock_release($k1);

// An expired lock must not block forever: a crashed publish would otherwise
// wedge the post until the hourly sweep removed the file.
$path = contentos_publish_lock_path($k1);
file_put_contents($path, json_encode([
    'state' => 'publishing', 'external_id' => null, 'at' => time() - 999, 'expires' => time() - 999,
]));
$expired = contentos_publish_lock_acquire($k1, 120);
check('an expired in-flight lock is reclaimable', $expired === null, 'expected reclaim, got ' . json_encode($expired));
contentos_publish_lock_release($k1);

// A live in-flight lock still blocks, so a slow publish is not interrupted.
file_put_contents($path, json_encode([
    'state' => 'publishing', 'external_id' => null, 'at' => time(), 'expires' => time() + 120,
]));
$live = contentos_publish_lock_acquire($k1, 120);
check('a live in-flight lock is still honoured as held', is_array($live));
contentos_publish_lock_release($k1);

// Empty / unsafe keys disable locking rather than collapsing every post together.
check('empty key is not locked', contentos_publish_lock_acquire('') === null);
check('path for empty key is null', contentos_publish_lock_path('') === null);
check('key is sanitised, not rejected', contentos_publish_lock_path('facebook:9/../x') !== null);

// Sweep removes stale files but leaves live ones.
$live = 'facebook:7777';
contentos_publish_lock_acquire($live);
$stalePath = contentos_publish_lock_path('facebook:8888');
file_put_contents($stalePath, json_encode(['state' => 'published', 'external_id' => 'x', 'at' => time(), 'expires' => time() + 900]));
touch($stalePath, time() - 7200);
contentos_publish_lock_sweep(3600);
check('sweep removed the stale file', !is_file($stalePath));
check('sweep kept the live file', is_file(contentos_publish_lock_path($live)));
contentos_publish_lock_release($live);
contentos_publish_lock_release('facebook:8888');

echo $failures === 0 ? "\nall checks passed\n" : "\n$failures check(s) failed\n";
exit($failures === 0 ? 0 : 1);
