import type { Brand, ContentItem, Status, PlatformDef } from "@/types";

export const PUBLISHING_DEFS: PlatformDef[] = [
  {
    id: "woocommerce", name: "WooCommerce", icon: "🛒", color: "#7f54b3", bg: "#f5f0ff",
    desc: "Sync products, orders, and promotions with your store",
    fields: [
      { key: "storeUrl", label: "Store URL", placeholder: "https://yourstore.com", hint: "Your WooCommerce store root URL" },
      { key: "consumerKey", label: "Consumer Key", placeholder: "ck_xxxxxxxxxxxx", secret: true },
      { key: "consumerSecret", label: "Consumer Secret", placeholder: "cs_xxxxxxxxxxxx", secret: true },
    ],
    guide: { title: "Create WooCommerce REST API keys", steps: [
      { step: "Log in to your WordPress admin dashboard", detail: "Go to yourstore.com/wp-admin" },
      { step: "Navigate to WooCommerce → Settings" },
      { step: "Open the Advanced tab, then REST API" },
      { step: "Click 'Add key'", detail: "Give it a description like 'Content OS', set Permissions to Read/Write" },
      { step: "Click 'Generate API key'", detail: "Copy the Consumer Key and Consumer Secret immediately" },
      { step: "Paste both keys above", detail: "Also enter your store root URL" },
    ]},
  },
  {
    id: "facebook", name: "Facebook", icon: "🔵", color: "#1877f2", bg: "#e8f0fe",
    desc: "Publish to Pages, run ads, and read insights",
    fields: [
      { key: "pageId", label: "Page ID", placeholder: "123456789012345" },
      { key: "appId", label: "App ID", placeholder: "your-app-id" },
      { key: "appSecret", label: "App Secret", placeholder: "••••••••", secret: true },
      { key: "accessToken", label: "Page Access Token", placeholder: "EAA…", secret: true },
    ],
    guide: { title: "Create a Meta App and get a Page token", steps: [
      { step: "Go to Meta for Developers", url: "https://developers.facebook.com/apps", urlLabel: "developers.facebook.com/apps" },
      { step: "Create App → Business type, add Facebook Login & Pages API products" },
      { step: "Copy App ID and App Secret from Settings → Basic" },
      { step: "Find your Page ID in your Facebook Page → About" },
      { step: "Generate a long-lived Page Access Token via Graph API Explorer" },
      { step: "Ensure pages_manage_posts, pages_read_engagement scopes are included" },
    ]},
  },
  {
    id: "instagram", name: "Instagram", icon: "📸", color: "#e1306c", bg: "#fce4ec",
    desc: "Schedule posts, Reels, and Stories to your Business account",
    fields: [
      { key: "businessAccountId", label: "Business Account ID", placeholder: "17841400000000000" },
      { key: "accessToken", label: "Access Token", placeholder: "EAA…", secret: true },
    ],
    guide: { title: "Connect an Instagram Business account via Meta", steps: [
      { step: "Switch Instagram to a Business/Creator account" },
      { step: "Link Instagram to a Facebook Page" },
      { step: "Add Instagram Graph API product to your Meta App" },
      { step: "Generate access token with instagram_basic and instagram_content_publish scopes" },
      { step: "Find Business Account ID via GET /me/accounts" },
    ]},
  },
  {
    id: "x", name: "X (Twitter)", icon: "✖", color: "#000000", bg: "#f3f4f6",
    desc: "Post tweets, threads, and monitor brand mentions",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "xxxxxxxxxxxx", secret: true },
      { key: "apiSecret", label: "API Key Secret", placeholder: "xxxxxxxxxxxx", secret: true },
      { key: "accessToken", label: "Access Token", placeholder: "xxxxxxxxxxxx-xxx", secret: true },
      { key: "accessTokenSecret", label: "Access Token Secret", placeholder: "xxxxxxxxxxxx", secret: true },
    ],
    guide: { title: "Create an X Developer App", steps: [
      { step: "Apply for a Developer account", url: "https://developer.x.com/en/portal/dashboard", urlLabel: "developer.x.com" },
      { step: "Create Project + App, set permissions to Read and Write" },
      { step: "Copy API Key and API Key Secret (shown once)" },
      { step: "Generate Access Token and Secret from Keys and Tokens tab" },
      { step: "Basic tier ($100/mo) required to post via API v2" },
    ]},
  },
  {
    id: "linkedin", name: "LinkedIn", icon: "💼", color: "#0a66c2", bg: "#e8f0fe",
    desc: "Publish thought-leadership content to Company Pages",
    fields: [
      { key: "organizationId", label: "Organization ID", placeholder: "12345678" },
      { key: "clientId", label: "Client ID", placeholder: "xxxxxxxxxxxxxxxx" },
      { key: "clientSecret", label: "Client Secret", placeholder: "••••••••", secret: true },
      { key: "accessToken", label: "Access Token", placeholder: "AQX…", secret: true },
    ],
    guide: { title: "Create a LinkedIn Developer App", steps: [
      { step: "Go to LinkedIn Developer Portal", url: "https://www.linkedin.com/developers/apps/new", urlLabel: "linkedin.com/developers" },
      { step: "Create app linked to your Company Page" },
      { step: "Request Share on LinkedIn and Marketing Developer Platform products" },
      { step: "Copy Client ID and Client Secret from the Auth tab" },
      { step: "Find Organization ID in your Company Page URL" },
      { step: "Complete OAuth 2.0 flow for access token (60-day expiry)" },
    ]},
  },
  {
    id: "tiktok", name: "TikTok", icon: "🎵", color: "#fe2c55", bg: "#fff0f0",
    desc: "Upload videos and track TikTok performance data",
    fields: [
      { key: "clientKey", label: "Client Key", placeholder: "aw…" },
      { key: "clientSecret", label: "Client Secret", placeholder: "••••••••", secret: true },
      { key: "accessToken", label: "Access Token", placeholder: "act.xxx", secret: true },
    ],
    guide: { title: "Create a TikTok for Developers App", steps: [
      { step: "Apply for TikTok for Business", url: "https://developers.tiktok.com", urlLabel: "developers.tiktok.com" },
      { step: "Create app, enable Content Posting API and Research API" },
      { step: "Copy Client Key and Client Secret from app overview" },
      { step: "Complete OAuth 2.0 to get Access Token" },
    ]},
  },
  {
    id: "youtube", name: "YouTube", icon: "▶", color: "#ff0000", bg: "#fff0f0",
    desc: "Upload videos and manage your YouTube channel",
    fields: [
      { key: "channelId", label: "Channel ID", placeholder: "UCxxxxxxxxxxxxxxxxxxxxxxxx" },
      { key: "apiKey", label: "API Key", placeholder: "AIzaSy…", secret: true },
      { key: "clientId", label: "OAuth Client ID", placeholder: "xxxx.apps.googleusercontent.com" },
      { key: "clientSecret", label: "OAuth Client Secret", placeholder: "GOCSPX-…", secret: true },
    ],
    guide: { title: "Set up the YouTube Data API v3", steps: [
      { step: "Go to Google Cloud Console", url: "https://console.cloud.google.com", urlLabel: "console.cloud.google.com" },
      { step: "Enable YouTube Data API v3, create API Key and OAuth 2.0 credentials" },
      { step: "Find Channel ID in YouTube Studio → Settings → Channel → Advanced" },
      { step: "Complete OAuth flow for access_token and refresh_token" },
    ]},
  },
  {
    id: "pinterest", name: "Pinterest", icon: "📌", color: "#e60023", bg: "#fff0f0",
    desc: "Schedule Pins and boards for visual discovery",
    fields: [
      { key: "appId", label: "App ID", placeholder: "123456" },
      { key: "appSecret", label: "App Secret", placeholder: "••••••••", secret: true },
      { key: "accessToken", label: "Access Token", placeholder: "pina_…", secret: true },
    ],
    guide: { title: "Create a Pinterest App", steps: [
      { step: "Go to Pinterest Developer portal", url: "https://developers.pinterest.com/apps/", urlLabel: "developers.pinterest.com" },
      { step: "Create app, request boards:read/write and pins:read/write scopes" },
      { step: "Copy App ID and App Secret" },
      { step: "Complete OAuth 2.0 Authorization Code flow for Access Token" },
    ]},
  },
  {
    id: "devto", name: "Dev.to", icon: "👾", color: "#3b49df", bg: "#eef0ff",
    desc: "Auto-publish technical articles to the dev community",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "xxxxxxxxxxxxxxxxxxxx", secret: true },
    ],
    guide: { title: "Generate a Dev.to API key", steps: [
      { step: "Log in to your Dev.to account", url: "https://dev.to/enter", urlLabel: "dev.to/enter" },
      { step: "Settings → Account → DEV Community API Keys" },
      { step: "Enter a description and click Generate API Key" },
      { step: "Copy the key immediately — it is only displayed once" },
    ]},
  },
];

