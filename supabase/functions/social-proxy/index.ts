import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProxyRequest {
  platform: string;
  config: Record<string, string>;
  content: {
    caption: string;
    hashtags: string;
    campaign?: string;
    pillar?: string;
  };
}

async function handleDevTo(config: Record<string, string>, content: ProxyRequest["content"]) {
  const tags = content.hashtags
    .split(/\s+/)
    .filter((h: string) => h.startsWith("#"))
    .slice(0, 4)
    .map((h: string) => h.slice(1).replace(/[^a-z0-9]/gi, "").toLowerCase());

  const res = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: { "api-key": config.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      article: {
        title: content.campaign || content.pillar || "New Post",
        body_markdown: `${content.caption}\n\n${content.hashtags}`,
        published: true,
        tags,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { success: true, message: `Published to Dev.to — Article #${data.id}` };
}

async function handleWooCommerce(config: Record<string, string>, content: ProxyRequest["content"]) {
  const auth = btoa(`${config.consumerKey}:${config.consumerSecret}`);
  const storeUrl = config.storeUrl.replace(/\/$/, "");

  const res = await fetch(`${storeUrl}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: content.campaign || content.pillar,
      content: `<p>${content.caption}</p><p>${content.hashtags}</p>`,
      status: "publish",
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { success: true, message: `Published to WooCommerce — Post #${data.id}` };
}

async function handleFacebook(config: Record<string, string>, content: ProxyRequest["content"]) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${config.pageId}/feed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `${content.caption}\n\n${content.hashtags}`,
        access_token: config.accessToken,
      }),
    }
  );

  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return { success: true, message: `Published to Facebook — Post ${data.id}` };
}

async function handleLinkedIn(config: Record<string, string>, content: ProxyRequest["content"]) {
  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: `urn:li:organization:${config.organizationId}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: `${content.caption}\n\n${content.hashtags}` },
          shareMediaCategory: "NONE",
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { success: true, message: "Published to LinkedIn" };
}

async function handleInstagram(config: Record<string, string>, content: ProxyRequest["content"]) {
  // Instagram requires a two-step process: create media object, then publish
  // Step 1: Create media container
  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${config.businessAccountId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: content.caption, // In real use, this would be an image URL
        caption: `${content.caption}\n\n${content.hashtags}`,
        access_token: config.accessToken,
      }),
    }
  );

  const containerData = await containerRes.json();
  if (!containerRes.ok || containerData.error) {
    throw new Error(containerData.error?.message || `HTTP ${containerRes.status}`);
  }

  // Step 2: Publish the container
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${config.businessAccountId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: config.accessToken,
      }),
    }
  );

  const publishData = await publishRes.json();
  if (!publishRes.ok || publishData.error) {
    throw new Error(publishData.error?.message || `HTTP ${publishRes.status}`);
  }

  return { success: true, message: `Published to Instagram — Post ${publishData.id}` };
}

async function handleTikTok(config: Record<string, string>, content: ProxyRequest["content"]) {
  // TikTok Content Posting API
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      post_info: {
        title: content.caption.slice(0, 150),
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: 0,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || data.message || `HTTP ${res.status}`);
  }

  return { success: true, message: `TikTok upload initialized — ${data.data?.publish_url || "use TikTok app to complete"}` };
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { platform, config, content }: ProxyRequest = await req.json();

    let result: { success: boolean; message: string };

    switch (platform) {
      case "devto":
        result = await handleDevTo(config, content);
        break;
      case "woocommerce":
        result = await handleWooCommerce(config, content);
        break;
      case "facebook":
        result = await handleFacebook(config, content);
        break;
      case "linkedin":
        result = await handleLinkedIn(config, content);
        break;
      case "instagram":
        result = await handleInstagram(config, content);
        break;
      case "tiktok":
        result = await handleTikTok(config, content);
        break;
      default:
        result = {
          success: false,
          message: `Platform "${platform}" is not supported for direct publishing. Use the platform's native app.`,
        };
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
