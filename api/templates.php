<?php
// ContentOS content templates API — reusable skeletal content, scoped by brand.
//
// GET    api/templates.php[?brand_id=N&category=S]   templates visible to the user
// POST   api/templates.php                           create (global or brand-scoped)
// PUT    api/templates.php?id=N                      update (access to scoped brand, or super admin for global)
// DELETE api/templates.php?id=N                      delete (same gates)
//
// All routes require `Authorization: Bearer <token>`.
//
// Access rule:
//   - Templates with brand_id NULL are "global" — visible to every user.
//   - Templates with a brand are visible to users who can access that brand.
//   - Only super admins may create/edit/delete GLOBAL templates.

require __DIR__ . '/bootstrap.php';
cors();

/** Resolve a brand NAME to an accessible brand id (null = unknown or no access). */
function resolve_brand(PDO $pdo, array $user, string $name): ?int
{
    $stmt = $pdo->prepare('SELECT `id` FROM `brands` WHERE `name` = ? ORDER BY `id` LIMIT 1');
    $stmt->execute([trim($name)]);
    $id = $stmt->fetchColumn();
    if ($id === false) return null;
    return can_access_brand($user, (int) $id) ? (int) $id : null;
}

function template_shape(array $r): array
{
    $brand = $r['brand_name'] ?? null;
    return [
        'id' => (int) $r['id'],
        'name' => $r['name'],
        'description' => $r['description'],
        'brandId' => $r['brand_id'] === null ? null : (int) $r['brand_id'],
        'brand' => $brand,
        'category' => $r['category'],
        'campaign' => $r['campaign'],
        'pillar' => $r['pillar'],
        'platform' => $r['platform'],
        'format' => $r['format'],
        'caption' => $r['caption'] ?? '',
        'hashtags' => $r['hashtags'],
        'imagePrompt' => ($r['image_prompt'] ?? '') !== '' ? $r['image_prompt'] : null,
        'videoScript' => ($r['video_script'] ?? '') !== '' ? $r['video_script'] : null,
        'global' => $r['brand_id'] === null,
    ];
}

