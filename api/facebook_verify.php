<?php
// ContentOS Facebook connection check.
//
// The app does not run a Facebook Login dialog: the user pastes Page ID, App ID,
// App Secret and a long-lived token into Brands → Publishing Channels. That token
// is usually a *user* token, which is enough to publish (Graph accepts it for
// page writes) but NOT enough to read the page back — every feed read fails with
//
//   error 190 / subcode 2069032 "A Page access token is required for this call
//   for the new Pages experience."
//
// so a "connected" channel could never be verified, and a user token that had
// quietly lost pages_manage_posts looked identical to a working one.
//
// This endpoint resolves the page-scoped token once, verifies it can actually
// write to the page, and hands back a token the app can store and reuse.
//
// Contract (see src/utils/facebook.ts):
//   POST JSON { config: { pageId, accessToken, appId?, appSecret? } }
//     -> 200 { success: true, pageToken, pageId, pageName, canPublish }
//     -> 200 { success: false, message, hint? }

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}
if (!function_exists('curl_init')) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'cURL is not available on this server']);
    exit;
}

$GRAPH = getenv('CONTENTOS_FB_GRAPH_VERSION') ?: 'v23.0';

/** @return array{0:int,1:mixed,2:string} */
function http_json(string $method, string $url, array $headers = [], $body = null): array
{
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_TIMEOUT, 25);
    if ($headers) curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
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

$req = json_decode((string) file_get_contents('php://input'), true);
$config = is_array($req['config'] ?? null) ? $req['config'] : [];

$pageId = trim((string) ($config['pageId'] ?? ''));
$token = trim((string) ($config['accessToken'] ?? ''));
$appId = trim((string) ($config['appId'] ?? ''));
$appSecret = trim((string) ($config['appSecret'] ?? ''));

if ($pageId === '' || $token === '') {
    echo json_encode([
        'success' => false,
        'message' => 'Page ID and access token are both required.',
        'hint' => 'Paste the Page ID and a long-lived token into Brands → Publishing Channels first.',
    ]);
    exit;
}

/**
 * Exchange a long-lived user token for a page-scoped token.
 *
 * Preferred path is /me/accounts, but Meta returns an empty list for tokens
 * issued with per-page granular scopes, so fall back to the legacy
 * /{pageId}?fields=access_token lookup which still works for those tokens.
 */
function resolve_page_token(string $pageId, string $token, string $appId, string $appSecret, string $graph): array
{
    $longLived = $token;
    if ($appId !== '' && $appSecret !== '') {
        $q = http_json('GET', "https://graph.facebook.com/$graph/oauth/access_token?" . http_build_query([
            'grant_type' => 'fb_exchange_token',
            'client_id' => $appId,
            'client_secret' => $appSecret,
            'fb_exchange_token' => $token,
        ]));
        $exchanged = is_array($q[1]) ? (string) ($q[1]['access_token'] ?? '') : '';
        // fb_exchange_token returns a long-lived *user* token, not a page token.
        // It is still the better base for /me/accounts than the short-lived one.
        if ($exchanged !== '') $longLived = $exchanged;
    }

    foreach ([$longLived, $token] as $candidate) {
        $accounts = http_json('GET', "https://graph.facebook.com/$graph/me/accounts?" . http_build_query([
            'fields' => 'id,name,access_token',
            'limit' => '100',
            'access_token' => $candidate,
        ]));
        if ($accounts[2] === '' && is_array($accounts[1]) && !isset($accounts[1]['error'])) {
            foreach (($accounts[1]['data'] ?? []) as $page) {
                if ((string) ($page['id'] ?? '') === $pageId && !empty($page['access_token'])) {
                    return [(string) $page['access_token'], (string) ($page['name'] ?? ''), 'me_accounts'];
                }
            }
        }

        $direct = http_json('GET', "https://graph.facebook.com/$graph/$pageId?" . http_build_query([
            'fields' => 'access_token,id,name',
            'access_token' => $candidate,
        ]));
        if ($direct[2] === '' && is_array($direct[1]) && !isset($direct[1]['error'])) {
            $pageToken = (string) ($direct[1]['access_token'] ?? '');
            if ($pageToken !== '') {
                return [$pageToken, (string) ($direct[1]['name'] ?? ''), 'page_field'];
            }
        }
    }

    return ['', '', 'none'];
}

[$pageToken, $pageName, $via] = resolve_page_token($pageId, $token, $appId, $appSecret, $GRAPH);

if ($pageToken === '') {
    echo json_encode([
        'success' => false,
        'message' => 'Could not resolve a Page access token for this Page ID.',
        'hint' => 'The token needs pages_show_list, pages_read_engagement and pages_manage_posts for this page. '
            . 'Re-generate it in the Graph API Explorer with the Page selected, then paste it back in.',
    ]);
    exit;
}

// A page token is only useful if it can actually write. Probe with a metadata
// read rather than a real publish so verification never creates a post.
$probe = http_json('GET', "https://graph.facebook.com/$GRAPH/$pageId?" . http_build_query([
    'fields' => 'id,name,fan_count',
    'access_token' => $pageToken,
]));
$canPublish = $probe[2] === '' && is_array($probe[1]) && !isset($probe[1]['error']);
$pageName = $pageName !== '' ? $pageName : (string) ($probe[1]['name'] ?? '');

if (!$canPublish) {
    $message = is_array($probe[1]) ? (string) ($probe[1]['error']['message'] ?? 'Unknown Graph error') : 'Unknown Graph error';
    echo json_encode([
        'success' => false,
        'message' => 'Page token resolved but it cannot read the page: ' . $message,
        'hint' => 'The Page must grant the app access. Check the app is added to the Page and pages_manage_posts is granted.',
    ]);
    exit;
}

echo json_encode([
    'success' => true,
    'pageToken' => $pageToken,
    'pageId' => $pageId,
    'pageName' => $pageName,
    'canPublish' => $canPublish,
    'resolvedVia' => $via,
]);