export const PLATFORM_NAME_MAP: Record<string, string> = {
  "Facebook": "facebook", "Instagram": "instagram", "X": "x", "LinkedIn": "linkedin",
  "TikTok": "tiktok", "YouTube": "youtube", "Pinterest": "pinterest", "Dev.to": "devto", "WooCommerce": "woocommerce",
};

export const SEED_BRANDS: Brand[] = [
  { id:1, name:"TravelEase",  industry:"Travel",            color:"#0ea5e9", tagline:"Affordable travel without compromising convenience",  tone:["Friendly","Inspiring","Trustworthy"],            audience:"Travelers, families, business professionals",     pillars:[{name:"Travel Tips",weight:30},{name:"Destinations",weight:25},{name:"Deals",weight:20},{name:"Stories",weight:15},{name:"Community",weight:10}], platforms:["Facebook","Instagram","X","LinkedIn","TikTok"],  channels:[], ideas:12,drafts:8, review:4,scheduled:21,posts_month:52 },
  { id:2, name:"FitLife Pro", industry:"Fitness",           color:"#f97316", tagline:"Transform your body, transform your life",             tone:["Energetic","Motivating","Scientific"],           audience:"Fitness enthusiasts, 25–45, health-conscious",    pillars:[{name:"Workouts",weight:35},{name:"Nutrition",weight:25},{name:"Motivation",weight:20},{name:"Products",weight:15},{name:"Community",weight:5}],  platforms:["Instagram","TikTok","YouTube","Facebook"],       channels:[], ideas:9, drafts:6, review:3,scheduled:18,posts_month:44 },
  { id:3, name:"GreenBite",   industry:"Food & Wellness",   color:"#10b981", tagline:"Eat clean, live green, feel great",                   tone:["Warm","Educational","Approachable"],             audience:"Health-conscious millennials, vegans, parents",   pillars:[{name:"Recipes",weight:35},{name:"Nutrition",weight:25},{name:"Lifestyle",weight:20},{name:"Products",weight:10},{name:"Deals",weight:10}],    platforms:["Instagram","Pinterest","TikTok","Facebook"],     channels:[], ideas:11,drafts:7, review:2,scheduled:24,posts_month:60 },
  { id:4, name:"TechNova",    industry:"SaaS / Technology", color:"#8b5cf6", tagline:"Building the infrastructure of tomorrow",              tone:["Professional","Authoritative","Forward-thinking"],audience:"CTOs, developers, startup founders",              pillars:[{name:"Insights",weight:30},{name:"Product",weight:25},{name:"Engineering",weight:20},{name:"Case studies",weight:15},{name:"Community",weight:10}], platforms:["LinkedIn","X","Dev.to","YouTube"],               channels:[], ideas:8, drafts:5, review:3,scheduled:14,posts_month:32 },
  { id:5, name:"LuxStay",     industry:"Hospitality",       color:"#ec4899", tagline:"Where luxury meets authentic experiences",             tone:["Elegant","Aspirational","Personal"],             audience:"Affluent travelers, 35–60, experience seekers",   pillars:[{name:"Experiences",weight:30},{name:"Properties",weight:25},{name:"Lifestyle",weight:25},{name:"Offers",weight:10},{name:"Stories",weight:10}],  platforms:["Instagram","Facebook","LinkedIn","Pinterest"],   channels:[], ideas:8, drafts:6, review:2,scheduled:9, posts_month:28 },
];

