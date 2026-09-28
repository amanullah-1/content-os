<?php
// Regression tests for the publish dedupe window.
//
// Background: a confirmed publish writes a lock record carrying an "expires"
// timestamp, but nothing ever read it. The only cleanup was the hourly sweep,
// so any re-publish inside that hour was answered with the original post's id
// and timestamp as a *success*. Observed live: a post edited and re-published
// 46 minutes later reported the original post id and the original publish time,
// and no second post ever reached Facebook.
//
// Run: php api/tests/publish_dedupe_test.php
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

$dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'contentos-publish-locks';
foreach ((array) @glob($dir . DIRECTORY_SEPARATOR . '*.lock') as $f) @unlink($f);

echo "publish dedupe window\n";

$k = 'facebook:9001';
$path = contentos_publish_lock_path($k);

// A lock whose "expires" is in the past must not keep blocking re-publishes.
// This is the exact shape left behind by the hourly sweep bug: a committed
// record that has been on disk longer than CONTENTOS_LOCK_DEDUPE.
file_put_contents($path, json_encode([
    'state' => 'published',
    'external_id' => 'PAGEID_OLDPOST',
    'at' => time() - 3600,
    'expires' => time() - 2700, // expired 45 minutes ago
]));
// filemtime also backdated so the hourly sweep would not have removed it.
touch($path, time() - 3600);

$held = contentos_publish_lock_acquire($k);
check(
    'an expired published lock no longer blocks a re-publish',
    $held === null,
    'expected the lock to be acquirable, got ' . json_encode($held)
);

// A live lock inside its window must still refuse, or two tabs double-publish.
contentos_publish_lock_release($k);
contentos_publish_lock_acquire($k);
contentos_publish_lock_commit($k, 'PAGEID_NEWPOST');
$held = contentos_publish_lock_acquire($k);
check('a live committed lock still refuses a duplicate', is_array($held));
check('the live lock reports the current post id', ($held['external_id'] ?? '') === 'PAGEID_NEWPOST');
contentos_publish_lock_release($k);

// An expired *in-flight* (publishing) lock must also be reclaimable, otherwise
// a crashed publish wedges the post for the whole hour.
file_put_contents($path, json_encode([
    'state' => 'publishing',
    'external_id' => null,
    'at' => time() - 3600,
    'expires' => time() - 3480,
]));
touch($path, time() - 3600);
$held = contentos_publish_lock_acquire($k);
check(
    'an expired in-flight lock is reclaimable',
    $held === null,
    'expected reclaim, got ' . json_encode($held)
);
contentos_publish_lock_release($k);

echo $failures === 0 ? "\nall checks passed\n" : "\n$failures check(s) failed\n";
exit($failures === 0 ? 0 : 1);
