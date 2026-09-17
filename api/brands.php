<?php
// ContentOS brands API — relational CRUD with access scoping.
//
// GET    api/brands.php            scoped brand list (nested tones/pillars/platforms/channels)
// POST   api/brands.php            create (+ creator becomes owner member unless super admin)
// PUT    api/brands.php?id=N       replace brand + satellites (needs access)
// DELETE api/brands.php?id=N       delete incl. content via FK cascade (owner or super admin)
//
// All routes require `Authorization: Bearer <token>`.

require __DIR__ . '/bootstrap.php';
cors();

function brand_shape(PDO $pdo, int $brandId): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM `brands` WHERE `id` = ?');
    $stmt->execute([$brandId]);
    $b = $stmt->fetch();
    if ($b === false) return null;

    $tones = $pdo->prepare('SELECT `tone` FROM `brand_tones` WHERE `brand_id` = ? ORDER BY `tone`');
    $tones->execute([$brandId]);
    $pillars = $pdo->prepare('SELECT `name`, `weight` FROM `brand_pillars` WHERE `brand_id` = ? ORDER BY `id`');
    $pillars->execute([$brandId]);
    $platforms = $pdo->prepare('SELECT `platform` FROM `brand_platforms` WHERE `brand_id` = ? ORDER BY `platform`');
    $platforms->execute([$brandId]);
    $channels = $pdo->prepare('SELECT `platform_id`, `connected`, `config` FROM `brand_channels` WHERE `brand_id` = ?');
    $channels->execute([$brandId]);

    return [
        'id' => (int) $b['id'],
        'name' => $b['name'],
        'industry' => $b['industry'],
        'color' => $b['color'],
        'tagline' => $b['tagline'],
        'tone' => $tones->fetchAll(PDO::FETCH_COLUMN),
        'audience' => $b['audience'],
        'pillars' => array_map(
            fn($p) => ['name' => $p['name'], 'weight' => (float) $p['weight']],
            $pillars->fetchAll()
        ),
        'platforms' => $platforms->fetchAll(PDO::FETCH_COLUMN),
        'channels' => array_map(
            fn($c) => [
                'platformId' => $c['platform_id'],
                'connected' => (bool) $c['connected'],
                'config' => json_decode((string) $c['config'], true) ?? [],
            ],
            $channels->fetchAll()
        ),
        'ideas' => (int) $b['ideas'],
        'drafts' => (int) $b['drafts'],
        'review' => (int) $b['review'],
        'scheduled' => (int) $b['scheduled'],
        'posts_month' => (int) $b['posts_month'],
    ];
}

function write_satellites(PDO $pdo, int $brandId, array $in): void
{
    foreach (['brand_tones', 'brand_pillars', 'brand_platforms', 'brand_channels'] as $t) {
        $pdo->prepare("DELETE FROM `$t` WHERE `brand_id` = ?")->execute([$brandId]);
    }
    $tones = array_values(array_unique(array_filter(array_map('strval', (array) ($in['tone'] ?? [])))));
    $stmt = $pdo->prepare('INSERT INTO `brand_tones` (`brand_id`, `tone`) VALUES (?, ?)');
    foreach ($tones as $tone) $stmt->execute([$brandId, $tone]);

    $stmt = $pdo->prepare('INSERT INTO `brand_pillars` (`brand_id`, `name`, `weight`) VALUES (?, ?, ?)');
    foreach ((array) ($in['pillars'] ?? []) as $p) {
        if (!is_array($p) || trim((string) ($p['name'] ?? '')) === '') continue;
        $stmt->execute([$brandId, trim((string) $p['name']), (float) ($p['weight'] ?? 0)]);
    }

    $platforms = array_values(array_unique(array_filter(array_map('strval', (array) ($in['platforms'] ?? [])))));
    $stmt = $pdo->prepare('INSERT INTO `brand_platforms` (`brand_id`, `platform`) VALUES (?, ?)');
    foreach ($platforms as $platform) $stmt->execute([$brandId, $platform]);

    $stmt = $pdo->prepare(
        'INSERT INTO `brand_channels` (`brand_id`, `platform_id`, `connected`, `config`)
         VALUES (?, ?, ?, CAST(? AS JSON))'
    );
    foreach ((array) ($in['channels'] ?? []) as $c) {
        if (!is_array($c) || empty($c['platformId'])) continue;
        $stmt->execute([
            $brandId, (string) $c['platformId'], !empty($c['connected']) ? 1 : 0,
            json_encode($c['config'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
    }
}

try {
    $pdo = db();
    $user = require_auth();
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        $ids = visible_brand_ids($user);
        if ($ids === null) {
            $rows = $pdo->query('SELECT `id` FROM `brands` ORDER BY `id`')->fetchAll(PDO::FETCH_COLUMN);
        } elseif ($ids === []) {
            respond([]);
        } else {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $pdo->prepare("SELECT `id` FROM `brands` WHERE `id` IN ($placeholders) ORDER BY `id`");
            $stmt->execute($ids);
            $rows = $stmt->fetchAll(PDO::FETCH_COLUMN);
        }
        $out = [];
        foreach ($rows as $id) {
            $shape = brand_shape($pdo, (int) $id);
            if ($shape !== null) $out[] = $shape;
        }
        respond($out);
    }

    if ($method === 'POST') {
        $in = body();
        if (trim((string) ($in['name'] ?? '')) === '') fail('Brand name is required.', 400);
        $pdo->beginTransaction();
        $stmt = $pdo->prepare(
            'INSERT INTO `brands` (`name`, `industry`, `color`, `tagline`, `audience`)
             VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            trim((string) $in['name']), (string) ($in['industry'] ?? ''),
            (string) ($in['color'] ?? '#0ea5e9'), (string) ($in['tagline'] ?? ''),
            (string) ($in['audience'] ?? ''),
        ]);
        $brandId = (int) $pdo->lastInsertId();
        write_satellites($pdo, $brandId, $in);
        if (empty($user['sees_all'])) {
            $pdo->prepare(
                "INSERT INTO `brand_members` (`brand_id`, `user_id`, `member_role`)
                 VALUES (?, ?, 'owner')"
            )->execute([$brandId, $user['id']]);
        }
        $pdo->commit();
        respond(brand_shape($pdo, $brandId), 201);
    }

    $id = (int) ($_GET['id'] ?? 0);
    if ($id <= 0) fail('Missing ?id=N.', 400);

    if ($method === 'PUT') {
        if (!can_access_brand($user, $id)) fail('No access to this brand.', 403);
        $in = body();
        $pdo->beginTransaction();
        $pdo->prepare(
            'UPDATE `brands`
             SET `name` = ?, `industry` = ?, `color` = ?, `tagline` = ?, `audience` = ?
             WHERE `id` = ?'
        )->execute([
            trim((string) ($in['name'] ?? '')), (string) ($in['industry'] ?? ''),
            (string) ($in['color'] ?? ''), (string) ($in['tagline'] ?? ''),
            (string) ($in['audience'] ?? ''), $id,
        ]);
        write_satellites($pdo, $id, $in);
        $pdo->commit();
        respond(brand_shape($pdo, $id));
    }

    if ($method === 'DELETE') {
        if (!is_brand_owner($user, $id)) fail('Only the brand owner or a super admin can delete it.', 403);
        $pdo->prepare('DELETE FROM `brands` WHERE `id` = ?')->execute([$id]);
        respond(['success' => true]);
    }

    fail('Method not allowed.', 405);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    fail($e->getMessage());
}