try {
    $pdo = db();
    $method = $_SERVER['REQUEST_METHOD'];
    $user = require_auth();

    ensure_audit_log_table($pdo);
    rate_limit_by_user($user['id'], 130, 60);

    if ($method === 'GET') {
        $visible = visible_brand_ids($user);      // null = super admin (unrestricted)
        $where = [];
        $params = [];
        if ($visible !== null) {
            if ($visible === []) {
                // Non-admin with no brands: only global templates.
                $where[] = 't.`brand_id` IS NULL';
            } else {
                // Scoped to the user's brands, plus global templates.
                $marks = implode(',', array_fill(0, count($visible), '?'));
                $where[] = '(t.`brand_id` IN (' . $marks . ') OR t.`brand_id` IS NULL)';
                array_push($params, ...$visible);
            }
        }
        if (isset($_GET['brand_id']) && $_GET['brand_id'] !== '') {
            $where[] = 't.`brand_id` = ?';
            $params[] = (int) $_GET['brand_id'];
        }
        if (isset($_GET['category']) && $_GET['category'] !== '') {
            $where[] = 't.`category` = ?';
            $params[] = $_GET['category'];
        }
        $sql = 'SELECT t.*, b.`name` AS brand_name
                FROM `content_templates` t
                LEFT JOIN `brands` b ON b.`id` = t.`brand_id`'
             . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
             . ' ORDER BY t.`category` ASC, t.`name` ASC, t.`id` DESC';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        respond(array_map('template_shape', $stmt->fetchAll()));
    }

    if ($method === 'POST') {
        require_super_admin($user);   // template authoring is a super-admin capability for now
        $in = body();
        $name = trim((string) ($in['name'] ?? ''));
        if ($name === '') fail('Template name is required.', 400);

        $brandId = null;
        if (!empty($in['brand']) && !empty($in['brandId'])) {
            // Prefer the numeric id when present; otherwise resolve the name.
            fail('Provide either brandId or brand, not both.', 400);
        } elseif (!empty($in['brandId'])) {
            $brandId = (int) $in['brandId'];
            if ($brandId > 0 && !can_access_brand($user, $brandId)) {
                fail('No access to that brand.', 403);
            }
        } elseif (!empty($in['brand'])) {
            $resolved = resolve_brand($pdo, $user, (string) $in['brand']);
            if ($resolved === null) fail('Unknown brand or no access to it.', 403);
            $brandId = $resolved;
        }

        $stmt = $pdo->prepare(
            'INSERT INTO `content_templates`
             (`name`, `description`, `brand_id`, `category`, `campaign`, `pillar`,
              `platform`, `format`, `caption`, `hashtags`, `image_prompt`,
              `video_script`, `created_by`)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $name, trim((string) ($in['description'] ?? '')), $brandId,
            (string) ($in['category'] ?? 'General'),
            (string) ($in['campaign'] ?? ''), (string) ($in['pillar'] ?? ''),
            (string) ($in['platform'] ?? ''), (string) ($in['format'] ?? ''),
            (string) ($in['caption'] ?? ''), (string) ($in['hashtags'] ?? ''),
            (string) ($in['imagePrompt'] ?? ''), (string) ($in['videoScript'] ?? ''),
            $user['id'],
        ]);
        $id = (int) $pdo->lastInsertId();
        $stmt = $pdo->prepare(
            'SELECT t.*, b.`name` AS brand_name
             FROM `content_templates` t LEFT JOIN `brands` b ON b.`id` = t.`brand_id`
             WHERE t.`id` = ?'
        );
        $stmt->execute([$id]);
        audit_log($pdo, $user['id'], 'templates.created', 'template', $id, [
            'brand_id' => $brandId, 'category' => (string) ($in['category'] ?? 'General'),
        ]);
        respond(template_shape($stmt->fetch()), 201);
    }

    $id = (int) ($_GET['id'] ?? 0);
    if ($id <= 0) fail('Missing ?id=N.', 400);
    $stmt = $pdo->prepare('SELECT * FROM `content_templates` WHERE `id` = ?');
    $stmt->execute([$id]);
    $existing = $stmt->fetch();
    if ($existing === false) fail('Template not found.', 404);
    $existingBrand = $existing['brand_id'] === null ? null : (int) $existing['brand_id'];

    if ($method === 'PUT') {
        require_super_admin($user);
        $in = body();
        if ($existingBrand !== null && !can_access_brand($user, $existingBrand)) {
            fail('No access to that template.', 403);
        }
        if (isset($in['name']) && trim((string) $in['name']) === '') fail('Template name is required.', 400);

        $brandId = $existingBrand;
        if (array_key_exists('brandId', $in)) {
            if ($in['brandId'] === null || $in['brandId'] === '') {
                $brandId = null;
            } else {
                $candidate = (int) $in['brandId'];
                if ($candidate > 0 && !can_access_brand($user, $candidate)) {
                    fail('No access to that brand.', 403);
                }
                $brandId = $candidate;
            }
        }

        $cols = [
            'name' => ($in['name'] ?? $existing['name']),
            'description' => ($in['description'] ?? $existing['description']),
            'brand_id' => $brandId,
            'category' => ($in['category'] ?? $existing['category']),
            'campaign' => ($in['campaign'] ?? $existing['campaign']),
            'pillar' => ($in['pillar'] ?? $existing['pillar']),
            'platform' => ($in['platform'] ?? $existing['platform']),
            'format' => ($in['format'] ?? $existing['format']),
            'caption' => ($in['caption'] ?? $existing['caption']),
            'hashtags' => ($in['hashtags'] ?? $existing['hashtags']),
            'image_prompt' => ($in['imagePrompt'] ?? $existing['image_prompt']),
            'video_script' => ($in['videoScript'] ?? $existing['video_script']),
        ];
        $sets = implode(', ', array_map(fn($c) => "`$c` = ?", array_keys($cols)));
        $params = array_values($cols);
        $params[] = $id;
        $pdo->prepare("UPDATE `content_templates` SET $sets WHERE `id` = ?")->execute($params);
        $stmt = $pdo->prepare(
            'SELECT t.*, b.`name` AS brand_name
             FROM `content_templates` t LEFT JOIN `brands` b ON b.`id` = t.`brand_id`
             WHERE t.`id` = ?'
        );
        $stmt->execute([$id]);
        audit_log($pdo, $user['id'], 'templates.updated', 'template', $id, [
            'brand_id' => $brandId, 'category' => (string) ($in['category'] ?? ''),
        ]);
        respond(template_shape($stmt->fetch()));
    }

    if ($method === 'DELETE') {
        require_super_admin($user);
        if ($existingBrand !== null && !can_access_brand($user, $existingBrand)) {
            fail('No access to that template.', 403);
        }
        $pdo->prepare('DELETE FROM `content_templates` WHERE `id` = ?')->execute([$id]);
        audit_log($pdo, $user['id'], 'templates.deleted', 'template', $id, []);
        respond(['success' => true]);
    }

    fail('Method not allowed.', 405);
} catch (Throwable $e) {
    fail($e->getMessage());
}