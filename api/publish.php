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

$SUPPORTED = ['devto', 'woocommerce', 'facebook', 'linkedin', 'instagram', 'tiktok', 'x'];

// Graph API version used for Facebook/Instagram. v19.0 is end-of-life, so the
// default is v23.0. Override with CONTENTOS_FB_GRAPH_VERSION (e.g. 'v22.0').
$GRAPH = getenv('CONTENTOS_FB_GRAPH_VERSION') ?: 'v23.0';

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

/**
 * Exchange a long-lived *user* token for a *page* token.
 *
 * Graph rejects page writes made with a plain user token (error #200) even when
 * the user has pages_manage_posts, so every page-scoped call has to be made with
 * the page token. Returns '' when the page cannot be reached with this token.
 */
function facebook_page_token(string $pageId, string $token): string
{
    global $GRAPH;
    static $cache = [];
    $memo = $pageId . '|' . substr($token, -8);
    if (isset($cache[$memo])) return $cache[$memo];

    [$status, $data, $err] = http_json(
        'GET',
        "https://graph.facebook.com/$GRAPH/$pageId?fields=access_token&access_token=" . rawurlencode($token),
        [],
        null
    );
    if ($err !== '' || $status < 200 || $status >= 300) return '';

    $pageToken = (string) ($data['access_token'] ?? '');
    $cache[$memo] = $pageToken;
    return $pageToken;
}

/**
 * POST to /{pageId}/feed, transparently swapping a user token for a page token
 * when Graph rejects the write with #200.
 */
function facebook_feed(string $pageId, string $token, string $message): array
{
    global $GRAPH;
    $url = "https://graph.facebook.com/$GRAPH/$pageId/feed";
    $body = ['message' => $message, 'access_token' => $token];

    [$status, $data, $err] = http_json('POST', $url, ['Content-Type: application/json'], $body);
    if ($err === '' && $status >= 200 && $status < 300 && !isset($data['error'])) {
        return $data;
    }
    if ($err !== '') return ['error' => ['message' => $err, 'code' => 0]];

    $code = (int) ($data['error']['code'] ?? 0);
    $subcode = (int) ($data['error']['error_subcode'] ?? 0);
    // #200 = page write needs a page token; #10/#190 = page not authorised.
    if (!in_array($code, [10, 190, 200], true) || $subcode === 33) return $data;

    $pageToken = facebook_page_token($pageId, $token);
    if ($pageToken === '') return $data; // give up with the original error

    [$status, $data, $err] = http_json('POST', $url, ['Content-Type: application/json'], [
        'message' => $message,
        'access_token' => $pageToken,
    ]);
    if ($err !== '') return ['error' => ['message' => $err, 'code' => 0]];
    return $data;
}

function handle_facebook(array $config, array $content): array
{
    $data = facebook_feed(
        (string) ($config['pageId'] ?? ''),
        (string) ($config['accessToken'] ?? ''),
        $content['caption'] . "\n\n" . $content['hashtags']
    );
    if (isset($data['error'])) {
        fail(($data['error']['message'] ?? null) ?: 'Unknown Graph error');
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
        "https://graph.facebook.com/$GRAPH/{$account}/media",
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
        "https://graph.facebook.com/$GRAPH/{$account}/media_publish",
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

/**
 * Build a Twitter/X API v2 OAuth 1.0a Authorization header.
 * https://developer.x.com/en/docs/authentication/oauth-1-0a/obtaining-user-access-tokens
 */
function x_oauth_header(array $config, string $method, string $url, array $params = []): array
{
    $ts = (string) time();
    $oauth = [
        'oauth_consumer_key' => $config['apiKey'] ?? '',
        'oauth_nonce' => bin2hex(random_bytes(16)),
        'oauth_signature_method' => 'HMAC-SHA1',
        'oauth_timestamp' => $ts,
        'oauth_token' => $config['accessToken'] ?? '',
        'oauth_version' => '1.0',
    ];
    $all = array_merge($params, $oauth);
    uksort($all, 'strcmp');
    $parts = [];
    foreach ($all as $k => $v) {
        $parts[] = rawurlencode($k) . '=' . rawurlencode((string) $v);
    }
    $base = strtoupper($method) . '&' . rawurlencode($url) . '&' . rawurlencode(implode('&', $parts));
    $key = rawurlencode($config['apiSecret'] ?? '') . '&' . rawurlencode($config['accessTokenSecret'] ?? '');
    $oauth['oauth_signature'] = base64_encode(hash_hmac('sha1', $base, $key, true));

    $headerParts = [];
    foreach ($oauth as $k => $v) {
        $headerParts[] = sprintf('%s="%s"', rawurlencode($k), rawurlencode((string) $v));
    }
    return ['Authorization: OAuth ' . implode(', ', $headerParts)];
}

function handle_x(array $config, array $content): array
{
    $text = trim($content['caption'] . "\n\n" . $content['hashtags']);
    if (mb_strlen($text) > 280) {
        $text = mb_substr($text, 0, 277) . '…';
    }
    $url = 'https://api.x.com/2/tweets';
    $headers = array_merge(
        ['Content-Type: application/json'],
        x_oauth_header($config, 'POST', $url)
    );
    [$status, $data, $err] = http_json('POST', $url, $headers, ['text' => $text]);
    if ($err !== '') fail($err);
    if ($status < 200 || $status >= 300) {
        $msg = $data['detail'] ?? $data['title'] ?? null;
        if (isset($data['errors'][0]['message']) || isset($data['errors'][0]['detail'])) {
            $msg = $data['errors'][0]['detail'] ?? $data['errors'][0]['message'];
        } elseif (isset($data['errors'][0]['message'])) {
            $msg = $data['errors'][0]['message'];
        }
        fail(($msg ?? '') ? $msg : "HTTP $status");
    }
    return ok('Published to X — Tweet ID ' . ($data['data']['id'] ?? '?'));
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
    case 'x':           $result = handle_x($config, $content); break;
    default:
        http_response_code(200);
        echo json_encode([
            'success' => false,
            'message' => "Platform \"$platform\" is not supported for direct publishing. Use the platform's native app.",
        ]);
        exit;
}

echo json_encode($result);
