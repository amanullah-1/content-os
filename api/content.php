<?php
// ContentOS content API — relational CRUD with access scoping.
//
// GET    api/content.php[?brand_id=N&status=S&platform=P]  scoped list (+ optional filters)
// POST   api/content.php              create (brand given by NAME, resolved server-side)
// PUT    api/content.php?id=N         update (needs access to the item's brand AND the target brand on move)
// DELETE api/content.php?id=N         delete (needs access to the item's brand)
//
// All routes require `Authorization: Bearer <token>`.

require __DIR__ . '/bootstrap.php';
cors();

const STATUSES = ['ai_generated', 'draft', 'review', 'approved', 'scheduled', 'published'];

function item_shape(array $r): array
{
    $out = [
        'id' => (int) $r['id'],
        'brand' => $r['brand_name'],
        'brandColor' => $r['brand_color'],
        'campaign' => $r['campaign'],
        'pillar' => $r['pillar'],
        'platform' => $r['platform'],
        'status' => $r['status'],
        'caption' => $r['caption'] ?? '',
        'hashtags' => $r['hashtags'],
        'scheduled' => $r['scheduled_label'],
        'format' => $r['format'],
        'score' => $r['score'] === null ? 0 : (int) $r['score'],
    ];
    foreach (['image_prompt' => 'imagePrompt', 'video_script' => 'videoScript',
              'image_url' => 'generatedImageUrl', 'video_url' => 'generatedVideoUrl'] as $col => $key) {
        if ($r[$col] !== null && $r[$col] !== '') $out[$key] = $r[$col];
    }
    if ($r['scheduled_at'] !== null) {
        $out['scheduledISO'] = str_replace(' ', 'T', (string) $r['scheduled_at']);
    }
    return $out;
}

/** Resolve a brand NAME to an accessible brand id (null = unknown or no access). */
function resolve_brand(PDO $pdo, array $user, string $name): ?int
{
    $stmt = $pdo->prepare('SELECT `id` FROM `brands` WHERE `name` = ? ORDER BY `id` LIMIT 1');
    $stmt->execute([trim($name)]);
    $id = $stmt->fetchColumn();
    if ($id === false) return null;
    return can_access_brand($user, (int) $id) ? (int) $id : null;
}

function parse_dt(?string $v): ?string
{
    if ($v === null || trim($v) === '') return null;
    $ts = strtotime(str_replace('T', ' ', trim($v)));
    return $ts === false ? null : date('Y-m-d H:i:s', $ts);
}

