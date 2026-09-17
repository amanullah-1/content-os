<?php
// ContentOS local publish proxy — PHP port of supabase/functions/social-proxy/index.ts.
//
// Why this exists: browsers block cross-origin API calls to most social
// platforms (CORS), so the frontend POSTs to this same-origin proxy instead.
//
// Contract (see src/utils/proxy.ts):
//   POST JSON { platform, config, content: { caption, hashtags, campaign?, pillar? } }
//     -> 200 { success: true,  message: "..." }  on published
//     -> 200 { success: false, message: "..." }  for unsupported platforms
//     -> 500 { success: false, message: "..." }  on upstream / transport errors
//   GET -> 200 { ok: true, platforms: [...] } (health check)

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$SUPPORTED = ['devto', 'woocommerce', 'facebook', 'linkedin', 'instagram', 'tiktok'];

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(['ok' => true, 'platforms' => $SUPPORTED]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

if (!function_exists('curl_init')) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'PHP cURL extension is not enabled']);
    exit;
}

/**
 * POST/GET JSON over cURL. Returns [httpStatus, decodedBody, curlError].
 * @return array{0:int,1:mixed,2:string}
 */
function http_json(string $method, string $url, array $headers, $body = null): array
{
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 25);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body));
    }
    $raw = curl_exec($ch);
    $err = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $decoded = json_decode((string) $raw, true);
    return [$status, $decoded, $err === '' ? '' : $err];
}

/** @return never */
function fail(string $message): void
{
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => $message]);
    exit;
}

/** @return array{success:bool,message:string} */
function ok(string $message): array
{
    return ['success' => true, 'message' => $message];
}

function devto_tags(string $hashtags): array
{
    $tags = [];
    foreach (preg_split('/\s+/', trim($hashtags)) as $h) {
        if (strpos($h, '#') !== 0) continue;
        $t = strtolower((string) preg_replace('/[^a-z0-9]/i', '', substr($h, 1)));
        if ($t !== '') $tags[] = $t;
        if (count($tags) >= 4) break;
    }
    return $tags;
}

function handle_devto(array $config, array $content): array
{
    [$status, $data, $err] = http_json('POST', 'https://dev.to/api/articles', [
        'Content-Type: application/json',
        'api-key: ' . ($config['apiKey'] ?? ''),
    ], ['article' => [
        'title' => $content['campaign'] ?? $content['pillar'] ?? 'New Post',
        'body_markdown' => $content['caption'] . "\n\n" . $content['hashtags'],
        'published' => true,
        'tags' => devto_tags($content['hashtags']),
    ]]);
    if ($err !== '') fail($err);
    if ($status < 200 || $status >= 300) fail(($data['error'] ?? null) ?: "HTTP $status");
    return ok('Published to Dev.to — Article #' . ($data['id'] ?? '?'));
}

function handle_woocommerce(array $config, array $content): array
{
    $auth = base64_encode(($config['consumerKey'] ?? '') . ':' . ($config['consumerSecret'] ?? ''));
    $storeUrl = rtrim($config['storeUrl'] ?? '', '/');
    [$status, $data, $err] = http_json('POST', $storeUrl . '/wp-json/wp/v2/posts', [
        'Content-Type: application/json',
        'Authorization: Basic ' . $auth,
    ], [
        'title' => $content['campaign'] ?? $content['pillar'] ?? 'New Post',
        'content' => '<p>' . $content['caption'] . '</p><p>' . $content['hashtags'] . '</p>',
        'status' => 'publish',
    ]);
    if ($err !== '') fail($err);
    if ($status < 200 || $status >= 300) fail("HTTP $status");
    return ok('Published to WooCommerce — Post #' . ($data['id'] ?? '?'));
}

function handle_facebook(array $config, array $content): array
{
    [$status, $data, $err] = http_json(
        'POST',
        'https://graph.facebook.com/v19.0/' . ($config['pageId'] ?? '') . '/feed',
        ['Content-Type: application/json'],
        [
            'message' => $content['caption'] . "\n\n" . $content['hashtags'],
            'access_token' => $config['accessToken'] ?? '',
        ]
    );
    if ($err !== '') fail($err);
    if ($status < 200 || $status >= 300 || isset($data['error'])) {
        fail(($data['error']['message'] ?? null) ?: "HTTP $status");
    }
    return ok('Published to Facebook — Post ' . ($data['id'] ?? '?'));
}