export const SEED_CONTENT: ContentItem[] = [
  { id:1827,brand:"TravelEase", brandColor:"#0ea5e9",campaign:"Summer Promotion", pillar:"Promotional",platform:"Instagram",status:"review",      caption:"✈️ Summer is calling — and we're making it affordable. Book your dream trip today and save up to 40% on select destinations. Limited time offer!", hashtags:"#travel #summer #deals #wanderlust",              scheduled:"Sep 4, 2026 — 7:30 PM",  format:"Carousel",score:87},
  { id:1826,brand:"FitLife Pro",brandColor:"#f97316",campaign:"Back to Routine",  pillar:"Motivation", platform:"TikTok",    status:"scheduled",   caption:"September reset starts NOW. 30 days. One commitment. Your best self. Drop a 💪 if you're in.",                                                           hashtags:"#fitness #september #motivation #fitlife",        scheduled:"Sep 1, 2026 — 6:00 AM",  format:"Video",   score:92},
  { id:1825,brand:"GreenBite",  brandColor:"#10b981",campaign:"Fall Recipes",     pillar:"Recipes",    platform:"Instagram", status:"draft",        caption:"🍂 5 cozy autumn recipes that are actually good for you. Swipe to see our butternut squash soup that's getting everyone obsessed.",                     hashtags:"#healthyfood #fallrecipes #vegan #greenbite",     scheduled:"Sep 3, 2026 — 12:00 PM", format:"Carousel",score:78},
  { id:1824,brand:"TechNova",   brandColor:"#8b5cf6",campaign:"Q3 Insights",      pillar:"Insights",   platform:"LinkedIn",  status:"scheduled",   caption:"We analyzed 10,000 engineering teams. The #1 bottleneck isn't code — it's deployment confidence. Here's what the data shows:",                         hashtags:"#engineering #devops #saas #technova",            scheduled:"Sep 2, 2026 — 9:00 AM",  format:"Article", score:94},
  { id:1823,brand:"LuxStay",    brandColor:"#ec4899",campaign:"Weekend Getaway",  pillar:"Experiences",platform:"Instagram", status:"approved",    caption:"Some places deserve more than a weekend. But for now, this will do. 🌊 Our Maldives overwater suite is open for September.",                          hashtags:"#luxury #travel #maldives #luxstay",              scheduled:"Sep 5, 2026 — 8:00 PM",  format:"Image",   score:89},
  { id:1822,brand:"TravelEase", brandColor:"#0ea5e9",campaign:"Flight Deals",     pillar:"Deals",      platform:"Facebook",  status:"published",   caption:"5 ways to save money on your next international flight ✈️",                                                                                            hashtags:"#travel #flights #savemoney #budgettravel",       scheduled:"Aug 28, 2026 — 7:00 PM", format:"Post",    score:81},
  { id:1821,brand:"FitLife Pro",brandColor:"#f97316",campaign:"Back to Routine",  pillar:"Workouts",   platform:"Instagram", status:"ai_generated",caption:"Morning routine that hits every muscle group in 20 minutes. No excuses, no equipment needed. Follow for daily workouts 🔥",                            hashtags:"#workout #morningroutine #fitness #noequipment",  scheduled:"Sep 6, 2026 — 7:00 AM",  format:"Reel",    score:85},
  { id:1820,brand:"GreenBite",  brandColor:"#10b981",campaign:"Fall Recipes",     pillar:"Nutrition",  platform:"TikTok",    status:"ai_generated",caption:"POV: You just discovered that sweet potatoes have more potassium than bananas 🍠 Here's what to cook with them this fall",                           hashtags:"#nutrition #healthyfacts #sweetpotato #greenbite",scheduled:"Sep 7, 2026 — 3:00 PM",  format:"Video",   score:76},
];

