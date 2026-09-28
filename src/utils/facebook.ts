// Facebook connection verification (see api/facebook_verify.php).
//
// The channel form collects a Page ID plus a token that is normally a *user*
// token. That works for publishing, but it cannot read the page, so a broken
// connection and a working one look identical. verifyFacebookChannel resolves
// the page-scoped token once and confirms the page is actually reachable, so the
// UI can store a reusable page token and show which page it resolved to.

const VERIFY_URL =
  import.meta.env.VITE_FACEBOOK_VERIFY_URL ||
  (import.meta.env.VITE_PUBLISH_PROXY_URL || "").replace(/publish\.php.*$/, "facebook_verify.php");

export interface FacebookChannelConfig {
  pageId?: string;
  accessToken?: string;
  appId?: string;
  appSecret?: string;
}

export interface FacebookVerifyResult {
  success: boolean;
  message?: string;
  hint?: string;
  pageToken?: string;
  pageId?: string;
  pageName?: string;
  canPublish?: boolean;
  resolvedVia?: string;
}

export async function verifyFacebookChannel(config: FacebookChannelConfig): Promise<FacebookVerifyResult> {
  if (!VERIFY_URL) {
    return {
      success: false,
      message: "No Facebook verify endpoint configured.",
      hint: "Set VITE_FACEBOOK_VERIFY_URL to the URL of api/facebook_verify.php.",
    };
  }
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    const data = (await res.json().catch(() => ({}))) as FacebookVerifyResult;
    if (!res.ok) {
      return { success: false, message: data.message || `HTTP ${res.status}`, hint: data.hint };
    }
    return data;
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Network error",
      hint: "The app could not reach the Facebook verify endpoint (api/facebook_verify.php).",
    };
  }
}
