<?php
// ContentOS team API — SUPER ADMIN ONLY.
//
// GET    api/members.php                  all users with roles + brand memberships
// POST   api/members.php?action=grant     { user_id, brand_id, member_role? }  grant/change access
// POST   api/members.php?action=revoke    { user_id, brand_id }                remove access
// POST   api/members.php?action=set-role  { user_id, role }                    change global role
// GET    api/members.php?action=brands    id+name list of all brands (for the grant form)

require __DIR__ . '/bootstrap.php';
cors();

try {
    $pdo = db();
    $user = require_auth();
    require_super_admin($user);
    $action = $_GET['action'] ?? body()['action'] ?? '';
    $in = body();

    if ($action === 'brands' || ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === '')) {
        if ($action === 'brands') {
            $rows = $pdo->query('SELECT `id`, `name` FROM `brands` ORDER BY `name`')->fetchAll();
            respond(array_map(fn($r) => ['id' => (int) $r['id'], 'name' => $r['name']], $rows));
        }
        $users = $pdo->query(
            'SELECT u.`id`, u.`email`, u.`name`, u.`avatar_color`, r.`slug` AS `role`, u.`created_at`
             FROM `users` u JOIN `roles` r ON r.`id` = u.`role_id`
             ORDER BY u.`created_at`'
        )->fetchAll();
        $out = [];
        foreach ($users as $u) {
            $stmt = $pdo->prepare(
                'SELECT m.`brand_id`, b.`name` AS `brand_name`, m.`member_role`
                 FROM `brand_members` m JOIN `brands` b ON b.`id` = m.`brand_id`
                 WHERE m.`user_id` = ? ORDER BY b.`name`'
            );
            $stmt->execute([$u['id']]);
            $out[] = [
                'id' => $u['id'],
                'email' => $u['email'],
                'name' => $u['name'],
                'avatarColor' => $u['avatar_color'],
                'role' => role_label($u['role']),
                'roleSlug' => $u['role'],
                'seesAll' => false,
                'createdAt' => $u['created_at'],
                'brands' => array_map(fn($m) => [
                    'brandId' => (int) $m['brand_id'],
                    'brandName' => $m['brand_name'],
                    'memberRole' => $m['member_role'],
                ], $stmt->fetchAll()),
            ];
            if ($u['role'] === 'super_admin') $out[count($out) - 1]['seesAll'] = true;
        }
        respond($out);
    }

    if ($action === 'grant') {
        $userId = (string) ($in['user_id'] ?? '');
        $brandId = (int) ($in['brand_id'] ?? 0);
        $memberRole = (string) ($in['member_role'] ?? 'owner');
        if (!in_array($memberRole, ['owner', 'editor', 'viewer'], true)) $memberRole = 'owner';
        $chk = $pdo->prepare('SELECT 1 FROM `users` WHERE `id` = ?');
        $chk->execute([$userId]);
        if ($chk->fetchColumn() === false) fail('User not found.', 404);
        $chk = $pdo->prepare('SELECT 1 FROM `brands` WHERE `id` = ?');
        $chk->execute([$brandId]);
        if ($brandId <= 0 || $chk->fetchColumn() === false) fail('Brand not found.', 404);
        $pdo->prepare(
            "INSERT INTO `brand_members` (`brand_id`, `user_id`, `member_role`)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE `member_role` = VALUES(`member_role`)"
        )->execute([$brandId, $userId, $memberRole]);
        respond(['success' => true]);
    }

    if ($action === 'revoke') {
        $pdo->prepare('DELETE FROM `brand_members` WHERE `brand_id` = ? AND `user_id` = ?')
            ->execute([(int) ($in['brand_id'] ?? 0), (string) ($in['user_id'] ?? '')]);
        respond(['success' => true]);
    }

    if ($action === 'set-role') {
        $userId = (string) ($in['user_id'] ?? '');
        $slug = strtolower(str_replace(' ', '_', trim((string) ($in['role'] ?? ''))));
        $rid = role_id($pdo, $slug);
        if ($rid === null) fail('Unknown role.', 400);
        if ($userId === $user['id'] && $slug !== 'super_admin') {
            fail('You cannot remove your own super admin role.', 400);
        }
        $stmt = $pdo->prepare('UPDATE `users` SET `role_id` = ? WHERE `id` = ?');
        $stmt->execute([$rid, $userId]);
        if ($stmt->rowCount() === 0) fail('User not found.', 404);
        respond(['success' => true]);
    }

    fail('Unknown action.', 404);
} catch (Throwable $e) {
    fail($e->getMessage());
}