export const CALENDAR_DATA: Record<string, Record<string, { color: string; format: string }[]>> = {
  Mon:{IG:[{color:"#ec4899",format:"Reel"}],   FB:[],                               X:[{color:"#374151",format:"Thread"}],LI:[],                                TT:[{color:"#10b981",format:"Video"}]},
  Tue:{IG:[{color:"#0ea5e9",format:"Carousel"}],FB:[{color:"#0ea5e9",format:"Post"}],X:[],                                LI:[{color:"#8b5cf6",format:"Article"}],TT:[]},
  Wed:{IG:[],                                  FB:[{color:"#f97316",format:"Reel"}],X:[{color:"#f97316",format:"Post"}], LI:[{color:"#8b5cf6",format:"Post"}],  TT:[{color:"#ec4899",format:"Video"}]},
  Thu:{IG:[{color:"#10b981",format:"Story"}],  FB:[],                               X:[],                                LI:[],                                TT:[{color:"#0ea5e9",format:"Video"}]},
  Fri:{IG:[{color:"#ec4899",format:"Image"}],  FB:[{color:"#10b981",format:"Post"}],X:[{color:"#374151",format:"Post"}],LI:[{color:"#8b5cf6",format:"Article"}],TT:[]},
  Sat:{IG:[{color:"#f97316",format:"Carousel"}],FB:[{color:"#f97316",format:"Post"}],X:[],                               LI:[],                                TT:[{color:"#10b981",format:"Video"}]},
  Sun:{IG:[],                                  FB:[],                               X:[{color:"#0ea5e9",format:"Post"}], LI:[],                                TT:[{color:"#ec4899",format:"Video"}]},
};

export const APPROVAL_TABLE = [
  {type:"General tips",level:"auto"},{type:"Inspirational posts",level:"auto"},{type:"Evergreen blogs",level:"auto"},
  {type:"Product information",level:"review"},{type:"Promotions",level:"review"},
  {type:"Pricing",level:"human"},{type:"Legal claims",level:"human"},{type:"Sensitive topics",level:"human"},
];

export const ANALYTICS_TOPICS = [
  {name:"Travel Tips",engagement:8.2},{name:"Destinations",engagement:6.9},{name:"Deals",engagement:5.4},
  {name:"Inspiration",engagement:4.1},{name:"Generic quotes",engagement:1.2},
];

export const ALL_PLATFORMS = ["Facebook","Instagram","X","LinkedIn","TikTok","YouTube","Pinterest","Dev.to"];
export const ALL_FORMATS = ["Post","Carousel","Reel","Video","Image","Article","Thread","Story"];
export const ALL_STATUSES: Status[] = ["ai_generated","draft","review","approved","scheduled","published"];
export const BRAND_COLORS = ["#0ea5e9","#f97316","#10b981","#8b5cf6","#ec4899","#ef4444","#f59e0b","#06b6d4","#84cc16","#6366f1"];
export const AVATAR_COLORS = ["#6366f1","#7c3aed","#0ea5e9","#10b981","#f97316","#ec4899","#f59e0b","#ef4444","#8b5cf6","#06b6d4"];