try {
    $pdo = db();
    $user = require_auth();
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        $ids = visible_brand_ids($user);
        $where = [];
        $params = [];
        if ($ids !== null) {
            if ($ids === []) respond([]);
            $where[] = 'c.`brand_id` IN (' . implode(',', array_fill(0, count($ids), '?')) . ')';
            array_push($params, ...$ids);
        }
        foreach (['brand_id' => 'c.`brand_id`', 'status' => 'c.`status`', 'platform' => 'c.`platform`'] as $q => $col) {
            if (isset($_GET[$q]) && $_GET[$q] !== '') {
                $where[] = "$col = ?";
                $params[] = $_GET[$q];
            }
        }
        $sql = 'SELECT c.*, b.`name` AS brand_name, b.`color` AS brand_color
                FROM `content_items` c JOIN `brands` b ON b.`id` = c.`brand_id`'
             . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
             . ' ORDER BY c.`id` DESC';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        respond(array_map('item_shape', $stmt->fetchAll()));
    }

    if ($method === 'POST') {
        $in = body();
        $brandId = resolve_brand($pdo, $user, (string) ($in['brand'] ?? ''));
        if ($brandId === null) fail('Unknown brand or no access to it.', 403);
        $status = (string) ($in['status'] ?? 'draft');
        if (!in_array($status, STATUSES, true)) fail('Invalid status.', 400);
        $stmt = $pdo->prepare(
            'INSERT INTO `content_items`
             (`brand_id`, `campaign`, `pillar`, `platform`, `status`, `caption`, `hashtags`,
              `scheduled_label`, `scheduled_at`, `format`, `score`,
              `image_prompt`, `video_script`, `image_url`, `video_url`, `created_by`)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $brandId, (string) ($in['campaign'] ?? ''), (string) ($in['pillar'] ?? ''),
            (string) ($in['platform'] ?? ''), $status,
            (string) ($in['caption'] ?? ''), (string) ($in['hashtags'] ?? ''),
            (string) ($in['scheduled'] ?? ''), parse_dt($in['scheduledISO'] ?? null),
            (string) ($in['format'] ?? ''),
            isset($in['score']) ? (int) $in['score'] : null,
            $in['imagePrompt'] ?? null, $in['videoScript'] ?? null,
            $in['generatedImageUrl'] ?? null, $in['generatedVideoUrl'] ?? null,
            $user['id'],
        ]);
        $id = (int) $pdo->lastInsertId();
        $stmt = $pdo->prepare(
            'SELECT c.*, b.`name` AS brand_name, b.`color` AS brand_color
             FROM `content_items` c JOIN `brands` b ON b.`id` = c.`brand_id`
             WHERE c.`id` = ?'
        );
        $stmt->execute([$id]);
        respond(item_shape($stmt->fetch()), 201);
    }

    $id = (int) ($_GET['id'] ?? 0);
    if ($id <= 0) fail('Missing ?id=N.', 400);
    $stmt = $pdo->prepare('SELECT * FROM `content_items` WHERE `id` = ?');
    $stmt->execute([$id]);
    $existing = $stmt->fetch();
    if ($existing === false) fail('Content item not found.', 404);
    if (!can_access_brand($user, (int) $existing['brand_id'])) {
        fail('No access to this content.', 403);
    }

    if ($method === 'PUT') {
        $in = body();
        $brandId = (int) $existing['brand_id'];
        if (array_key_exists('brand', $in)) {
            $resolved = resolve_brand($pdo, $user, (string) $in['brand']);
            if ($resolved === null) fail('Unknown brand or no access to it.', 403);
            $brandId = $resolved;
        }
        $status = (string) ($in['status'] ?? $existing['status']);
        if (!in_array($status, STATUSES, true)) fail('Invalid status.', 400);
        $cols = [
            'brand_id' => $brandId, 'campaign' => (string) ($in['campaign'] ?? $existing['campaign']),
            'pillar' => (string) ($in['pillar'] ?? $existing['pillar']),
            'platform' => (string) ($in['platform'] ?? $existing['platform']),
            'status' => $status,
            'caption' => (string) ($in['caption'] ?? $existing['caption']),
            'hashtags' => (string) ($in['hashtags'] ?? $existing['hashtags']),
            'scheduled_label' => (string) ($in['scheduled'] ?? $existing['scheduled_label']),
            'scheduled_at' => array_key_exists('scheduledISO', $in)
                ? parse_dt($in['scheduledISO']) : $existing['scheduled_at'],
            'format' => (string) ($in['format'] ?? $existing['format']),
            'score' => array_key_exists('score', $in) ? (int) $in['score'] : $existing['score'],
            'image_prompt' => $in['imagePrompt'] ?? $existing['image_prompt'],
            'video_script' => $in['videoScript'] ?? $existing['video_script'],
            'image_url' => $in['generatedImageUrl'] ?? $existing['image_url'],
            'video_url' => $in['generatedVideoUrl'] ?? $existing['video_url'],
        ];
        $sets = implode(', ', array_map(fn($c) => "`$c` = ?", array_keys($cols)));
        $params = array_values($cols);
        $params[] = $id;
        $pdo->prepare("UPDATE `content_items` SET $sets WHERE `id` = ?")->execute($params);
        $stmt = $pdo->prepare(
            'SELECT c.*, b.`name` AS brand_name, b.`color` AS brand_color
             FROM `content_items` c JOIN `brands` b ON b.`id` = c.`brand_id`
             WHERE c.`id` = ?'
        );
        $stmt->execute([$id]);
        respond(item_shape($stmt->fetch()));
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM `content_items` WHERE `id` = ?')->execute([$id]);
        respond(['success' => true]);
    }

    fail('Method not allowed.', 405);
} catch (Throwable $e) {
    fail($e->getMessage());
}
