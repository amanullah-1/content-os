<?php
// ContentOS KV -> relational migration (CLI only, all-or-nothing).
//
// Reads the JSON blobs in `kv_store` (keys contentOS:users/brands/content/
// integrations/settings[/apiKey/aiModel/googleClientId]) and shreds them
// into the relational tables from api/schema_relational.sql.
//
//   php api/migrate_kv.php            migrate once (aborts if already migrated)
//   php api/migrate_kv.php --force    wipe relational data and re-migrate
//
// Rules:
//   * Role labels map to roles.slug; unknown roles -> 'business'.
//     The master id (master_admin_001) is always forced to super_admin.
//   * Every non-super user is granted OWNER on every migrated brand, so
//     nobody loses visibility they had under the shared KV model. Restrict
//     afterwards via the Team UI (api/members.php).
//   * Content rows reference brands BY NAME; unknown names abort the run
//     with a list (nothing is committed — single transaction).
//   * kv_store is never modified. Re-running without --force aborts.

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('CLI only.' . PHP_EOL);
}

$force = in_array('--force', $argv, true);

$cfg = require __DIR__ . '/config.php';
$pdo = new PDO(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $cfg['host'], $cfg['port'], $cfg['name']),
    $cfg['user'],
    $cfg['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

function kv(PDO $pdo, string $key)
{
    $stmt = $pdo->prepare('SELECT `value` FROM `kv_store` WHERE `key` = ?');
    $stmt->execute([$key]);
    $row = $stmt->fetchColumn();
    return $row === false ? null : json_decode((string) $row, true);
}

function parse_dt($v): ?string
{
    if (!is_string($v) || trim($v) === '') return null;
    // Normalize "Sep 4, 2026 — 7:30 PM" style labels as a fallback.
    $ts = strtotime(str_replace(['T', '—'], [' ', ' '], trim($v)));
    return $ts === false ? null : date('Y-m-d H:i:s', $ts);
}

$ROLE_MAP = [
    'super admin' => 'super_admin', 'admin' => 'admin',
    'brand manager' => 'brand_manager', 'content manager' => 'content_manager',
    'editor' => 'editor', 'business' => 'business',
    'client' => 'client', 'viewer' => 'viewer',
];

try {
    $relTables = ['sessions', 'brand_members', 'brand_tones', 'brand_pillars',
        'brand_platforms', 'brand_channels', 'content_items', 'brands',
        'integrations', 'settings', 'users'];
    $existing = 0;
    foreach (['users', 'brands', 'content_items'] as $t) {
        $existing += (int) $pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
    }
    if ($existing > 0 && !$force) {
        exit("Relational tables already hold $existing rows (users/brands/content). Re-run with --force to wipe + re-migrate, or do nothing.\n");
    }

    $users = kv($pdo, 'contentOS:users') ?? [];
    $brands = kv($pdo, 'contentOS:brands') ?? [];
    $content = kv($pdo, 'contentOS:content') ?? [];
    $integrations = kv($pdo, 'contentOS:integrations') ?? [];
    $settings = kv($pdo, 'contentOS:settings') ?? [];
    // Legacy split keys fill gaps in the settings object.
    foreach (['apiKey' => 'apiKey', 'aiModel' => 'aiModel', 'googleClientId' => 'googleClientId'] as $k => $f) {
        if (empty($settings[$f])) {
            $v = kv($pdo, "contentOS:$k");
            if ($v !== null && $v !== '') $settings[$f] = is_array($v) ? ($v['value'] ?? $v) : $v;
        }
    }
    printf(
        "KV source: %d users, %d brands, %d content, %d integrations%s\n",
        count($users),
        count($brands),
        count($content),
        count($integrations),
        $settings ? ', settings present' : ', no settings'
    );

    $roleIds = [];
    foreach ($pdo->query('SELECT `id`, `slug` FROM `roles`')->fetchAll() as $r) {
        $roleIds[$r['slug']] = (int) $r['id'];
    }

    // Pre-check: every content brand name must resolve.
    $brandNames = [];
    foreach ($brands as $b) $brandNames[(string) ($b['name'] ?? '')] = true;
    $unknown = [];
    foreach ($content as $c) {
        $bn = (string) ($c['brand'] ?? '');
        if ($bn !== '' && !isset($brandNames[$bn])) $unknown[$bn] = true;
    }
    if ($unknown) {
        exit('ABORT: content references unknown brands: ' . implode(', ', array_keys($unknown)) . "\n");
    }

    $pdo->beginTransaction();
    if ($force) {
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
        foreach ($relTables as $t) $pdo->exec("TRUNCATE TABLE `$t`");
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
        // Re-seed reference data cleared by TRUNCATE.
        foreach ([
            ['super_admin', 'Super Admin', 1, 'Master admin: unrestricted access to all brands and content'],
            ['admin', 'Admin', 0, 'Staff admin: only assigned brands and their content'],
            ['brand_manager', 'Brand Manager', 0, 'Manages assigned brands'],
            ['content_manager', 'Content Manager', 0, 'Manages content of assigned brands'],
            ['editor', 'Editor', 0, 'Edits content of assigned brands'],
            ['business', 'Business', 0, 'Client level: only own brands and their content'],
            ['client', 'Client', 0, 'Client level: only own brands and their content'],
            ['viewer', 'Viewer', 0, 'Read-only access to assigned brands'],
        ] as [$slug, $label, $sees, $desc]) {
            $pdo->prepare('INSERT INTO `roles` (`slug`, `label`, `sees_all`, `description`) VALUES (?, ?, ?, ?)')
                ->execute([$slug, $label, $sees, $desc]);
        }
        $roleIds = [];
        foreach ($pdo->query('SELECT `id`, `slug` FROM `roles`')->fetchAll() as $r) {
            $roleIds[$r['slug']] = (int) $r['id'];
        }
        echo "Wiped relational tables (--force).\n";
    }

    // --- users ---
    $stmt = $pdo->prepare(
        'INSERT INTO `users` (`id`, `email`, `name`, `avatar_color`, `role_id`, `pw_hash`, `created_at`)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $superIds = [];
    $n = 0;
    foreach ($users as $u) {
        if (empty($u['id']) || empty($u['email'])) continue;
        $slug = $ROLE_MAP[strtolower(trim((string) ($u['role'] ?? '')))] ?? 'business';
        if (($u['id'] ?? '') === 'master_admin_001') $slug = 'super_admin';
        if ($slug === 'super_admin') $superIds[] = $u['id'];
        $stmt->execute([
            $u['id'], strtolower(trim((string) $u['email'])),
            (string) ($u['name'] ?? ''), (string) ($u['avatarColor'] ?? '#6366f1'),
            $roleIds[$slug], (string) ($u['pwHash'] ?? ''),
            parse_dt($u['createdAt'] ?? null) ?? date('Y-m-d H:i:s'),
        ]);
        $n++;
    }
    echo "users: $n\n";

    // --- brands + satellites ---
    $brandIds = [];
    $bStmt = $pdo->prepare(
        'INSERT INTO `brands`
         (`id`, `name`, `industry`, `color`, `tagline`, `audience`,
          `ideas`, `drafts`, `review`, `scheduled`, `posts_month`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $toneStmt = $pdo->prepare('INSERT IGNORE INTO `brand_tones` (`brand_id`, `tone`) VALUES (?, ?)');
    $pillarStmt = $pdo->prepare('INSERT INTO `brand_pillars` (`brand_id`, `name`, `weight`) VALUES (?, ?, ?)');
    $platStmt = $pdo->prepare('INSERT IGNORE INTO `brand_platforms` (`brand_id`, `platform`) VALUES (?, ?)');
    $chanStmt = $pdo->prepare(
        'INSERT INTO `brand_channels` (`brand_id`, `platform_id`, `connected`, `config`)
         VALUES (?, ?, ?, CAST(? AS JSON))'
    );
    $nb = 0;
    foreach ($brands as $b) {
        if (empty($b['name'])) continue;
        $id = isset($b['id']) ? (int) $b['id'] : null;
        if ($id) {
            $bStmt->execute([
                $id, $b['name'], $b['industry'] ?? '', $b['color'] ?? '#0ea5e9',
                $b['tagline'] ?? '', $b['audience'] ?? '',
                (int) ($b['ideas'] ?? 0), (int) ($b['drafts'] ?? 0),
                (int) ($b['review'] ?? 0), (int) ($b['scheduled'] ?? 0),
                (int) ($b['posts_month'] ?? 0),
            ]);
        } else {
            $pdo->prepare(
                'INSERT INTO `brands`
                 (`name`, `industry`, `color`, `tagline`, `audience`,
                  `ideas`, `drafts`, `review`, `scheduled`, `posts_month`)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $b['name'], $b['industry'] ?? '', $b['color'] ?? '#0ea5e9',
                $b['tagline'] ?? '', $b['audience'] ?? '',
                (int) ($b['ideas'] ?? 0), (int) ($b['drafts'] ?? 0),
                (int) ($b['review'] ?? 0), (int) ($b['scheduled'] ?? 0),
                (int) ($b['posts_month'] ?? 0),
            ]);
            $id = (int) $pdo->lastInsertId();
        }
        $brandIds[(string) $b['name']] = $id;
        foreach ((array) ($b['tone'] ?? []) as $tone) {
            if (trim((string) $tone) !== '') $toneStmt->execute([$id, trim((string) $tone)]);
        }
        foreach ((array) ($b['pillars'] ?? []) as $p) {
            if (empty($p['name'])) continue;
            $pillarStmt->execute([$id, $p['name'], (float) ($p['weight'] ?? 0)]);
        }
        foreach ((array) ($b['platforms'] ?? []) as $p) {
            if (trim((string) $p) !== '') $platStmt->execute([$id, trim((string) $p)]);
        }
        foreach ((array) ($b['channels'] ?? []) as $c) {
            if (empty($c['platformId'])) continue;
            $chanStmt->execute([
                $id, (string) $c['platformId'], !empty($c['connected']) ? 1 : 0,
                json_encode($c['config'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]);
        }
        $nb++;
    }
    echo "brands: $nb (+ satellites)\n";

    // --- memberships: every non-super user owns every brand (preserve KV-era visibility) ---
    $allUserIds = $pdo->query('SELECT `id` FROM `users`')->fetchAll(PDO::FETCH_COLUMN);
    $mStmt = $pdo->prepare(
        "INSERT IGNORE INTO `brand_members` (`brand_id`, `user_id`, `member_role`) VALUES (?, ?, 'owner')"
    );
    $nm = 0;
    foreach ($allUserIds as $uid) {
        if (in_array($uid, $superIds, true)) continue;
        foreach ($brandIds as $bid) {
            $mStmt->execute([$bid, $uid]);
            $nm++;
        }
    }
    echo "memberships: $nm (super admins need none)\n";

    // --- content ---
    $validStatus = ['ai_generated', 'draft', 'review', 'approved', 'scheduled', 'published'];
    $cStmt = $pdo->prepare(
        'INSERT INTO `content_items`
         (`id`, `brand_id`, `campaign`, `pillar`, `platform`, `status`, `caption`, `hashtags`,
          `scheduled_label`, `scheduled_at`, `format`, `score`,
          `image_prompt`, `video_script`, `image_url`, `video_url`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $cStmtNoId = $pdo->prepare(
        'INSERT INTO `content_items`
         (`brand_id`, `campaign`, `pillar`, `platform`, `status`, `caption`, `hashtags`,
          `scheduled_label`, `scheduled_at`, `format`, `score`,
          `image_prompt`, `video_script`, `image_url`, `video_url`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $nc = 0;
    foreach ($content as $c) {
        $bn = (string) ($c['brand'] ?? '');
        if ($bn === '' || !isset($brandIds[$bn])) continue; // guarded by pre-check
        $status = in_array($c['status'] ?? '', $validStatus, true) ? $c['status'] : 'draft';
        $dt = parse_dt($c['scheduledISO'] ?? null) ?? parse_dt($c['scheduled'] ?? null);
        $args = [
            $brandIds[$bn], $c['campaign'] ?? '', $c['pillar'] ?? '', $c['platform'] ?? '',
            $status, $c['caption'] ?? '', $c['hashtags'] ?? '', $c['scheduled'] ?? '', $dt,
            $c['format'] ?? '', isset($c['score']) ? (int) $c['score'] : null,
            $c['imagePrompt'] ?? null, $c['videoScript'] ?? null,
            $c['generatedImageUrl'] ?? null, $c['generatedVideoUrl'] ?? null,
        ];
        if (!empty($c['id'])) {
            $cStmt->execute([(int) $c['id'], ...$args]);
        } else {
            $cStmtNoId->execute($args);
        }
        $nc++;
    }
    echo "content: $nc\n";

    // --- integrations + settings ---
    $iStmt = $pdo->prepare(
        'INSERT INTO `integrations` (`provider`, `connected`, `config`)
         VALUES (?, ?, CAST(? AS JSON))
         ON DUPLICATE KEY UPDATE `connected` = VALUES(`connected`), `config` = VALUES(`config`)'
    );
    $ni = 0;
    foreach ($integrations as $g) {
        if (empty($g['id'])) continue;
        $iStmt->execute([
            $g['id'], !empty($g['connected']) ? 1 : 0,
            json_encode($g['config'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
        $ni++;
    }
    echo "integrations: $ni\n";

    if ($settings) {
        $pdo->prepare(
            'INSERT INTO `settings` (`scope_key`, `value`)
             VALUES (?, CAST(? AS JSON))
             ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)'
        )->execute(['app', json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
        echo "settings: 1 (app)\n";
    }

    // Fresh-install fallback: no users anywhere -> seed master from env.
    $totalUsers = (int) $pdo->query('SELECT COUNT(*) FROM `users`')->fetchColumn();
    if ($totalUsers === 0) {
        $email = getenv('CONTENTOS_MASTER_EMAIL') ?: 'admin@contentos.app';
        $password = getenv('CONTENTOS_MASTER_PASSWORD') ?: 'ChangeMe123!';
        $pdo->prepare(
            'INSERT INTO `users` (`id`, `email`, `name`, `avatar_color`, `role_id`, `pw_hash`)
             VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([
            'master_admin_001', $email, 'Super Admin', '#4f46e5',
            $roleIds['super_admin'], password_hash($password, PASSWORD_DEFAULT),
        ]);
        echo "users: 1 (fresh master seed)\n";
    }

    $pdo->commit();
    echo "MIGRATION OK — kv_store untouched.\n";
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    fwrite(STDERR, 'MIGRATION FAILED: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
