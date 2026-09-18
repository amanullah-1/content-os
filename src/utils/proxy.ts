// Local PHP proxy (api/publish.php) takes precedence when configured,
// otherwise falls back to the Supabase Edge Function.
const PROXY_BASE =
  import.meta.env.VITE_PUBLISH_PROXY_URL ||
  import.meta.env.VITE_SUPABASE_PROXY_URL ||
  "https://rssvhitxlyfpysxqkwff.supabase.co/functions/v1/social-proxy";

interface ProxyPayload {
  platform: string;
  config: Record<string, string>;
  content: {
    caption: string;
    hashtags: string;
    campaign?: string;
    pillar?: string;
  };
}

interface ProxyResult {
  success: boolean;
  message: string;
}

export async function proxyPublish(payload: ProxyPayload): Promise<ProxyResult> {
  try {
    const res = await fetch(PROXY_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, message: `Proxy error: HTTP ${res.status}${text ? ` — ${text.slice(0, 100)}` : ""}` };
    }

    return await res.json() as ProxyResult;
  } catch (error) {
    return {
      success: false,
      message: `Proxy unreachable: ${error instanceof Error ? error.message : "Network error"}. Check your publish proxy (local PHP API or Supabase edge function).`,
    };
  }
}

// Platforms that MUST use the proxy (CORS-blocked from browser)
export const PROXY_REQUIRED_PLATFORMS = new Set([
  "facebook",
  "instagram",
  "linkedin",
  "woocommerce",
  "tiktok",
  "youtube",
  "pinterest",
]);

// Platforms that can work directly from browser
export const DIRECT_PLATFORMS = new Set(["devto"]);

export function shouldUseProxy(platformId: string): boolean {
  return PROXY_REQUIRED_PLATFORMS.has(platformId);
}