function handle_linkedin(array $config, array $content): array
{
    [$status, $data, $err] = http_json('POST', 'https://api.linkedin.com/v2/ugcPosts', [
        'Content-Type: application/json',
        'Authorization: Bearer ' . ($config['accessToken'] ?? ''),
        'X-Restli-Protocol-Version: 2.0.0',
    ], [
        'author' => 'urn:li:organization:' . ($config['organizationId'] ?? ''),
        'lifecycleState' => 'PUBLISHED',
        'specificContent' => [
            'com.linkedin.ugc.ShareContent' => [
                'shareCommentary' => ['text' => $content['caption'] . "\n\n" . $content['hashtags']],
                'shareMediaCategory' => 'NONE',
            ],
        ],
        'visibility' => ['com.linkedin.ugc.MemberNetworkVisibility' => 'PUBLIC'],
    ]);
    if ($err !== '') fail($err);
    if ($status < 200 || $status >= 300) fail("HTTP $status");
    return ok('Published to LinkedIn');
}

function handle_instagram(array $config, array $content): array
{
    $account = $config['businessAccountId'] ?? '';
    $token = $config['accessToken'] ?? '';
    // Step 1: create media container.
    [$status, $data, $err] = http_json(
        'POST',
        "https://graph.facebook.com/v19.0/{$account}/media",
        ['Content-Type: application/json'],
        [
            'image_url' => $content['caption'],
            'caption' => $content['caption'] . "\n\n" . $content['hashtags'],
            'access_token' => $token,
        ]
    );
    if ($err !== '') fail($err);
    if ($status < 200 || $status >= 300 || isset($data['error'])) {
        fail(($data['error']['message'] ?? null) ?: "HTTP $status");
    }
    // Step 2: publish the container.
    [$pStatus, $pData, $pErr] = http_json(
        'POST',
        "https://graph.facebook.com/v19.0/{$account}/media_publish",
        ['Content-Type: application/json'],
        ['creation_id' => $data['id'] ?? '', 'access_token' => $token]
    );
    if ($pErr !== '') fail($pErr);
    if ($pStatus < 200 || $pStatus >= 300 || isset($pData['error'])) {
        fail(($pData['error']['message'] ?? null) ?: "HTTP $pStatus");
    }
    return ok('Published to Instagram — Post ' . ($pData['id'] ?? '?'));
}

function handle_tiktok(array $config, array $content): array
{
    [$status, $data, $err] = http_json('POST', 'https://open.tiktokapis.com/v2/post/publish/video/init/', [
        'Content-Type: application/json',
        'Authorization: Bearer ' . ($config['accessToken'] ?? ''),
    ], [
        'post_info' => [
            'title' => mb_substr($content['caption'], 0, 150),
            'privacy_level' => 'PUBLIC_TO_EVERYONE',
            'disable_duet' => false,
            'disable_comment' => false,
            'disable_stitch' => false,
        ],
        'source_info' => ['source' => 'FILE_UPLOAD', 'video_size' => 0],
    ]);
    if ($err !== '') fail($err);
    if ($status < 200 || $status >= 300 || isset($data['error'])) {
        fail(($data['error']['message'] ?? $data['message'] ?? null) ?: "HTTP $status");
    }
    return ok('TikTok upload initialized — ' . ($data['data']['publish_url'] ?? 'use TikTok app to complete'));
}

// --- Dispatch ---
$raw = file_get_contents('php://input');
$req = json_decode((string) $raw, true);
if (!is_array($req)) {
    fail('Body must be JSON like { "platform": ..., "config": {...}, "content": {...} }');
}

$platform = (string) ($req['platform'] ?? '');
$config = is_array($req['config'] ?? null) ? $req['config'] : [];
$content = is_array($req['content'] ?? null) ? $req['content'] : [];
$content['caption'] = (string) ($content['caption'] ?? '');
$content['hashtags'] = (string) ($content['hashtags'] ?? '');

switch ($platform) {
    case 'devto':       $result = handle_devto($config, $content); break;
    case 'woocommerce': $result = handle_woocommerce($config, $content); break;
    case 'facebook':    $result = handle_facebook($config, $content); break;
    case 'linkedin':    $result = handle_linkedin($config, $content); break;
    case 'instagram':   $result = handle_instagram($config, $content); break;
    case 'tiktok':      $result = handle_tiktok($config, $content); break;
    default:
        http_response_code(200);
        echo json_encode([
            'success' => false,
            'message' => "Platform \"$platform\" is not supported for direct publishing. Use the platform's native app.",
        ]);
        exit;
}

echo json_encode($result);
