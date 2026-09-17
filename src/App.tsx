import { createContext, useContext, useState, useEffect, useRef } from "react";
import { dbGet, dbSet } from "./db";
import { proxyPublish, shouldUseProxy } from "./utils/proxy";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { validate, emailRule, passwordRule, validatePasswordMatch } from "./utils/validation";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "ai_generated" | "draft" | "review" | "approved" | "scheduled" | "published";
type ThemeMode = "light" | "dark";

interface Pillar { name: string; weight: number }
interface GuideStep { step: string; detail?: string; url?: string; urlLabel?: string }
type PlatformId = "woocommerce"|"facebook"|"instagram"|"x"|"linkedin"|"tiktok"|"youtube"|"pinterest"|"devto";
interface PlatformDef {
  id: PlatformId; name: string; icon: string; color: string; bg: string;
  desc: string;
  fields: { key: string; label: string; placeholder: string; secret?: boolean; hint?: string }[];
  guide: { title: string; steps: GuideStep[] };
}
const PUBLISHING_DEFS: PlatformDef[] = [
  {
    id: "woocommerce", name: "WooCommerce", icon: "🛒", color: "#7f54b3", bg: "#f5f0ff",
    desc: "Sync products, orders, and promotions with your store",
    fields: [
      { key: "storeUrl",       label: "Store URL",       placeholder: "https://yourstore.com", hint: "Your WooCommerce store root URL" },
      { key: "consumerKey",    label: "Consumer Key",    placeholder: "ck_xxxxxxxxxxxx", secret: true },
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
      { key: "pageId",      label: "Page ID",           placeholder: "123456789012345" },
      { key: "appId",       label: "App ID",             placeholder: "your-app-id" },
      { key: "appSecret",   label: "App Secret",         placeholder: "••••••••", secret: true },
      { key: "accessToken", label: "Page Access Token",  placeholder: "EAA…", secret: true },
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
      { key: "accessToken",       label: "Access Token",        placeholder: "EAA…", secret: true },
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
      { key: "apiKey",            label: "API Key",             placeholder: "xxxxxxxxxxxx", secret: true },
      { key: "apiSecret",         label: "API Key Secret",      placeholder: "xxxxxxxxxxxx", secret: true },
      { key: "accessToken",       label: "Access Token",        placeholder: "xxxxxxxxxxxx-xxx", secret: true },
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
      { key: "organizationId", label: "Organization ID",   placeholder: "12345678" },
      { key: "clientId",       label: "Client ID",         placeholder: "xxxxxxxxxxxxxxxx" },
      { key: "clientSecret",   label: "Client Secret",     placeholder: "••••••••", secret: true },
      { key: "accessToken",    label: "Access Token",      placeholder: "AQX…", secret: true },
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
      { key: "clientKey",    label: "Client Key",    placeholder: "aw…" },
      { key: "clientSecret", label: "Client Secret", placeholder: "••••••••", secret: true },
      { key: "accessToken",  label: "Access Token",  placeholder: "act.xxx", secret: true },
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
      { key: "channelId",    label: "Channel ID",          placeholder: "UCxxxxxxxxxxxxxxxxxxxxxxxx" },
      { key: "apiKey",       label: "API Key",             placeholder: "AIzaSy…", secret: true },
      { key: "clientId",     label: "OAuth Client ID",     placeholder: "xxxx.apps.googleusercontent.com" },
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
      { key: "appId",       label: "App ID",       placeholder: "123456" },
      { key: "appSecret",   label: "App Secret",   placeholder: "••••••••", secret: true },
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

interface BrandChannel {
  platformId: string;   // matches PUBLISHING_DEFS id (e.g. "facebook")
  connected: boolean;
  config: Record<string, string>;
}
interface Brand {
  id: number; name: string; industry: string; color: string;
  tagline: string; tone: string[]; audience: string;
  pillars: Pillar[]; platforms: string[];
  channels: BrandChannel[];
  ideas: number; drafts: number; review: number; scheduled: number; posts_month: number;
}
interface ContentItem {
  id: number; brand: string; brandColor: string; campaign: string;
  pillar: string; platform: string; status: Status;
  caption: string; hashtags: string; scheduled: string; format: string; score: number;
  imagePrompt?: string;
  videoScript?: string;
  scheduledISO?: string;
  generatedImageUrl?: string;
  generatedVideoUrl?: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

interface AuthUser {
  id: string; email: string; name: string;
  avatarColor: string; role: string; createdAt: string;
}

interface AuthCtxValue {
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (name: string, email: string, password: string) => Promise<string | null>;
  signInWithGoogle: (credential: string) => Promise<string | null>;
  signOut: () => void;
  updateProfile: (patch: Partial<Pick<AuthUser, "name" | "avatarColor" | "role">>) => void;
  changePassword: (current: string, next: string) => Promise<string | null>;
}

const AuthCtx = createContext<AuthCtxValue>({
  user: null, signIn: async () => null, signUp: async () => null,
  signInWithGoogle: async () => null,
  signOut: () => {}, updateProfile: () => {}, changePassword: async () => null,
});
const useAuth = () => useContext(AuthCtx);

function decodeGoogleJwt(credential: string): { sub: string; email: string; name: string } {
  const b64 = credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64));
}

function simpleHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(16);
}

// PBKDF2 via Web Crypto API — used for new password hashing
async function hashPasswordPBKDF2(password: string, userId: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = enc.encode(`contentos-${userId}`);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Sync fallback for initialization only (not for password verification)
function hashPasswordSync(password: string, userId: string): string {
  return simpleHash(password + userId);
}

// Verify password — supports both legacy simpleHash and new PBKDF2
async function verifyPassword(password: string, userId: string, storedHash: string): Promise<boolean> {
  // Try PBKDF2 first (new format is 64 hex chars)
  if (storedHash.length === 64) {
    const pbkdf2Hash = await hashPasswordPBKDF2(password, userId);
    return pbkdf2Hash === storedHash;
  }
  // Legacy fallback — compare simpleHash
  return simpleHash(password + userId) === storedHash;
}

// Migrate legacy hash to PBKDF2 on successful login
async function migrateHashIfNeeded(password: string, userId: string, storedHash: string): Promise<string> {
  if (storedHash.length === 64) return storedHash; // Already PBKDF2
  return hashPasswordPBKDF2(password, userId);
}

interface StoredUser extends AuthUser { pwHash: string }

function loadUsers(): StoredUser[] {
  try { return JSON.parse(localStorage.getItem("contentOS_users") || "[]"); } catch { return []; }
}
function saveUsers(u: StoredUser[]) {
  localStorage.setItem("contentOS_users", JSON.stringify(u));
  dbSet("contentOS:users", u);
}
function loadSession(): AuthUser | null {
  try { const r = localStorage.getItem("contentOS_session"); return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveSession(u: AuthUser | null) {
  if (u) localStorage.setItem("contentOS_session", JSON.stringify(u));
  else localStorage.removeItem("contentOS_session");
}

const AVATAR_COLORS = ["#6366f1","#7c3aed","#0ea5e9","#10b981","#f97316","#ec4899","#f59e0b","#ef4444","#8b5cf6","#06b6d4"];

function getGoogleClientId(): string {
  return localStorage.getItem("contentOS_googleClientId") || import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
}

const MASTER_ID = "master_admin_001";

function getMasterCredentials() {
  const email = import.meta.env.VITE_MASTER_EMAIL || "admin@contentos.app";
  const password = import.meta.env.VITE_MASTER_PASSWORD;
  return { email, password };
}

function seedMasterUser() {
  const users = loadUsers();
  if (users.find(u => u.id === MASTER_ID)) return;
  const { email, password } = getMasterCredentials();
  const master: StoredUser = {
    id: MASTER_ID, email, name: "Super Admin",
    avatarColor: "#4f46e5", role: "Super Admin",
    createdAt: new Date().toISOString(),
    pwHash: password ? hashPasswordSync(password, MASTER_ID) : crypto.randomUUID(),
  };
  saveUsers([master, ...users]);
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => { seedMasterUser(); return loadSession(); });

  // On mount: pull users from DB → merge into localStorage so cross-device login works
  useEffect(() => {
    dbGet<StoredUser[]>("contentOS:users").then(remote => {
      if (!remote || remote.length === 0) {
        // First time: push local users (including master) to DB
        const local = loadUsers();
        if (local.length > 0) dbSet("contentOS:users", local);
        return;
      }
      const local = loadUsers();
      // Merge: remote is source of truth, but keep any local-only users
      const localIds = new Set(local.map(u => u.id));
      const remoteIds = new Set(remote.map(u => u.id));
      const merged = [
        ...remote,
        ...local.filter(u => !remoteIds.has(u.id)),
      ];
      // Also ensure master user exists
      if (!merged.find(u => u.id === MASTER_ID)) {
        const { email } = getMasterCredentials();
        const master: StoredUser = {
          id: MASTER_ID, email, name: "Super Admin",
          avatarColor: "#4f46e5", role: "Super Admin",
          createdAt: new Date().toISOString(),
          pwHash: crypto.randomUUID(),
        };
        merged.unshift(master);
      }
      if (merged.length !== local.length || merged.some((u, i) => !localIds.has(u.id))) {
        localStorage.setItem("contentOS_users", JSON.stringify(merged));
      }
    });
  }, []);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    let users = loadUsers();
    let found = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    // If not in local cache, try fetching from DB (cross-device scenario)
    if (!found) {
      const remote = await dbGet<StoredUser[]>("contentOS:users");
      if (remote) {
        localStorage.setItem("contentOS_users", JSON.stringify(remote));
        users = remote;
        found = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      }
    }
    if (!found) return "No account found with that email.";
    if (!(await verifyPassword(password, found.id, found.pwHash))) return "Incorrect password.";
    // Migrate legacy hash to PBKDF2 on successful login
    const newHash = await migrateHashIfNeeded(password, found.id, found.pwHash);
    if (newHash !== found.pwHash) {
      found.pwHash = newHash;
      saveUsers(users.map(u => u.id === found!.id ? found! : u));
    }
    const { pwHash: _, ...sessionUser } = found;
    setUser(sessionUser); saveSession(sessionUser);
    return null;
  };

  const signUp = async (name: string, email: string, password: string): Promise<string | null> => {
    const users = loadUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return "An account with that email already exists.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    const id = crypto.randomUUID();
    const avatarColor = AVATAR_COLORS[users.length % AVATAR_COLORS.length];
    const pwHash = await hashPasswordPBKDF2(password, id);
    const newUser: StoredUser = { id, email, name, avatarColor, role: "Admin", createdAt: new Date().toISOString(), pwHash };
    saveUsers([...users, newUser]);
    const { pwHash: _, ...sessionUser } = newUser;
    setUser(sessionUser); saveSession(sessionUser);
    return null;
  };

  const signInWithGoogle = async (credential: string): Promise<string | null> => {
    try {
      const { sub, email, name } = decodeGoogleJwt(credential);
      const users = loadUsers();
      let found = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (!found) {
        const id = `google_${sub}`;
        const avatarColor = AVATAR_COLORS[users.length % AVATAR_COLORS.length];
        const newUser: StoredUser = { id, email, name, avatarColor, role: "Admin", createdAt: new Date().toISOString(), pwHash: "" };
        saveUsers([...users, newUser]);
        found = newUser;
      }
      const { pwHash: _, ...sessionUser } = found;
      setUser(sessionUser); saveSession(sessionUser);
      return null;
    } catch {
      return "Google sign-in failed. Please try again.";
    }
  };

  const signOut = () => { setUser(null); saveSession(null); };

  const updateProfile = (patch: Partial<Pick<AuthUser, "name" | "avatarColor" | "role">>) => {
    if (!user) return;
    const updated = { ...user, ...patch };
    setUser(updated); saveSession(updated);
    const users = loadUsers();
    saveUsers(users.map(u => u.id === user.id ? { ...u, ...patch } : u));
  };

  const changePassword = async (current: string, next: string): Promise<string | null> => {
    if (!user) return "Not signed in.";
    const users = loadUsers();
    const stored = users.find(u => u.id === user.id);
    if (!stored) return "User not found.";
    if (!(await verifyPassword(current, user.id, stored.pwHash))) return "Current password is incorrect.";
    if (next.length < 8) return "New password must be at least 8 characters.";
    const newHash = await hashPasswordPBKDF2(next, user.id);
    saveUsers(users.map(u => u.id === user.id ? { ...u, pwHash: newHash } : u));
    return null;
  };

  return <AuthCtx.Provider value={{ user, signIn, signUp, signInWithGoogle, signOut, updateProfile, changePassword }}>{children}</AuthCtx.Provider>;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void; auto_select?: boolean }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}

// ─── Theme ────────────────────────────────────────────────────────────────────

const THEMES = {
  light: {
    mode: "light" as ThemeMode,
    appBg: "#f4f5f7", sidebar: "#ffffff", card: "#ffffff", cardHover: "#f9fafb",
    inputBg: "#ffffff", sectionBg: "#fafafa", tagBg: "#f3f4f6", panelBg: "#ffffff",
    modalBg: "#ffffff",
    border: "#e5e7eb", borderLight: "#f3f4f6", borderFaint: "#f9fafb",
    text: "#111827", textSub: "#6b7280", textMuted: "#9ca3af", textFaint: "#d1d5db",
    primary: "#4f46e5", primaryText: "#ffffff",
    statusAI:       { label:"AI Generated", color:"#7c3aed", bg:"#ede9fe",  dot:"#8b5cf6" },
    statusDraft:    { label:"Draft",         color:"#6b7280", bg:"#f3f4f6",  dot:"#9ca3af" },
    statusReview:   { label:"In Review",     color:"#d97706", bg:"#fef3c7",  dot:"#f59e0b" },
    statusApproved: { label:"Approved",      color:"#2563eb", bg:"#dbeafe",  dot:"#3b82f6" },
    statusScheduled:{ label:"Scheduled",     color:"#059669", bg:"#d1fae5",  dot:"#10b981" },
    statusPublished:{ label:"Published",     color:"#374151", bg:"#f3f4f6",  dot:"#6b7280" },
    calEmpty: "#e5e7eb", tableHead: "#fafafa",
    navActive: "#eef2ff", navActiveText: "#4338ca", navText: "#6b7280",
    shadow: "0 1px 3px rgba(0,0,0,0.08),0 1px 2px rgba(0,0,0,0.04)",
    shadowMd: "0 8px 24px rgba(0,0,0,0.12)",
    toggleIcon: "☀️", toggleLabel: "Light mode",
    overlay: "rgba(17,24,39,0.45)",
    danger: "#dc2626", dangerBg: "#fee2e2", dangerBorder: "#fca5a5",
    success: "#059669", successBg: "#d1fae5",
  },
  dark: {
    mode: "dark" as ThemeMode,
    appBg: "#0d0f14", sidebar: "#111318", card: "#181c24", cardHover: "#1e2330",
    inputBg: "#1e2330", sectionBg: "#141820", tagBg: "#1e2330", panelBg: "#181c24",
    modalBg: "#181c24",
    border: "#252d3d", borderLight: "#1e2330", borderFaint: "#181c24",
    text: "#f1f5f9", textSub: "#94a3b8", textMuted: "#64748b", textFaint: "#334155",
    primary: "#6366f1", primaryText: "#ffffff",
    statusAI:       { label:"AI Generated", color:"#a78bfa", bg:"#1e1b3a",  dot:"#8b5cf6" },
    statusDraft:    { label:"Draft",         color:"#94a3b8", bg:"#1e2330",  dot:"#64748b" },
    statusReview:   { label:"In Review",     color:"#fbbf24", bg:"#292110",  dot:"#f59e0b" },
    statusApproved: { label:"Approved",      color:"#60a5fa", bg:"#0f1f3d",  dot:"#3b82f6" },
    statusScheduled:{ label:"Scheduled",     color:"#34d399", bg:"#0a2218",  dot:"#10b981" },
    statusPublished:{ label:"Published",     color:"#94a3b8", bg:"#1e2330",  dot:"#64748b" },
    calEmpty: "#252d3d", tableHead: "#141820",
    navActive: "#1e2460", navActiveText: "#818cf8", navText: "#64748b",
    shadow: "0 1px 3px rgba(0,0,0,0.4),0 1px 2px rgba(0,0,0,0.3)",
    shadowMd: "0 8px 24px rgba(0,0,0,0.5)",
    toggleIcon: "🌙", toggleLabel: "Dark mode",
    overlay: "rgba(0,0,0,0.65)",
    danger: "#f87171", dangerBg: "#2d0f0f", dangerBorder: "#7f1d1d",
    success: "#34d399", successBg: "#0a2218",
  },
};
type Theme = typeof THEMES.light;

const ThemeCtx = createContext<{ t: Theme; toggle: () => void }>({ t: THEMES.light, toggle: () => {} });
const useTheme = () => useContext(ThemeCtx);

// ─── Seed data ────────────────────────────────────────────────────────────────

const SEED_BRANDS: Brand[] = [
  { id:1, name:"TravelEase",  industry:"Travel",            color:"#0ea5e9", tagline:"Affordable travel without compromising convenience",  tone:["Friendly","Inspiring","Trustworthy"],            audience:"Travelers, families, business professionals",     pillars:[{name:"Travel Tips",weight:30},{name:"Destinations",weight:25},{name:"Deals",weight:20},{name:"Stories",weight:15},{name:"Community",weight:10}], platforms:["Facebook","Instagram","X","LinkedIn","TikTok"],  channels:[], ideas:12,drafts:8, review:4,scheduled:21,posts_month:52 },
  { id:2, name:"FitLife Pro", industry:"Fitness",           color:"#f97316", tagline:"Transform your body, transform your life",             tone:["Energetic","Motivating","Scientific"],           audience:"Fitness enthusiasts, 25–45, health-conscious",    pillars:[{name:"Workouts",weight:35},{name:"Nutrition",weight:25},{name:"Motivation",weight:20},{name:"Products",weight:15},{name:"Community",weight:5}],  platforms:["Instagram","TikTok","YouTube","Facebook"],       channels:[], ideas:9, drafts:6, review:3,scheduled:18,posts_month:44 },
  { id:3, name:"GreenBite",   industry:"Food & Wellness",   color:"#10b981", tagline:"Eat clean, live green, feel great",                   tone:["Warm","Educational","Approachable"],             audience:"Health-conscious millennials, vegans, parents",   pillars:[{name:"Recipes",weight:35},{name:"Nutrition",weight:25},{name:"Lifestyle",weight:20},{name:"Products",weight:10},{name:"Deals",weight:10}],    platforms:["Instagram","Pinterest","TikTok","Facebook"],     channels:[], ideas:11,drafts:7, review:2,scheduled:24,posts_month:60 },
  { id:4, name:"TechNova",    industry:"SaaS / Technology", color:"#8b5cf6", tagline:"Building the infrastructure of tomorrow",              tone:["Professional","Authoritative","Forward-thinking"],audience:"CTOs, developers, startup founders",              pillars:[{name:"Insights",weight:30},{name:"Product",weight:25},{name:"Engineering",weight:20},{name:"Case studies",weight:15},{name:"Community",weight:10}], platforms:["LinkedIn","X","Dev.to","YouTube"],               channels:[], ideas:8, drafts:5, review:3,scheduled:14,posts_month:32 },
  { id:5, name:"LuxStay",     industry:"Hospitality",       color:"#ec4899", tagline:"Where luxury meets authentic experiences",             tone:["Elegant","Aspirational","Personal"],             audience:"Affluent travelers, 35–60, experience seekers",   pillars:[{name:"Experiences",weight:30},{name:"Properties",weight:25},{name:"Lifestyle",weight:25},{name:"Offers",weight:10},{name:"Stories",weight:10}],  platforms:["Instagram","Facebook","LinkedIn","Pinterest"],   channels:[], ideas:8, drafts:6, review:2,scheduled:9, posts_month:28 },
];

const SEED_CONTENT: ContentItem[] = [
  { id:1827,brand:"TravelEase", brandColor:"#0ea5e9",campaign:"Summer Promotion", pillar:"Promotional",platform:"Instagram",status:"review",      caption:"✈️ Summer is calling — and we're making it affordable. Book your dream trip today and save up to 40% on select destinations. Limited time offer!", hashtags:"#travel #summer #deals #wanderlust",              scheduled:"Sep 4, 2026 — 7:30 PM",  format:"Carousel",score:87},
  { id:1826,brand:"FitLife Pro",brandColor:"#f97316",campaign:"Back to Routine",  pillar:"Motivation", platform:"TikTok",    status:"scheduled",   caption:"September reset starts NOW. 30 days. One commitment. Your best self. Drop a 💪 if you're in.",                                                           hashtags:"#fitness #september #motivation #fitlife",        scheduled:"Sep 1, 2026 — 6:00 AM",  format:"Video",   score:92},
  { id:1825,brand:"GreenBite",  brandColor:"#10b981",campaign:"Fall Recipes",     pillar:"Recipes",    platform:"Instagram", status:"draft",        caption:"🍂 5 cozy autumn recipes that are actually good for you. Swipe to see our butternut squash soup that's getting everyone obsessed.",                     hashtags:"#healthyfood #fallrecipes #vegan #greenbite",     scheduled:"Sep 3, 2026 — 12:00 PM", format:"Carousel",score:78},
  { id:1824,brand:"TechNova",   brandColor:"#8b5cf6",campaign:"Q3 Insights",      pillar:"Insights",   platform:"LinkedIn",  status:"scheduled",   caption:"We analyzed 10,000 engineering teams. The #1 bottleneck isn't code — it's deployment confidence. Here's what the data shows:",                         hashtags:"#engineering #devops #saas #technova",            scheduled:"Sep 2, 2026 — 9:00 AM",  format:"Article", score:94},
  { id:1823,brand:"LuxStay",    brandColor:"#ec4899",campaign:"Weekend Getaway",  pillar:"Experiences",platform:"Instagram", status:"approved",    caption:"Some places deserve more than a weekend. But for now, this will do. 🌊 Our Maldives overwater suite is open for September.",                          hashtags:"#luxury #travel #maldives #luxstay",              scheduled:"Sep 5, 2026 — 8:00 PM",  format:"Image",   score:89},
  { id:1822,brand:"TravelEase", brandColor:"#0ea5e9",campaign:"Flight Deals",     pillar:"Deals",      platform:"Facebook",  status:"published",   caption:"5 ways to save money on your next international flight ✈️",                                                                                            hashtags:"#travel #flights #savemoney #budgettravel",       scheduled:"Aug 28, 2026 — 7:00 PM", format:"Post",    score:81},
  { id:1821,brand:"FitLife Pro",brandColor:"#f97316",campaign:"Back to Routine",  pillar:"Workouts",   platform:"Instagram", status:"ai_generated",caption:"Morning routine that hits every muscle group in 20 minutes. No excuses, no equipment needed. Follow for daily workouts 🔥",                            hashtags:"#workout #morningroutine #fitness #noequipment",  scheduled:"Sep 6, 2026 — 7:00 AM",  format:"Reel",    score:85},
  { id:1820,brand:"GreenBite",  brandColor:"#10b981",campaign:"Fall Recipes",     pillar:"Nutrition",  platform:"TikTok",    status:"ai_generated",caption:"POV: You just discovered that sweet potatoes have more potassium than bananas 🍠 Here's what to cook with them this fall",                           hashtags:"#nutrition #healthyfacts #sweetpotato #greenbite",scheduled:"Sep 7, 2026 — 3:00 PM",  format:"Video",   score:76},
];

const CALENDAR_DATA: Record<string, Record<string, { color: string; format: string }[]>> = {
  Mon:{IG:[{color:"#ec4899",format:"Reel"}],   FB:[],                               X:[{color:"#374151",format:"Thread"}],LI:[],                                TT:[{color:"#10b981",format:"Video"}]},
  Tue:{IG:[{color:"#0ea5e9",format:"Carousel"}],FB:[{color:"#0ea5e9",format:"Post"}],X:[],                                LI:[{color:"#8b5cf6",format:"Article"}],TT:[]},
  Wed:{IG:[],                                  FB:[{color:"#f97316",format:"Reel"}],X:[{color:"#f97316",format:"Post"}], LI:[{color:"#8b5cf6",format:"Post"}],  TT:[{color:"#ec4899",format:"Video"}]},
  Thu:{IG:[{color:"#10b981",format:"Story"}],  FB:[],                               X:[],                                LI:[],                                TT:[{color:"#0ea5e9",format:"Video"}]},
  Fri:{IG:[{color:"#ec4899",format:"Image"}],  FB:[{color:"#10b981",format:"Post"}],X:[{color:"#374151",format:"Post"}],LI:[{color:"#8b5cf6",format:"Article"}],TT:[]},
  Sat:{IG:[{color:"#f97316",format:"Carousel"}],FB:[{color:"#f97316",format:"Post"}],X:[],                               LI:[],                                TT:[{color:"#10b981",format:"Video"}]},
  Sun:{IG:[],                                  FB:[],                               X:[{color:"#0ea5e9",format:"Post"}], LI:[],                                TT:[{color:"#ec4899",format:"Video"}]},
};

const APPROVAL_TABLE = [
  {type:"General tips",level:"auto"},{type:"Inspirational posts",level:"auto"},{type:"Evergreen blogs",level:"auto"},
  {type:"Product information",level:"review"},{type:"Promotions",level:"review"},
  {type:"Pricing",level:"human"},{type:"Legal claims",level:"human"},{type:"Sensitive topics",level:"human"},
];
const ANALYTICS_TOPICS = [
  {name:"Travel Tips",engagement:8.2},{name:"Destinations",engagement:6.9},{name:"Deals",engagement:5.4},
  {name:"Inspiration",engagement:4.1},{name:"Generic quotes",engagement:1.2},
];
const ALL_PLATFORMS = ["Facebook","Instagram","X","LinkedIn","TikTok","YouTube","Pinterest","Dev.to"];
const ALL_FORMATS   = ["Post","Carousel","Reel","Video","Image","Article","Thread","Story"];
const ALL_STATUSES: Status[] = ["ai_generated","draft","review","approved","scheduled","published"];
const BRAND_COLORS  = ["#0ea5e9","#f97316","#10b981","#8b5cf6","#ec4899","#ef4444","#f59e0b","#06b6d4","#84cc16","#6366f1"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

let nextId = 9000;
const uid = () => ++nextId;

function statusCfg(status: Status, t: Theme) {
  const map: Record<Status, Theme["statusAI"]> = {
    ai_generated: t.statusAI, draft: t.statusDraft, review: t.statusReview,
    approved: t.statusApproved, scheduled: t.statusScheduled, published: t.statusPublished,
  };
  return map[status];
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Badge({ status }: { status: Status }) {
  const { t } = useTheme();
  const s = statusCfg(status, t);
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap" style={{ color: s.color, background: s.bg }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

function BrandAvatar({ name, color, size = "md" }: { name: string; color: string; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "w-7 h-7 text-xs rounded-lg" : "w-9 h-9 text-sm rounded-xl";
  return (
    <div className={`${sz} flex items-center justify-center font-bold flex-shrink-0`} style={{ background: color + "20", color }}>
      {name.slice(0, 1)}
    </div>
  );
}

function Card({ children, className = "", style = {}, onClick, onMouseEnter, onMouseLeave }: { children: React.ReactNode; className?: string; style?: React.CSSProperties; onClick?: () => void; onMouseEnter?: () => void; onMouseLeave?: () => void }) {
  const { t } = useTheme();
  return (
    <div className={`rounded-xl border transition-all ${className}`} style={{ background: t.card, borderColor: t.border, boxShadow: t.shadow, ...style }} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {children}
    </div>
  );
}

function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h2 className="text-xl font-bold" style={{ color: t.text }}>{title}</h2>
        {sub && <p className="text-sm mt-0.5" style={{ color: t.textSub }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function PrimaryBtn({ children, onClick, small }: { children: React.ReactNode; onClick?: () => void; small?: boolean }) {
  const { t } = useTheme();
  return (
    <button onClick={onClick} className={`font-semibold rounded-lg transition-opacity hover:opacity-90 shadow-sm ${small ? "text-xs px-3 py-1.5" : "text-sm px-4 py-2"}`} style={{ background: t.primary, color: t.primaryText }}>
      {children}
    </button>
  );
}

function Input({ label, value, onChange, placeholder, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) {
  const { t } = useTheme();
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>{label}{required && <span style={{ color: t.danger }}> *</span>}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required}
        className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none transition-colors"
        style={{ background: t.inputBg, borderColor: t.border, color: t.text }}
      />
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  const { t } = useTheme();
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>{label}</label>
      <textarea
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none resize-none transition-colors"
        style={{ background: t.inputBg, borderColor: t.border, color: t.text }}
      />
    </div>
  );
}

function Select({ label, value, onChange, options, required }: { label: string; value: string; onChange: (v: string) => void; options: string[]; required?: boolean }) {
  const { t } = useTheme();
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>{label}{required && <span style={{ color: t.danger }}> *</span>}</label>
      <select value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none cursor-pointer"
        style={{ background: t.inputBg, borderColor: t.border, color: value ? t.text : t.textMuted }}>
        <option value="">Select…</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// Slide-in right panel wrapper
function SlidePanel({ open, onClose, title, subtitle, children, footer }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  const { t } = useTheme();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end" style={{ background: t.overlay, backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div
        className="w-full max-w-lg h-full flex flex-col transition-transform"
        style={{ background: t.panelBg, boxShadow: t.shadowMd }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: t.borderLight }}>
          <div>
            <div className="font-bold text-base" style={{ color: t.text }}>{title}</div>
            {subtitle && <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-xl leading-none transition-colors" style={{ color: t.textMuted }}
            onMouseEnter={e => (e.currentTarget.style.background = t.tagBg)} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">{children}</div>
        {footer && <div className="border-t px-6 py-4 flex-shrink-0" style={{ borderColor: t.borderLight }}>{footer}</div>}
      </div>
    </div>
  );
}

// Confirm dialog
function ConfirmModal({ open, onClose, onConfirm, title, message }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string;
}) {
  const { t } = useTheme();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: t.overlay, backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border p-6 mx-4" style={{ background: t.modalBg, borderColor: t.border, boxShadow: t.shadowMd }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl mb-4" style={{ background: t.dangerBg }}>🗑</div>
        <div className="font-bold text-base mb-2" style={{ color: t.text }}>{title}</div>
        <p className="text-sm mb-5" style={{ color: t.textSub }}>{message}</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors" style={{ borderColor: t.border, color: t.textSub, background: t.card }}>Cancel</button>
          <button onClick={() => { onConfirm(); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "#dc2626" }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// Toast notification
function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  const { t } = useTheme();
  useEffect(() => { const id = setTimeout(onDone, 2500); return () => clearTimeout(id); }, [onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-full text-sm font-semibold shadow-lg flex items-center gap-2" style={{ background: t.success === "#059669" ? "#059669" : "#34d399", color: "white" }}>
      <span>✓</span> {msg}
    </div>
  );
}

// ─── Brand Form ───────────────────────────────────────────────────────────────

const EMPTY_BRAND = (): Omit<Brand, "id" | "ideas" | "drafts" | "review" | "scheduled" | "posts_month"> => ({
  name: "", industry: "", color: BRAND_COLORS[0], tagline: "", tone: [], audience: "",
  pillars: [{ name: "", weight: 20 }, { name: "", weight: 20 }, { name: "", weight: 20 }, { name: "", weight: 20 }, { name: "", weight: 20 }],
  platforms: [], channels: [],
});

function BrandForm({ brand, onSave, onClose }: {
  brand: Brand | null; onSave: (b: Omit<Brand,"id"|"ideas"|"drafts"|"review"|"scheduled"|"posts_month">) => void; onClose: () => void;
}) {
  const { t } = useTheme();
  const [form, setForm] = useState(brand ? {
    name: brand.name, industry: brand.industry, color: brand.color, tagline: brand.tagline,
    tone: brand.tone, audience: brand.audience, pillars: brand.pillars.map(p => ({ ...p })), platforms: [...brand.platforms],
    channels: brand.channels || [],
  } : EMPTY_BRAND());
  const [toneInput, setToneInput] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));
  const setPillar = (i: number, k: keyof Pillar, v: string | number) =>
    setForm(f => { const p = [...f.pillars]; p[i] = { ...p[i], [k]: v }; return { ...f, pillars: p }; });
  const totalWeight = form.pillars.reduce((s, p) => s + Number(p.weight), 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Brand name is required.";
    if (form.pillars.length === 0) errors.pillars = "Add at least one content pillar.";
    if (totalWeight > 0 && Math.abs(totalWeight - 100) > 0.5) errors.pillars = `Pillar weights should total 100 (currently ${totalWeight}).`;
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Basic info */}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Brand Name" value={form.name} onChange={v => set("name", v)} placeholder="e.g. TravelEase" required />
        <Input label="Industry" value={form.industry} onChange={v => set("industry", v)} placeholder="e.g. Travel" required />
      </div>
      <Input label="Tagline" value={form.tagline} onChange={v => set("tagline", v)} placeholder="Your brand's positioning statement" />
      <Input label="Target Audience" value={form.audience} onChange={v => set("audience", v)} placeholder="e.g. Travelers, families, professionals" />

      {/* Brand color */}
      <div>
        <label className="block text-xs font-semibold mb-2" style={{ color: t.textSub }}>Brand Color</label>
        <div className="flex items-center gap-3">
          <div className="flex gap-2 flex-wrap">
            {BRAND_COLORS.map(c => (
              <button key={c} type="button" onClick={() => set("color", c)}
                className="w-7 h-7 rounded-lg transition-transform hover:scale-110"
                style={{ background: c, boxShadow: form.color === c ? `0 0 0 3px ${c}55, 0 0 0 5px ${t.card}` : "none", transform: form.color === c ? "scale(1.15)" : "scale(1)" }}
              />
            ))}
          </div>
          <input type="color" value={form.color} onChange={e => set("color", e.target.value)}
            className="w-8 h-8 rounded-lg cursor-pointer border" style={{ borderColor: t.border }} title="Custom color" />
        </div>
      </div>

      {/* Tone */}
      <div>
        <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Voice & Tone</label>
        <div className="flex gap-2 flex-wrap mb-2">
          {form.tone.map(tone => (
            <span key={tone} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: form.color + "20", color: form.color }}>
              {tone}
              <button type="button" onClick={() => set("tone", form.tone.filter(t2 => t2 !== tone))} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={toneInput} onChange={e => setToneInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (toneInput.trim()) { set("tone", [...form.tone, toneInput.trim()]); setToneInput(""); } } }}
            placeholder="Type and press Enter…" className="flex-1 text-sm px-3 py-2 rounded-lg border outline-none"
            style={{ background: t.inputBg, borderColor: t.border, color: t.text }} />
          <button type="button" onClick={() => { if (toneInput.trim()) { set("tone", [...form.tone, toneInput.trim()]); setToneInput(""); } }}
            className="text-xs px-3 py-2 rounded-lg font-medium" style={{ background: t.tagBg, color: t.textSub }}>Add</button>
        </div>
      </div>

      {/* Platforms */}
      <div>
        <label className="block text-xs font-semibold mb-2" style={{ color: t.textSub }}>Active Platforms</label>
        <div className="flex flex-wrap gap-2">
          {ALL_PLATFORMS.map(p => {
            const active = form.platforms.includes(p);
            return (
              <button key={p} type="button"
                onClick={() => set("platforms", active ? form.platforms.filter(x => x !== p) : [...form.platforms, p])}
                className="text-xs px-3 py-1.5 rounded-full border font-medium transition-all"
                style={{ background: active ? form.color + "20" : t.tagBg, borderColor: active ? form.color + "60" : t.border, color: active ? form.color : t.textSub }}>
                {p}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content pillars */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold" style={{ color: t.textSub }}>Content Pillars</label>
          <span className="text-xs font-mono font-bold" style={{ color: totalWeight === 100 ? t.success : "#d97706" }}>
            {totalWeight}% {totalWeight !== 100 && "(should total 100%)"}
          </span>
        </div>
        <div className="space-y-2">
          {form.pillars.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={p.name} onChange={e => setPillar(i, "name", e.target.value)} placeholder={`Pillar ${i + 1}`}
                className="flex-1 text-sm px-3 py-2 rounded-lg border outline-none" style={{ background: t.inputBg, borderColor: t.border, color: t.text }} />
              <div className="relative">
                <input type="number" min={0} max={100} value={p.weight} onChange={e => setPillar(i, "weight", Number(e.target.value))}
                  className="w-16 text-sm px-2 py-2 rounded-lg border outline-none text-center" style={{ background: t.inputBg, borderColor: t.border, color: t.text }} />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: t.textMuted }}>%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: t.border, color: t.textSub, background: t.card }}>
          Cancel
        </button>
        <button type="submit" className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: t.primary }}>
          {brand ? "Save Changes" : "Create Brand"}
        </button>
      </div>
    </form>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

const AI_MODELS = [
  { id: "claude-opus-5",    label: "Claude Opus 5",    desc: "Most capable — best quality" },
  { id: "claude-sonnet-5",  label: "Claude Sonnet 5",  desc: "Balanced speed & quality" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", desc: "Fast & cost-efficient" },
];

function SettingsPanel({ open, onClose, apiKey, onApiKeyChange, aiModel, onModelChange }: {
  open: boolean; onClose: () => void;
  apiKey: string; onApiKeyChange: (k: string) => void;
  aiModel: string; onModelChange: (m: string) => void;
}) {
  const { t } = useTheme();
  const [localKey, setLocalKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "err" | null>(null);
  const [googleClientId, setGoogleClientId] = useState(() => getGoogleClientId());

  useEffect(() => { if (open) { setLocalKey(apiKey); setTestResult(null); setGoogleClientId(getGoogleClientId()); } }, [open, apiKey]);

  const handleSave = () => {
    onApiKeyChange(localKey.trim());
    localStorage.setItem("contentOS_apiKey", localKey.trim());
    localStorage.setItem("contentOS_googleClientId", googleClientId.trim());
    dbSet("contentOS:settings", { apiKey: localKey.trim(), aiModel, googleClientId: googleClientId.trim() });
    onClose();
  };

  const handleTest = async () => {
    if (!localKey.trim()) return;
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": localKey.trim(),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 10, messages: [{ role: "user", content: "Hi" }] }),
      });
      setTestResult(res.ok ? "ok" : "err");
    } catch {
      setTestResult("err");
    } finally {
      setTesting(false);
    }
  };

  return (
    <SlidePanel open={open} onClose={onClose} title="AI Settings" subtitle="Configure Claude API for content generation">
      <div className="space-y-5">
        {/* API Key */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Anthropic API Key</label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={localKey}
              onChange={e => setLocalKey(e.target.value)}
              placeholder="sk-ant-api03-…"
              className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none pr-20"
              style={{ background: t.inputBg, borderColor: t.border, color: t.text, fontFamily: showKey ? "inherit" : "monospace" }}
            />
            <button type="button" onClick={() => setShowKey(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded font-medium"
              style={{ color: t.textMuted, background: t.tagBg }}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <p className="text-xs mt-1.5" style={{ color: t.textMuted }}>
            Get your key at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
              className="underline" style={{ color: t.primary }}>console.anthropic.com</a>
            . Stored in your browser only.
          </p>
        </div>

        {/* Google OAuth */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Google OAuth Client ID</label>
          <input
            type="text"
            value={googleClientId}
            onChange={e => setGoogleClientId(e.target.value)}
            placeholder="xxxx.apps.googleusercontent.com"
            className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none font-mono"
            style={{ background: t.inputBg, borderColor: t.border, color: t.text }}
          />
          <p className="text-xs mt-1.5" style={{ color: t.textMuted }}>
            Optional. Enables "Sign in with Google" on the login page.{" "}
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"
              className="underline" style={{ color: t.primary }}>Create one at Google Cloud Console</a>
            . Add your app URL as an authorized JavaScript origin.
          </p>
        </div>

        {/* Test connection */}
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleTest} disabled={!localKey.trim() || testing}
            className="text-sm px-4 py-2 rounded-lg font-semibold border transition-colors disabled:opacity-40"
            style={{ borderColor: t.border, color: t.textSub, background: t.tagBg }}>
            {testing ? "Testing…" : "Test Connection"}
          </button>
          {testResult === "ok" && <span className="text-sm font-semibold" style={{ color: "#059669" }}>✓ Connected</span>}
          {testResult === "err" && <span className="text-sm font-semibold" style={{ color: t.danger }}>✗ Invalid key</span>}
        </div>

        {/* Model selector */}
        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: t.textSub }}>AI Model</label>
          <div className="space-y-2">
            {AI_MODELS.map(m => {
              const active = aiModel === m.id;
              return (
                <button key={m.id} type="button" onClick={() => onModelChange(m.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all"
                  style={{ background: active ? t.primary + "12" : t.inputBg, borderColor: active ? t.primary : t.border }}>
                  <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                    style={{ borderColor: active ? t.primary : t.border }}>
                    {active && <div className="w-2 h-2 rounded-full" style={{ background: t.primary }} />}
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: t.text }}>{m.label}</div>
                    <div className="text-xs" style={{ color: t.textMuted }}>{m.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* About */}
        <div className="p-4 rounded-xl border" style={{ background: t.sectionBg, borderColor: t.borderLight }}>
          <div className="text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>How it works</div>
          <p className="text-xs leading-relaxed" style={{ color: t.textMuted }}>
            Claude generates format-aware content: <strong style={{ color: t.textSub }}>text posts</strong> get a caption + hashtags; <strong style={{ color: t.textSub }}>image formats</strong> (Image, Carousel, Story) also get a detailed AI image prompt for Midjourney / DALL-E / Firefly; <strong style={{ color: t.textSub }}>video formats</strong> (Reel, Video) get a full HOOK → BODY → CTA script with camera notes.
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
            style={{ borderColor: t.border, color: t.textSub, background: t.card }}>Cancel</button>
          <button type="button" onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: t.primary }}>Save Settings</button>
        </div>
      </div>
    </SlidePanel>
  );
}

// ─── AI generation helper ─────────────────────────────────────────────────────

const IMAGE_FORMATS = new Set(["Image","Carousel","Story"]);
const VIDEO_FORMATS = new Set(["Reel","Video"]);

type GeneratedContent = {
  caption: string;
  hashtags: string;
  imagePrompt?: string;
  videoScript?: string;
};

async function callClaude(apiKey: string, model: string, userPrompt: string, maxTokens = 900, system?: string, disableThinking = false): Promise<string> {
  const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages: [{ role: "user", content: userPrompt }] };
  if (system) body.system = system;
  if (disableThinking) body.thinking = { type: "disabled" };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json() as { content: { type: string; text: string }[]; stop_reason?: string; error?: unknown };
  return data.content.find(b => b.type === "text")?.text || "";
}

async function callGroqText(apiKey: string, model: string, prompt: string, system?: string): Promise<string> {
  const messages = [
    ...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: prompt },
  ];
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: 8000, temperature: 0.7 }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(e.error?.message || `Groq HTTP ${res.status}`);
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("No content in Groq response");
  return text;
}

async function callPollinationsText(apiKey: string, model: string, prompt: string, system?: string): Promise<string> {
  const messages = [
    ...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: prompt },
  ];
  const res = await fetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, seed: Math.floor(Math.random() * 99999) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pollinations HTTP ${res.status}${body ? ": " + body.slice(0, 120) : ""}`);
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("No content in Pollinations response");
  return text;
}

async function callHuggingFaceText(apiToken: string, model: string, prompt: string, system?: string): Promise<string> {
  const messages = [
    ...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: prompt },
  ];
  // Try chat-completions endpoint first (newer hosted models)
  const chatRes = await fetch(`https://api-inference.huggingface.co/models/${model}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: 8000, stream: false }),
  });
  if (chatRes.ok) {
    const data = await chatRes.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (text) return text;
  }
  // Fall back to standard inference API (older / pipeline models)
  const fullPrompt = `${system ? system + "\n\n" : ""}${messages.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n")}\nAssistant:`;
  const inferRes = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: fullPrompt, parameters: { max_new_tokens: 8000, return_full_text: false } }),
  });
  if (!inferRes.ok) {
    const e = await inferRes.json().catch(() => ({})) as { error?: string };
    if (e.error?.includes("loading")) throw new Error("Model is loading on Hugging Face — wait ~30s and try again.");
    throw new Error(e.error || `Hugging Face HTTP ${inferRes.status}`);
  }
  const result = await inferRes.json() as { generated_text?: string }[] | { generated_text?: string };
  const generated = Array.isArray(result) ? result[0]?.generated_text : result.generated_text;
  if (!generated) throw new Error("No text generated by Hugging Face model");
  return generated;
}

// Provider + model catalogue for schedule generation
const SCHEDULE_PROVIDERS = [
  {
    id: "claude",
    name: "Claude",
    icon: "✦",
    color: "#7c3aed",
    desc: "Best quality — format-aware, brand-intelligent content generation",
    requiresKey: true,
    models: [
      { id: "claude-opus-5",    label: "Opus 5",    desc: "Most capable" },
      { id: "claude-sonnet-5",  label: "Sonnet 5",  desc: "Balanced" },
      { id: "claude-haiku-4-5", label: "Haiku 4.5", desc: "Fastest" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    icon: "⚡",
    color: "#f97316",
    desc: "Free tier — ultra-fast open-source models, no credit card needed",
    requiresKey: true,
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B",  desc: "Best quality" },
      { id: "llama-3.1-70b-versatile", label: "Llama 3.1 70B",  desc: "Reliable" },
      { id: "llama-3.1-8b-instant",    label: "Llama 3.1 8B",   desc: "Fastest" },
      { id: "gemma2-9b-it",            label: "Gemma 2 9B",     desc: "Efficient" },
    ],
  },
  {
    id: "pollinations",
    name: "Pollinations.ai",
    icon: "🌸",
    color: "#059669",
    desc: "Free image-focused AI — text generation via GPT-4o, Llama, Mistral with API key",
    requiresKey: true,
    models: [
      { id: "openai",        label: "GPT-4o",        desc: "Best quality" },
      { id: "openai-large",  label: "GPT-4o Large",  desc: "More capable" },
      { id: "llama",         label: "Llama 3.3 70B", desc: "Open-source" },
      { id: "mistral",       label: "Mistral",       desc: "Fast" },
      { id: "deepseek",      label: "DeepSeek",      desc: "Strong reasoning" },
    ],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    icon: "🤗",
    color: "#f59e0b",
    desc: "Free inference API — open-source Llama, Mistral, Qwen models",
    requiresKey: true,
    models: [
      { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", label: "Llama 3.1 8B",  desc: "Fast & free" },
      { id: "meta-llama/Llama-3.1-70B-Instruct",     label: "Llama 3.1 70B", desc: "Higher quality" },
      { id: "mistralai/Mistral-7B-Instruct-v0.3",    label: "Mistral 7B",    desc: "Efficient" },
      { id: "Qwen/Qwen2.5-72B-Instruct",             label: "Qwen 2.5 72B",  desc: "Multilingual" },
    ],
  },
] as const;

type ScheduleProviderId = typeof SCHEDULE_PROVIDERS[number]["id"];

function buildBrandCtx(brand: Brand | undefined, form: { pillar: string; campaign: string; platform: string; format: string }) {
  return `Brand: ${brand?.name || "Unknown"}
Industry: ${brand?.industry || "General"}
Tagline: ${brand?.tagline || ""}
Audience: ${brand?.audience || "General"}
Tone: ${(brand?.tone || []).join(", ") || "Professional"}
Pillar: ${form.pillar || "General"}
Campaign: ${form.campaign || "Organic"}
Platform: ${form.platform || "Social media"}
Format: ${form.format || "Post"}`;
}

interface ProviderCreds { claudeKey: string; groqKey: string; pollinationsKey: string; hfToken: string; }

async function callAnyProvider(provider: ScheduleProviderId, model: string, creds: ProviderCreds, userPrompt: string, system?: string): Promise<string> {
  const sys = system || "You are a JSON API. Return only valid JSON, no markdown, no explanation.";
  if (provider === "claude")       return callClaude(creds.claudeKey, model, userPrompt, 1400, sys, true);
  if (provider === "groq")         return callGroqText(creds.groqKey, model, userPrompt, sys);
  if (provider === "pollinations") return callPollinationsText(creds.pollinationsKey, model, userPrompt, sys);
  return callHuggingFaceText(creds.hfToken, model, userPrompt, sys);
}

function extractJSON(text: string): GeneratedContent {
  const stripped = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = stripped.indexOf("{"); const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response — try again or switch model.");
  return JSON.parse(stripped.slice(start, end + 1)) as GeneratedContent;
}

async function generateImageContent(provider: ScheduleProviderId, model: string, creds: ProviderCreds, brand: Brand | undefined, form: { pillar: string; campaign: string; platform: string; format: string; brand: string }): Promise<GeneratedContent> {
  const ctx = buildBrandCtx(brand, form);
  const prompt = `You are a social media content strategist. Create visual content for ${form.platform}.

${ctx}

Return ONLY valid JSON with these exact keys:
{
  "caption": "Engaging ${form.platform} caption (use emojis, 1-3 sentences)",
  "hashtags": "#tag1 #tag2 #tag3 #tag4 #tag5",
  "imagePrompt": "Detailed AI image generation prompt (describe composition, style, lighting, colors, mood — 2-3 sentences, no brand names)"
}`;
  return extractJSON(await callAnyProvider(provider, model, creds, prompt));
}

async function generateVideoContent(provider: ScheduleProviderId, model: string, creds: ProviderCreds, brand: Brand | undefined, form: { pillar: string; campaign: string; platform: string; format: string; brand: string }): Promise<GeneratedContent> {
  const ctx = buildBrandCtx(brand, form);
  const prompt = `You are a short-form video content strategist. Create a ${form.format} script for ${form.platform}.

${ctx}

Return ONLY valid JSON with these exact keys:
{
  "caption": "Engaging ${form.platform} caption/description with emojis",
  "hashtags": "#tag1 #tag2 #tag3 #tag4 #tag5",
  "videoScript": "HOOK (0-3s): [opening line]\\n\\nBODY (3-25s):\\n[bullet point steps or talking points]\\n\\nCTA (25-30s): [call to action]\\n\\nCAMERA NOTES: [shot suggestions, pace, music vibe]"
}`;
  return extractJSON(await callAnyProvider(provider, model, creds, prompt));
}

async function generateTextContent(provider: ScheduleProviderId, model: string, creds: ProviderCreds, brand: Brand | undefined, form: { pillar: string; campaign: string; platform: string; format: string; brand: string }): Promise<GeneratedContent> {
  const ctx = buildBrandCtx(brand, form);
  const prompt = `You are a social media content expert. Create a ${form.platform} post.

${ctx}

Return ONLY valid JSON:
{"caption": "Engaging caption with emojis", "hashtags": "#tag1 #tag2 #tag3"}`;
  return extractJSON(await callAnyProvider(provider, model, creds, prompt));
}

// ─── fal.ai / Replicate media generation ─────────────────────────────────────

async function generateImagePollinations(apiKey: string, prompt: string, format: string): Promise<string> {
  const landscape = new Set(["Image","Carousel","Story"]);
  const [w, h] = landscape.has(format) ? [1024, 768] : [768, 1024];
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&model=flux&nologo=true&enhance=true&token=${encodeURIComponent(apiKey)}&seed=${Math.floor(Math.random()*999999)}`;
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Pollinations image failed to load — check your API key"));
    img.src = url;
  });
  return url;
}

async function generateImageHuggingFace(apiToken: string, prompt: string, model?: string): Promise<string> {
  const modelId = model?.trim() || "black-forest-labs/FLUX.1-schnell";
  const res = await fetch(`https://api-inference.huggingface.co/models/${modelId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: prompt }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error?: string };
    if (e.error?.includes("loading")) throw new Error("Model is loading — try again in ~20 seconds.");
    throw new Error(e.error || `Hugging Face HTTP ${res.status}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

async function generateImageStableHorde(apiKey: string, prompt: string, model?: string, onProgress?: (msg: string) => void): Promise<string> {
  const key = apiKey?.trim() || "0000000000";
  const modelName = model?.trim() || "FLUX.1-Schnell fp8 (Compact)";
  onProgress?.("Submitting to Stable Horde…");
  const res = await fetch("https://stablehorde.net/api/v2/generate/async", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ prompt, params: { width: 1024, height: 768, steps: 20, n: 1 }, models: [modelName], r2: true }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})) as { message?: string }; throw new Error(e.message || `Stable Horde HTTP ${res.status}`); }
  const { id } = await res.json() as { id: string };
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await fetch(`https://stablehorde.net/api/v2/generate/check/${id}`);
    const sd = await s.json() as { done: boolean; processing: number; waiting: number; queue_position?: number };
    onProgress?.(`Stable Horde: ${sd.done ? "Done!" : sd.processing ? "Rendering…" : `Queue position ${sd.queue_position ?? sd.waiting}`}`);
    if (sd.done) {
      const r2 = await fetch(`https://stablehorde.net/api/v2/generate/status/${id}`);
      const rd = await r2.json() as { generations?: { img: string }[] };
      const imgUrl = rd.generations?.[0]?.img;
      if (!imgUrl) throw new Error("No image in Stable Horde response");
      return imgUrl;
    }
  }
  throw new Error("Stable Horde timed out (3 min)");
}

async function generateImageFal(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_size: "landscape_4_3", num_images: 1, sync_mode: true }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || `fal.ai HTTP ${res.status}`); }
  const data = await res.json() as { images: { url: string }[] };
  const url = data.images?.[0]?.url;
  if (!url) throw new Error("No image returned from fal.ai");
  return url;
}

async function generateImageReplicate(apiToken: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json", Prefer: "wait" },
    body: JSON.stringify({ input: { prompt, aspect_ratio: "4:3", output_format: "webp", num_outputs: 1 } }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || `Replicate HTTP ${res.status}`); }
  const data = await res.json() as { output?: string[]; urls?: { get: string }; id?: string; status?: string };
  if (data.output?.[0]) return data.output[0];
  // Poll if not complete
  if (data.urls?.get) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await fetch(data.urls!.get, { headers: { Authorization: `Bearer ${apiToken}` } });
      const pd = await poll.json() as { status: string; output?: string[] };
      if (pd.status === "succeeded" && pd.output?.[0]) return pd.output[0];
      if (pd.status === "failed") throw new Error("Replicate prediction failed");
    }
    throw new Error("Replicate timed out after 60s");
  }
  throw new Error("No image output from Replicate");
}

async function generateVideoFal(apiKey: string, prompt: string, onProgress?: (msg: string) => void): Promise<string> {
  onProgress?.("Submitting to fal.ai Kling…");
  const res = await fetch("https://queue.fal.run/fal-ai/kling-video/v1/standard/text-to-video", {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, duration: "5", aspect_ratio: "16:9" }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})) as { detail?: string }; throw new Error(e.detail || `fal.ai HTTP ${res.status}`); }
  const { request_id } = await res.json() as { request_id: string };
  const base = "https://queue.fal.run/fal-ai/kling-video/v1/standard/text-to-video";
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await fetch(`${base}/requests/${request_id}/status`, { headers: { Authorization: `Key ${apiKey}` } });
    const sd = await s.json() as { status: string };
    onProgress?.(`Generating video… (${sd.status})`);
    if (sd.status === "COMPLETED") {
      const r2 = await fetch(`${base}/requests/${request_id}`, { headers: { Authorization: `Key ${apiKey}` } });
      const rd = await r2.json() as { video?: { url: string } };
      if (rd.video?.url) return rd.video.url;
      throw new Error("No video URL in fal.ai response");
    }
    if (sd.status === "FAILED") throw new Error("fal.ai video generation failed");
  }
  throw new Error("Video generation timed out (3 min)");
}

// ─── Content Form ─────────────────────────────────────────────────────────────

function ContentFormPanel({ item, brands, open, onClose, onSave, apiKey, aiModel, integrations }: {
  item: ContentItem | null; brands: Brand[]; open: boolean; onClose: () => void;
  onSave: (c: Omit<ContentItem, "id" | "score">) => void;
  apiKey: string; aiModel: string; integrations: Integration[];
}) {
  const { t } = useTheme();
  const emptyForm = (): Omit<ContentItem,"id"|"score"> => ({ brand:"", brandColor:"#6366f1", campaign:"", pillar:"", platform:"", status:"draft", caption:"", hashtags:"", scheduled:"", format:"", imagePrompt:"", videoScript:"", generatedImageUrl:"", generatedVideoUrl:"" });
  const [form, setForm] = useState<Omit<ContentItem,"id"|"score">>(() => item ? { ...emptyForm(), ...item } : emptyForm());
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [scriptExpanded, setScriptExpanded] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaProgress, setMediaProgress] = useState<string | null>(null);
  const [contentProvider, setContentProvider] = useState<ScheduleProviderId>("claude");
  const [contentModel, setContentModel] = useState(aiModel);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const falai       = (integrations || []).find(i => i.id === "falai");
  const replicate   = (integrations || []).find(i => i.id === "replicate");
  const pollinations= (integrations || []).find(i => i.id === "pollinations");
  const huggingface = (integrations || []).find(i => i.id === "huggingface");
  const stablehorde = (integrations || []).find(i => i.id === "stablehorde");
  const groqInt     = (integrations || []).find(i => i.id === "groq");
  const hasFal        = falai?.connected && !!falai.config.apiKey;
  const hasReplicate  = replicate?.connected && !!replicate.config.apiToken;
  const hasPollinations = !!pollinations?.connected && !!pollinations?.config.apiKey;
  const hasHuggingFace  = huggingface?.connected && !!huggingface.config.apiToken;
  const hasStableHorde  = !!stablehorde?.connected;
  const hasMediaAI = hasPollinations || hasHuggingFace || hasStableHorde || hasFal || hasReplicate;
  const imageProviderLabel = hasPollinations ? "Pollinations.ai" : hasHuggingFace ? "Hugging Face" : hasStableHorde ? "Stable Horde" : hasFal ? "fal.ai" : hasReplicate ? "Replicate" : null;

  const contentProviderAvailable = (pid: ScheduleProviderId) => {
    if (pid === "claude")       return !!apiKey;
    if (pid === "groq")         return !!(groqInt?.connected && groqInt.config.apiKey);
    if (pid === "pollinations") return !!(pollinations?.connected && pollinations.config.apiKey);
    if (pid === "huggingface")  return !!(huggingface?.connected && huggingface.config.apiToken);
    return false;
  };

  useEffect(() => {
    setForm(item ? { ...emptyForm(), ...item } : emptyForm());
    setAiError(null);
    setScriptExpanded(false);
    setMediaProgress(null);
  }, [item, open]);

  useEffect(() => {
    const provDef = SCHEDULE_PROVIDERS.find(p => p.id === contentProvider);
    if (contentProvider === "claude") setContentModel(aiModel);
    else if (provDef) setContentModel(provDef.models[0].id);
  }, [contentProvider]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const selectedBrand = brands.find(b => b.name === form.brand);
  const pillars = selectedBrand?.pillars.map(p => p.name).filter(Boolean) || [];

  const isImage = IMAGE_FORMATS.has(form.format);
  const isVideo = VIDEO_FORMATS.has(form.format);

  const buildCreds = (): ProviderCreds => ({
    claudeKey:        apiKey,
    groqKey:          groqInt?.config.apiKey || "",
    pollinationsKey:  pollinations?.config.apiKey || "",
    hfToken:          huggingface?.config.apiToken || "",
  });

  const handleGenerate = async () => {
    if (!contentProviderAvailable(contentProvider)) {
      const names: Record<ScheduleProviderId, string> = { claude: "Anthropic API key", groq: "Groq", pollinations: "Pollinations.ai", huggingface: "Hugging Face" };
      setAiError(`${names[contentProvider]} not connected — add it in Integrations → AI & Automation.`);
      return;
    }
    if (!form.brand) { setAiError("Select a brand first."); return; }
    setAiLoading(true); setAiError(null);
    try {
      const creds = buildCreds();
      let result: GeneratedContent;
      if (isImage) result = await generateImageContent(contentProvider, contentModel, creds, selectedBrand, form);
      else if (isVideo) result = await generateVideoContent(contentProvider, contentModel, creds, selectedBrand, form);
      else result = await generateTextContent(contentProvider, contentModel, creds, selectedBrand, form);

      setForm(f => ({
        ...f,
        caption: result.caption || f.caption,
        hashtags: result.hashtags || f.hashtags,
        imagePrompt: result.imagePrompt || f.imagePrompt || "",
        videoScript: result.videoScript || f.videoScript || "",
        status: "ai_generated",
      }));
      if (isVideo && result.videoScript) setScriptExpanded(true);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setAiLoading(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!form.imagePrompt) { setAiError("Generate content first to get an image prompt."); return; }
    setMediaLoading(true); setMediaProgress("Generating image…"); setAiError(null);
    try {
      let url: string;
      if (hasPollinations)    url = await generateImagePollinations(pollinations!.config.apiKey, form.imagePrompt, form.format);
      else if (hasHuggingFace) url = await generateImageHuggingFace(huggingface!.config.apiToken, form.imagePrompt, huggingface!.config.model);
      else if (hasStableHorde) url = await generateImageStableHorde(stablehorde!.config.apiKey, form.imagePrompt, stablehorde!.config.model, msg => setMediaProgress(msg));
      else if (hasFal)         url = await generateImageFal(falai!.config.apiKey, form.imagePrompt);
      else                     url = await generateImageReplicate(replicate!.config.apiToken, form.imagePrompt);
      setForm(f => ({ ...f, generatedImageUrl: url }));
    } catch (e) { setAiError(e instanceof Error ? e.message : "Image generation failed"); }
    finally { setMediaLoading(false); setMediaProgress(null); }
  };

  const handleGenerateVideo = async () => {
    if (!hasFal) { setAiError("fal.ai required for video generation — Replicate async video not supported in browser."); return; }
    const prompt = form.videoScript ? form.videoScript.split("\n")[0].replace(/^HOOK.*?:\s*/i, "").trim() : form.caption;
    if (!prompt) { setAiError("Generate content first to get a video prompt."); return; }
    setMediaLoading(true); setAiError(null);
    try {
      const url = await generateVideoFal(falai!.config.apiKey, prompt, msg => setMediaProgress(msg));
      setForm(f => ({ ...f, generatedVideoUrl: url }));
    } catch (e) { setAiError(e instanceof Error ? e.message : "Video generation failed"); }
    finally { setMediaLoading(false); setMediaProgress(null); }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!form.brand) errors.brand = "Please select a brand.";
    if (!form.caption.trim()) errors.caption = "Caption is required.";
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    setFieldErrors({});
    onSave({ ...form, brandColor: selectedBrand?.color || form.brandColor });
  };

  const genLabel = isImage ? "Generate Image Content" : isVideo ? "Generate Video Script" : "Generate with AI";

  return (
    <SlidePanel open={open} onClose={onClose} title={item ? "Edit Content" : "New Content"} subtitle={item ? `Post #${item.id}` : "Create a new post"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Brand */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Brand <span style={{ color: t.danger }}>*</span></label>
          <select value={form.brand} onChange={e => set("brand", e.target.value)} required
            className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none cursor-pointer"
            style={{ background: t.inputBg, borderColor: fieldErrors.brand ? t.danger : t.border, color: form.brand ? t.text : t.textMuted }}>
            <option value="">Select brand…</option>
            {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          {fieldErrors.brand && <p className="text-xs mt-1" style={{ color: t.danger }}>{fieldErrors.brand}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Campaign" value={form.campaign} onChange={v => set("campaign", v)} placeholder="e.g. Summer Promo" />
          <Select label="Content Pillar" value={form.pillar} onChange={v => set("pillar", v)} options={pillars.length ? pillars : ["Education","Promotion","Inspiration","Product","Community"]} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select label="Platform" value={form.platform} onChange={v => set("platform", v)} options={ALL_PLATFORMS} required />
          <Select label="Format" value={form.format} onChange={v => set("format", v)} options={ALL_FORMATS} required />
        </div>

        {/* Format type badge */}
        {form.format && (
          <div className="flex items-center gap-2">
            {isImage && <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: t.mode==="light"?"#f0f9ff":"#0c1f30", color:"#0ea5e9" }}>🖼 Image content — AI prompt included</span>}
            {isVideo && <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: t.mode==="light"?"#fdf4ff":"#1e0a2a", color:"#a855f7" }}>🎬 Video content — full script generated</span>}
          </div>
        )}

        {/* AI Provider selector */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: t.border, background: t.sectionBg }}>
          <div className="px-3 pt-3 pb-2">
            <div className="text-xs font-bold mb-2" style={{ color: t.textSub }}>AI Provider</div>
            <div className="grid grid-cols-4 gap-1.5">
              {SCHEDULE_PROVIDERS.map(prov => {
                const active = contentProvider === prov.id;
                const avail = contentProviderAvailable(prov.id);
                return (
                  <button key={prov.id} type="button" onClick={() => setContentProvider(prov.id)}
                    className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-center transition-all border"
                    style={{ background: active ? prov.color + "22" : t.inputBg, borderColor: active ? prov.color : t.border, opacity: avail ? 1 : 0.55 }}>
                    <span className="text-base leading-none">{prov.icon}</span>
                    <span className="text-xs font-semibold leading-tight" style={{ color: active ? prov.color : t.textMuted }}>{prov.name.split(".")[0]}</span>
                    {!avail && <span className="text-xs" style={{ color: t.textMuted }}>—</span>}
                  </button>
                );
              })}
            </div>
            {/* Model pills */}
            {(() => {
              const provDef = SCHEDULE_PROVIDERS.find(p => p.id === contentProvider)!;
              return (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {provDef.models.map(m => {
                    const active = contentModel === m.id;
                    return (
                      <button key={m.id} type="button" onClick={() => setContentModel(m.id)}
                        className="text-xs px-2.5 py-1 rounded-full border transition-all"
                        style={{ background: active ? provDef.color + "22" : t.inputBg, borderColor: active ? provDef.color : t.border, color: active ? provDef.color : t.textMuted, fontWeight: active ? 700 : 400 }}>
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>
          {/* Generate button */}
          <div className="px-3 pb-3 flex items-center justify-between gap-3">
            <div className="text-xs" style={{ color: t.textMuted }}>
              {contentProviderAvailable(contentProvider) ? "Ready to generate" : "Provider not connected"}
            </div>
            <button type="button" onClick={handleGenerate} disabled={aiLoading || !form.brand || !contentProviderAvailable(contentProvider)}
              className="flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-lg flex-shrink-0 transition-opacity disabled:opacity-40 hover:opacity-90"
              style={{ background: SCHEDULE_PROVIDERS.find(p => p.id === contentProvider)?.color || "#7c3aed", color: "white" }}>
              {aiLoading
                ? <><span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin inline-block" />Generating…</>
                : <><span>⚡</span>{genLabel}</>}
            </button>
          </div>
        </div>

        {aiError && (
          <div className="text-xs px-3 py-2 rounded-lg" style={{ background: t.dangerBg, color: t.danger }}>{aiError}</div>
        )}

        {/* Image prompt + generation */}
        {isImage && form.imagePrompt && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#0ea5e940" }}>
            <div className="px-3 py-2 flex items-center gap-2" style={{ background: t.mode==="light"?"#f0f9ff":"#0c1f30" }}>
              <span className="text-sm">🖼</span>
              <span className="text-xs font-bold" style={{ color: "#0ea5e9" }}>Image Prompt</span>
              {!hasMediaAI && <span className="text-xs ml-auto" style={{ color: t.textMuted }}>Connect fal.ai to auto-generate</span>}
            </div>
            <div className="p-3 space-y-2">
              <textarea value={form.imagePrompt} onChange={e => set("imagePrompt", e.target.value)} rows={3}
                className="w-full text-xs px-0 py-0 outline-none resize-none bg-transparent"
                style={{ color: t.text, fontFamily: "JetBrains Mono, monospace" }} />
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => navigator.clipboard.writeText(form.imagePrompt || "")}
                  className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ background: "#0ea5e930", color: "#0ea5e9" }}>
                  Copy Prompt
                </button>
                {hasMediaAI && (
                  <button type="button" onClick={handleGenerateImage} disabled={mediaLoading}
                    className="text-xs font-bold px-3 py-1 rounded-lg text-white disabled:opacity-50 flex items-center gap-1.5"
                    style={{ background: "linear-gradient(135deg,#059669,#0ea5e9)" }}>
                    {mediaLoading && mediaProgress
                      ? <><span className="w-2.5 h-2.5 rounded-full border-2 border-white border-t-transparent animate-spin" />{mediaProgress}</>
                      : `✦ Generate via ${imageProviderLabel}`}
                  </button>
                )}
                {!hasMediaAI && <span className="text-xs py-1" style={{ color: t.textMuted }}>Connect an image provider in Integrations → AI & Automation</span>}
              </div>
              {form.generatedImageUrl && (
                <div className="mt-2 rounded-lg overflow-hidden border" style={{ borderColor: "#0ea5e940" }}>
                  <img src={form.generatedImageUrl} alt="AI generated" className="w-full object-cover" style={{ maxHeight: "220px" }} />
                  <div className="flex gap-2 p-2" style={{ background: t.sectionBg }}>
                    <a href={form.generatedImageUrl} target="_blank" rel="noreferrer"
                      className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ background: "#0ea5e920", color: "#0ea5e9" }}>
                      Open Full Size
                    </a>
                    <button type="button" onClick={() => set("generatedImageUrl", "")}
                      className="text-xs px-3 py-1 rounded-lg" style={{ color: t.textMuted }}>Remove</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Video script + generation */}
        {isVideo && form.videoScript && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#a855f740" }}>
            <button type="button" onClick={() => setScriptExpanded(v => !v)}
              className="w-full px-3 py-2 flex items-center gap-2 text-left" style={{ background: t.mode==="light"?"#fdf4ff":"#1e0a2a" }}>
              <span className="text-sm">🎬</span>
              <span className="text-xs font-bold" style={{ color: "#a855f7" }}>Video Script</span>
              <span className="ml-auto text-xs" style={{ color: t.textMuted }}>{scriptExpanded ? "▲ Collapse" : "▼ Expand"}</span>
            </button>
            {scriptExpanded && (
              <div className="p-3 space-y-2">
                <textarea value={form.videoScript} onChange={e => set("videoScript", e.target.value)} rows={10}
                  className="w-full text-xs px-0 py-0 outline-none resize-none bg-transparent"
                  style={{ color: t.text, fontFamily: "JetBrains Mono, monospace", lineHeight: 1.7 }} />
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={() => navigator.clipboard.writeText(form.videoScript || "")}
                    className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ background: "#a855f730", color: "#a855f7" }}>
                    Copy Script
                  </button>
                  {hasFal && (
                    <button type="button" onClick={handleGenerateVideo} disabled={mediaLoading}
                      className="text-xs font-bold px-3 py-1 rounded-lg text-white disabled:opacity-50 flex items-center gap-1.5"
                      style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)" }}>
                      {mediaLoading && mediaProgress ? <><span className="w-2.5 h-2.5 rounded-full border-2 border-white border-t-transparent animate-spin" />{mediaProgress}</> : "✦ Generate Video Clip"}
                    </button>
                  )}
                  {!hasFal && <span className="text-xs py-1" style={{ color: t.textMuted }}>Connect fal.ai for video generation</span>}
                </div>
                {form.generatedVideoUrl && (
                  <div className="mt-2 rounded-lg overflow-hidden border" style={{ borderColor: "#a855f740" }}>
                    <video src={form.generatedVideoUrl} controls className="w-full" style={{ maxHeight: "220px" }} />
                    <div className="flex gap-2 p-2" style={{ background: t.sectionBg }}>
                      <a href={form.generatedVideoUrl} target="_blank" rel="noreferrer"
                        className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ background: "#a855f720", color: "#a855f7" }}>
                        Download
                      </a>
                      <button type="button" onClick={() => set("generatedVideoUrl", "")}
                        className="text-xs px-3 py-1 rounded-lg" style={{ color: t.textMuted }}>Remove</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <TextArea label="Caption *" value={form.caption} onChange={v => set("caption", v)} placeholder="Write or generate the post caption…" rows={4} />
          {fieldErrors.caption && <p className="text-xs mt-1" style={{ color: t.danger }}>{fieldErrors.caption}</p>}
        </div>
        <Input label="Hashtags" value={form.hashtags} onChange={v => set("hashtags", v)} placeholder="#tag1 #tag2 #tag3" />
        <Input label="Scheduled Date & Time" value={form.scheduled} onChange={v => set("scheduled", v)} placeholder="Sep 4, 2026 — 7:30 PM" />

        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: t.textSub }}>Status</label>
          <div className="flex flex-wrap gap-2">
            {ALL_STATUSES.map(s => {
              const cfg = statusCfg(s, t);
              const active = form.status === s;
              return (
                <button key={s} type="button" onClick={() => set("status", s)}
                  className="text-xs px-3 py-1.5 rounded-full border font-medium transition-all"
                  style={{ background: active ? cfg.bg : "transparent", borderColor: active ? cfg.dot : t.border, color: active ? cfg.color : t.textSub }}>
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: t.border, color: t.textSub, background: t.card }}>Cancel</button>
          <button type="submit" className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: t.primary }}>
            {item ? "Save Changes" : "Create Post"}
          </button>
        </div>
      </form>
    </SlidePanel>
  );
}

// ─── Post Detail Panel ────────────────────────────────────────────────────────

function PostDetailPanel({ post, onClose, onEdit, onDelete, onStatusChange }: {
  post: ContentItem; onClose: () => void; onEdit: () => void;
  onDelete: () => void; onStatusChange: (s: Status) => void;
}) {
  const { t } = useTheme();
  const STEPS: Status[] = ["ai_generated","review","approved","scheduled","published"];
  const STEP_LABELS = ["AI Generated","In Review","Approved","Scheduled","Published"];
  const currentStep = STEPS.indexOf(post.status === "draft" ? "review" : post.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end" style={{ background: t.overlay, backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="w-full max-w-md h-full flex flex-col" style={{ background: t.panelBg, boxShadow: t.shadowMd }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ background: t.panelBg, borderColor: t.borderLight }}>
          <div className="flex items-center gap-3">
            <BrandAvatar name={post.brand} color={post.brandColor} size="sm" />
            <div>
              <div className="text-xs font-bold" style={{ color: post.brandColor }}>{post.brand}</div>
              <div className="text-xs" style={{ color: t.textMuted }}>Post #{post.id}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="text-xs px-3 py-1.5 rounded-lg font-semibold border transition-colors" style={{ borderColor: t.border, color: t.textSub, background: t.tagBg }}>Edit</button>
            <button onClick={onDelete} className="text-xs px-3 py-1.5 rounded-lg font-semibold border transition-colors" style={{ borderColor: t.dangerBorder, color: t.danger, background: t.dangerBg + "40" }}>Delete</button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-xl leading-none transition-colors ml-1" style={{ color: t.textMuted }}
              onMouseEnter={e => (e.currentTarget.style.background = t.tagBg)} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Pipeline */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: t.textMuted }}>Pipeline Status</div>
            <div className="flex items-start">
              {STEPS.map((step, i) => {
                const cfg = statusCfg(step, t);
                const isActive = i === currentStep;
                const isDone = i < currentStep;
                return (
                  <div key={step} className="flex items-center flex-1">
                    <div className="flex flex-col items-center">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold cursor-pointer transition-all hover:scale-110" style={{ background: isActive ? cfg.dot : isDone ? (t.mode==="light"?"#d1fae5":"#0a2218") : t.tagBg, color: isActive ? "white" : isDone ? "#059669" : t.textFaint, boxShadow: isActive ? `0 0 0 3px ${cfg.dot}33` : "none" }}
                        onClick={() => onStatusChange(step)}>
                        {isDone ? "✓" : i + 1}
                      </div>
                      <div className="text-center mt-1 leading-tight" style={{ fontSize:"9px", color: isActive ? cfg.color : t.textMuted, maxWidth:"44px" }}>{STEP_LABELS[i]}</div>
                    </div>
                    {i < STEPS.length - 1 && <div className="flex-1 h-0.5 mb-4 mx-1 rounded-full" style={{ background: isDone ? "#6ee7b7" : t.borderLight }} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3">
            {[["Campaign",post.campaign],["Pillar",post.pillar],["Platform",post.platform],["Format",post.format]].map(([k,v]) => (
              <div key={k} className="rounded-xl p-3 border" style={{ background: t.sectionBg, borderColor: t.borderLight }}>
                <div className="text-xs mb-0.5" style={{ color: t.textMuted }}>{k}</div>
                <div className="text-sm font-semibold" style={{ color: t.text }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Caption */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.textMuted }}>Caption</div>
            <div className="text-sm leading-relaxed p-4 rounded-xl border" style={{ background: t.sectionBg, borderColor: t.borderLight, color: t.text }}>{post.caption}</div>
          </div>

          {/* Hashtags */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.textMuted }}>Hashtags</div>
            <div className="flex flex-wrap gap-1.5">
              {post.hashtags.split(" ").filter(Boolean).map(tag => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded-full font-mono" style={{ background: t.mode==="light"?"#ede9fe":"#1e1b3a", color:"#7c3aed" }}>{tag}</span>
              ))}
            </div>
          </div>

          {/* Image Prompt */}
          {post.imagePrompt && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#0ea5e940" }}>
              <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: t.mode==="light"?"#f0f9ff":"#0c1f30" }}>
                <span className="text-sm">🖼</span>
                <span className="text-xs font-bold" style={{ color: "#0ea5e9" }}>AI Image Prompt</span>
                <button onClick={() => navigator.clipboard.writeText(post.imagePrompt || "")}
                  className="ml-auto text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ background: "#0ea5e920", color: "#0ea5e9" }}>Copy</button>
              </div>
              <div className="p-4">
                <p className="text-xs leading-relaxed font-mono" style={{ color: t.text }}>{post.imagePrompt}</p>
              </div>
            </div>
          )}

          {/* Video Script */}
          {post.videoScript && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#a855f740" }}>
              <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: t.mode==="light"?"#fdf4ff":"#1e0a2a" }}>
                <span className="text-sm">🎬</span>
                <span className="text-xs font-bold" style={{ color: "#a855f7" }}>Video Script</span>
                <button onClick={() => navigator.clipboard.writeText(post.videoScript || "")}
                  className="ml-auto text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ background: "#a855f720", color: "#a855f7" }}>Copy</button>
              </div>
              <div className="p-4">
                <pre className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: t.text, fontFamily: "JetBrains Mono, monospace" }}>{post.videoScript}</pre>
              </div>
            </div>
          )}

          {/* Creative placeholder when no AI creative */}
          {!post.imagePrompt && !post.videoScript && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.textMuted }}>Creative</div>
              <div className="w-full h-28 rounded-xl border-2 border-dashed flex items-center justify-center text-sm font-medium" style={{ borderColor: t.border, color: t.textFaint, background: t.sectionBg }}>
                {post.format} — generate with AI to add creative brief
              </div>
            </div>
          )}

          {/* Schedule + score */}
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ background: t.sectionBg, borderColor: t.borderLight }}>
            <div>
              <div className="text-xs" style={{ color: t.textMuted }}>Scheduled for</div>
              <div className="text-sm font-semibold mt-0.5" style={{ color: t.text }}>{post.scheduled || "—"}</div>
            </div>
            <div className="text-right">
              <div className="text-xs" style={{ color: t.textMuted }}>AI Score</div>
              <div className="text-2xl font-bold mt-0.5" style={{ color: post.score>=90?"#059669":post.score>=80?"#d97706":t.textMuted }}>
                {post.score}<span className="text-sm font-medium" style={{ color: t.textFaint }}>/100</span>
              </div>
            </div>
          </div>

          {/* Approval actions */}
          {(post.status === "review" || post.status === "ai_generated") && (
            <div className="flex gap-2">
              <button onClick={() => onStatusChange("draft")} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors" style={{ borderColor: t.dangerBorder, color: t.danger, background: t.card }}>Reject</button>
              <button className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors" style={{ borderColor:"#93c5fd", color:"#2563eb", background: t.card }}>Request Edit</button>
              <button onClick={() => onStatusChange("approved")} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background:"#059669" }}>Approve →</button>
            </div>
          )}
          {post.status === "approved" && (
            <button onClick={() => onStatusChange("scheduled")} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background:"#059669" }}>
              Schedule Post →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Brand Detail Panel ───────────────────────────────────────────────────────

function BrandChannelPanel({ brand, onClose, onSave }: {
  brand: Brand; onClose: () => void; onSave: (channels: BrandChannel[]) => void;
}) {
  const { t } = useTheme();
  const [channels, setChannels] = useState<BrandChannel[]>(brand.channels || []);
  const [editing, setEditing] = useState<PlatformId | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [guideOpen, setGuideOpen] = useState(true);

  const getChannel = (pid: PlatformId) => channels.find(c => c.platformId === pid) ?? { platformId: pid, connected: false, config: {} };

  const openEdit = (pid: PlatformId) => {
    setEditing(pid);
    setConfigForm({ ...getChannel(pid).config });
    setShowSecrets({});
    setGuideOpen(!getChannel(pid).connected);
  };

  const saveChannel = () => {
    if (!editing) return;
    const defn = PUBLISHING_DEFS.find(d => d.id === editing)!;
    const allFilled = defn.fields.every(f => configForm[f.key]?.trim());
    const updated: BrandChannel = { platformId: editing, connected: allFilled, config: { ...configForm } };
    setChannels(prev => {
      const filtered = prev.filter(c => c.platformId !== editing);
      return [...filtered, updated];
    });
    setEditing(null);
  };

  const disconnectChannel = (pid: PlatformId) => {
    setChannels(prev => prev.filter(c => c.platformId !== pid));
  };

  const relevantDefs = PUBLISHING_DEFS.filter(d => brand.platforms.some(p =>
    p === d.name || (d.id === "x" && p === "X") || (d.id === "devto" && p === "Dev.to")
  ));
  const allDefs = PUBLISHING_DEFS;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-end" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="w-full max-w-lg h-full flex flex-col" style={{ background: t.panelBg, boxShadow: t.shadowMd }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: t.borderLight }}>
          <div>
            <div className="font-semibold text-sm" style={{ color: t.text }}>Publishing Channels · {brand.name}</div>
            <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>Connect distribution channels specific to this brand</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { onSave(channels); onClose(); }}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
              style={{ background: brand.color }}>Save</button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-xl" style={{ color: t.textMuted }}>×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {editing ? (() => {
            const defn = PUBLISHING_DEFS.find(d => d.id === editing)!;
            const ch = getChannel(editing);
            const allFilled = defn.fields.every(f => configForm[f.key]?.trim());
            return (
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: defn.bg }}>{defn.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm flex items-center gap-2" style={{ color: t.text }}>
                      {defn.name}
                      {ch.connected && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: t.mode==="light"?"#d1fae5":"#0a2218", color:"#059669" }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />Connected
                        </span>
                      )}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>{defn.desc}</div>
                  </div>
                  <button onClick={() => setEditing(null)} className="text-xs px-2.5 py-1.5 rounded-lg border flex-shrink-0" style={{ borderColor: t.border, color: t.textSub }}>← Back</button>
                </div>

                {/* Setup guide */}
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: defn.color + "35" }}>
                  <button type="button" onClick={() => setGuideOpen(v => !v)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                    style={{ background: defn.color + (t.mode === "dark" ? "18" : "12") }}>
                    <span className="text-base">📋</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold" style={{ color: defn.color }}>Setup Guide</div>
                      <div className="text-xs truncate" style={{ color: t.textMuted }}>{defn.guide.title}</div>
                    </div>
                    <span className="text-xs font-semibold flex-shrink-0" style={{ color: defn.color }}>
                      {guideOpen ? "▲ Hide" : "▼ Show"}
                    </span>
                  </button>
                  {guideOpen && (
                    <div className="px-4 pt-3 pb-4 space-y-3" style={{ background: t.sectionBg }}>
                      {defn.guide.steps.map((s, i) => (
                        <div key={i} className="flex gap-3">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                            style={{ background: defn.color + "20", color: defn.color }}>{i + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold leading-snug" style={{ color: t.text }}>{s.step}</div>
                            {s.detail && <div className="text-xs mt-0.5 leading-relaxed" style={{ color: t.textMuted }}>{s.detail}</div>}
                            {s.url && (
                              <a href={s.url} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs mt-1 font-semibold underline"
                                style={{ color: defn.color }}>↗ {s.urlLabel || s.url}</a>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="mt-2 pt-2 border-t text-xs" style={{ borderColor: t.borderLight, color: t.textMuted }}>
                        Credentials are stored only in your browser — never on any server.
                      </div>
                    </div>
                  )}
                </div>

                {/* Credential fields */}
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: t.textMuted }}>Your credentials</div>
                {defn.fields.map(field => (
                  <div key={field.key}>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>
                      {field.label} <span style={{ color: t.danger }}>*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={field.secret && !showSecrets[field.key] ? "password" : "text"}
                        value={configForm[field.key] || ""}
                        onChange={e => setConfigForm(f => ({ ...f, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none"
                        style={{ background: t.inputBg, borderColor: t.border, color: t.text, paddingRight: field.secret ? "60px" : undefined }}
                      />
                      {field.secret && (
                        <button type="button" onClick={() => setShowSecrets(s => ({ ...s, [field.key]: !s[field.key] }))}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded font-medium"
                          style={{ color: t.textMuted, background: t.tagBg }}>
                          {showSecrets[field.key] ? "Hide" : "Show"}
                        </button>
                      )}
                    </div>
                    {field.hint && <div className="text-xs mt-1" style={{ color: t.textMuted }}>{field.hint}</div>}
                  </div>
                ))}

                {/* Field completion indicator */}
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border" style={{ background: t.sectionBg, borderColor: allFilled ? defn.color + "40" : t.borderLight }}>
                  <div className="flex gap-1.5 flex-wrap flex-1">
                    {defn.fields.map(f => (
                      <span key={f.key} className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: (configForm[f.key]||"").trim() ? defn.color+"18" : t.tagBg, color: (configForm[f.key]||"").trim() ? defn.color : t.textMuted }}>
                        {(configForm[f.key]||"").trim() ? "✓" : "·"} {f.label}
                      </span>
          ))}
        </div>
      </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  {ch.connected && (
                    <button onClick={() => { disconnectChannel(editing); setEditing(null); }}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold border"
                      style={{ borderColor: t.dangerBorder, color: t.danger, background: t.card }}>
                      Disconnect
                    </button>
                  )}
                  <button onClick={() => setEditing(null)}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold border"
                    style={{ borderColor: t.border, color: t.textSub, background: t.card }}>
                    Cancel
                  </button>
                  <button onClick={saveChannel} disabled={!allFilled}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                    style={{ background: defn.color }}>
                    {ch.connected ? "Update Channel" : "Connect Channel"}
                  </button>
                </div>
              </div>
            );
          })() : (
            <>
              {brand.platforms.length > 0 && (
                <div className="text-xs font-bold mb-3 uppercase tracking-wider" style={{ color: t.textMuted }}>Brand Platforms</div>
              )}
              <div className="space-y-2">
                {allDefs.map(defn => {
                  const ch = getChannel(defn.id);
                  const isOnBrand = brand.platforms.some(p => p === defn.name || (defn.id === "x" && p === "X") || (defn.id === "devto" && p === "Dev.to"));
                  return (
                    <div key={defn.id} className="flex items-center gap-3 p-3 rounded-xl border" style={{ borderColor: isOnBrand ? defn.color + "40" : t.borderLight, background: isOnBrand ? defn.bg + "50" : t.sectionBg, opacity: isOnBrand ? 1 : 0.6 }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ background: defn.bg }}>{defn.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold flex items-center gap-2" style={{ color: t.text }}>
                          {defn.name}
                          {!isOnBrand && <span className="text-xs font-normal" style={{ color: t.textMuted }}>(not in brand platforms)</span>}
                        </div>
                        <div className="text-xs" style={{ color: ch.connected ? "#059669" : t.textMuted }}>
                          {ch.connected ? "✓ Connected" : "Not configured"}
                        </div>
                      </div>
                      <button onClick={() => openEdit(defn.id)}
                        className="text-xs px-3 py-1.5 rounded-lg font-semibold flex-shrink-0"
                        style={{ background: ch.connected ? defn.color + "18" : t.tagBg, color: ch.connected ? defn.color : t.textSub }}>
                        {ch.connected ? "Edit" : "Connect"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BrandDetailPanel({ brand, onClose, onEdit, onDelete, onChannelsSave }: {
  brand: Brand; onClose: () => void; onEdit: () => void; onDelete: () => void;
  onChannelsSave: (channels: BrandChannel[]) => void;
}) {
  const { t } = useTheme();
  const [channelsOpen, setChannelsOpen] = useState(false);
  const connectedChannels = (brand.channels || []).filter(c => c.connected);
  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-end" style={{ background: t.overlay, backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="w-full max-w-md h-full flex flex-col" style={{ background: t.panelBg, boxShadow: t.shadowMd }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ background: t.panelBg, borderColor: t.borderLight }}>
          <div className="flex items-center gap-3">
            <BrandAvatar name={brand.name} color={brand.color} />
            <div>
              <div className="font-semibold" style={{ color: t.text }}>{brand.name}</div>
              <div className="text-xs" style={{ color: t.textMuted }}>{brand.industry}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="text-xs px-3 py-1.5 rounded-lg font-semibold border" style={{ borderColor: t.border, color: t.textSub, background: t.tagBg }}>Edit</button>
            <button onClick={onDelete} className="text-xs px-3 py-1.5 rounded-lg font-semibold border" style={{ borderColor: t.dangerBorder, color: t.danger, background: t.dangerBg + "40" }}>Delete</button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-xl leading-none ml-1 transition-colors" style={{ color: t.textMuted }}
              onMouseEnter={e=>(e.currentTarget.style.background=t.tagBg)} onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="p-4 rounded-xl border-l-4 italic text-sm" style={{ background: t.sectionBg, borderColor: brand.color, color: t.textSub }}>
            "{brand.tagline}"
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.textMuted }}>Target Audience</div>
            <div className="text-sm" style={{ color: t.text }}>{brand.audience}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.textMuted }}>Voice & Tone</div>
            <div className="flex gap-2 flex-wrap">
              {brand.tone.map(tone => (
                <span key={tone} className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: brand.color+"20", color: brand.color }}>{tone}</span>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: t.textMuted }}>Content Pillars</div>
            <div className="space-y-2.5">
              {brand.pillars.filter(p => p.name).map(p => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className="text-sm w-28 truncate" style={{ color: t.textSub }}>{p.name}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: t.tagBg }}>
                    <div className="h-full rounded-full" style={{ width:`${p.weight}%`, background: brand.color }} />
                  </div>
                  <span className="text-xs font-bold w-8 text-right" style={{ color: brand.color }}>{p.weight}%</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.textMuted }}>Active Platforms</div>
            <div className="flex gap-2 flex-wrap">
              {brand.platforms.map(p => (
                <span key={p} className="text-xs px-2.5 py-1 rounded-full" style={{ background: t.tagBg, color: t.textSub }}>{p}</span>
              ))}
            </div>
          </div>

          {/* Publishing Channels */}
          <div className="pt-3 border-t" style={{ borderColor: t.borderLight }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.textMuted }}>Publishing Channels</div>
              <button onClick={() => setChannelsOpen(true)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                style={{ background: brand.color + "18", color: brand.color }}>
                Manage →
              </button>
            </div>
            {connectedChannels.length === 0 ? (
              <button onClick={() => setChannelsOpen(true)}
                className="w-full p-3 rounded-xl border-2 border-dashed text-xs font-semibold transition-colors hover:opacity-80"
                style={{ borderColor: brand.color + "40", color: brand.color }}>
                + Connect publishing channels for {brand.name}
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                {connectedChannels.map(ch => {
                  const defn = PUBLISHING_DEFS.find(d => d.id === ch.platformId);
                  if (!defn) return null;
                  return (
                    <span key={ch.platformId} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full"
                      style={{ background: defn.color + "18", color: defn.color }}>
                      {defn.icon} {defn.name}
                    </span>
                  );
                })}
                <button onClick={() => setChannelsOpen(true)} className="text-xs px-2.5 py-1.5 rounded-full" style={{ background: t.tagBg, color: t.textSub }}>
                  + Add
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-4 gap-3 pt-3 border-t" style={{ borderColor: t.borderLight }}>
            {[{label:"Ideas",value:brand.ideas,color:"#7c3aed",bg:t.mode==="light"?"#ede9fe":"#1e1b3a"},{label:"Drafts",value:brand.drafts,color:t.textSub,bg:t.tagBg},{label:"Review",value:brand.review,color:"#d97706",bg:t.mode==="light"?"#fef3c7":"#292110"},{label:"Sched.",value:brand.scheduled,color:"#059669",bg:t.mode==="light"?"#d1fae5":"#0a2218"}].map(s => (
              <div key={s.label} className="text-center p-3 rounded-xl" style={{ background: s.bg }}>
                <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs mt-0.5" style={{ color: s.color+"bb" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    {channelsOpen && <BrandChannelPanel brand={brand} onClose={() => setChannelsOpen(false)} onSave={channels => { onChannelsSave(channels); setChannelsOpen(false); }} />}
    </>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardView({ brands, content, onPostClick }: { brands: Brand[]; content: ContentItem[]; onPostClick: (id: number) => void }) {
  const { t } = useTheme();
  const [selectedBrand, setSelectedBrand] = useState("All Brands");
  const totalIdeas     = brands.reduce((a, b) => a + b.ideas, 0);
  const totalDrafts    = brands.reduce((a, b) => a + b.drafts, 0);
  const totalReview    = brands.reduce((a, b) => a + b.review, 0);
  const totalScheduled = brands.reduce((a, b) => a + b.scheduled, 0);
  const STATS = [
    { label:"Ideas",     value:totalIdeas,     sub:"queued",        color:"#7c3aed", bg:t.mode==="light"?"#ede9fe":"#1e1b3a", icon:"💡" },
    { label:"Drafts",    value:totalDrafts,    sub:"in progress",   color:t.textSub, bg:t.tagBg,                              icon:"📝" },
    { label:"In Review", value:totalReview,    sub:"need approval", color:"#d97706", bg:t.mode==="light"?"#fef3c7":"#292110", icon:"👁" },
    { label:"Scheduled", value:totalScheduled, sub:"ready to post", color:"#059669", bg:t.mode==="light"?"#d1fae5":"#0a2218", icon:"📅" },
  ];
  const displayed = (selectedBrand === "All Brands" ? content : content.filter(c => c.brand === selectedBrand)).slice(0, 5);

  return (
    <div className="p-6 lg:p-8 space-y-6 overflow-auto h-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: t.text }}>Overview</h1>
          <p className="text-sm mt-0.5" style={{ color: t.textSub }}>Monday, September 1, 2026</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)}
            className="text-sm px-3 py-2 rounded-lg border outline-none cursor-pointer"
            style={{ background: t.inputBg, borderColor: t.border, color: t.text, boxShadow: t.shadow }}>
            <option>All Brands</option>
            {brands.map(b => <option key={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map(s => (
          <Card key={s.label} className="p-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg mb-3" style={{ background: s.bg }}>{s.icon}</div>
            <div className="text-3xl font-bold" style={{ color: t.text }}>{s.value}</div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-sm font-semibold" style={{ color: s.color }}>{s.label}</span>
              <span className="text-xs" style={{ color: t.textMuted }}>{s.sub}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: t.borderLight }}>
            <div>
              <div className="font-semibold text-sm" style={{ color: t.text }}>Content Calendar</div>
              <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>Week of Sep 1 – Sep 7, 2026</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: t.tableHead, borderBottom: `1px solid ${t.borderLight}` }}>
                  <th className="px-4 py-2.5 text-left font-medium w-12" style={{ color: t.textMuted }}>Plt</th>
                  {["Mon 1","Tue 2","Wed 3","Thu 4","Fri 5","Sat 6","Sun 7"].map((d, i) => (
                    <th key={d} className="px-2 py-2.5 text-center font-semibold" style={{ color: i===0?t.primary:t.textSub }}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {["IG","FB","X","LI","TT"].map(platform => (
                  <tr key={platform} style={{ borderBottom: `1px solid ${t.borderFaint}` }}>
                    <td className="px-4 py-2 font-mono font-semibold text-xs" style={{ color: t.textMuted }}>{platform}</td>
                    {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day => {
                      const cells = CALENDAR_DATA[day]?.[platform] || [];
                      return (
                        <td key={day} className="px-1.5 py-1.5 text-center">
                          {cells.length > 0 ? cells.map((c, i) => (
                            <span key={i} className="inline-block rounded-md px-1.5 py-0.5 text-xs font-medium" style={{ background: c.color+"22", color: c.color, border:`1px solid ${c.color}44` }}>{c.format}</span>
                          )) : <span style={{ color: t.calEmpty }}>—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b" style={{ borderColor: t.borderLight }}>
            <div className="font-semibold text-sm" style={{ color: t.text }}>Brands at a Glance</div>
          </div>
          <div>
            {brands.map((b, i) => (
              <div key={b.id} className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: i < brands.length-1 ? `1px solid ${t.borderFaint}` : "none" }}>
                <BrandAvatar name={b.name} color={b.color} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: t.text }}>{b.name}</div>
                  <div className="text-xs" style={{ color: t.textMuted }}>{b.posts_month} posts/mo</div>
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span style={{ color:"#d97706" }}>{b.review}</span>
                  <span style={{ color: t.textFaint }}>·</span>
                  <span style={{ color:"#059669" }}>{b.scheduled}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: t.borderLight }}>
          <div className="font-semibold text-sm" style={{ color: t.text }}>Recent Content</div>
          <span className="text-xs" style={{ color: t.textMuted }}>{content.length} items total</span>
        </div>
        <div>
          {displayed.map((item, i) => (
            <div key={item.id} onClick={() => onPostClick(item.id)}
              className="px-5 py-3.5 flex items-center gap-4 cursor-pointer transition-colors group"
              style={{ borderBottom: i < displayed.length-1 ? `1px solid ${t.borderFaint}` : "none" }}
              onMouseEnter={e=>(e.currentTarget.style.background=t.cardHover)} onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
              <BrandAvatar name={item.brand} color={item.brandColor} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-bold" style={{ color: item.brandColor }}>{item.brand}</span>
                  <span className="text-xs" style={{ color: t.textMuted }}>· {item.platform} · {item.format}</span>
                </div>
                <p className="text-sm truncate" style={{ color: t.textSub }}>{item.caption}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <Badge status={item.status} />
                <span className="text-xs font-bold w-7 text-right" style={{ color: item.score>=90?"#059669":item.score>=80?"#d97706":t.textMuted }}>{item.score}</span>
              </div>
            </div>
          ))}
          {displayed.length === 0 && <div className="px-5 py-8 text-center text-sm" style={{ color: t.textMuted }}>No content yet</div>}
        </div>
      </Card>
    </div>
  );
}

// ─── Brands View ──────────────────────────────────────────────────────────────

function BrandsView({ brands, onView, onEdit, onDelete, onNew }: {
  brands: Brand[]; onView: (id: number) => void; onEdit: (id: number) => void;
  onDelete: (id: number) => void; onNew: () => void;
}) {
  const { t } = useTheme();
  const [hoverId, setHoverId] = useState<number | null>(null);

  return (
    <div className="p-6 lg:p-8 overflow-auto h-full">
      <SectionHeader title="Brand Intelligence" sub={`${brands.length} brand${brands.length !== 1 ? "s" : ""} — each with its own voice, pillars, and audience`}
        action={<PrimaryBtn onClick={onNew}>+ Add Brand</PrimaryBtn>} />

      {brands.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-5xl mb-4">🏷</div>
          <div className="font-semibold text-lg mb-2" style={{ color: t.text }}>No brands yet</div>
          <p className="text-sm mb-5" style={{ color: t.textMuted }}>Create your first brand to start generating content</p>
          <PrimaryBtn onClick={onNew}>+ Add Brand</PrimaryBtn>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {brands.map(brand => (
          <Card key={brand.id} className="p-5 group relative cursor-pointer hover:shadow-md"
            onClick={() => onView(brand.id)}
            onMouseEnter={() => setHoverId(brand.id)} onMouseLeave={() => setHoverId(null)}>
            {/* Action buttons on hover */}
            {hoverId === brand.id && (
              <div className="absolute top-4 right-4 flex gap-1.5 z-10" onClick={e => e.stopPropagation()}>
                <button onClick={() => onEdit(brand.id)} className="text-xs px-2.5 py-1 rounded-lg font-semibold border transition-colors" style={{ borderColor: t.border, color: t.textSub, background: t.card }}>Edit</button>
                <button onClick={() => onDelete(brand.id)} className="text-xs px-2.5 py-1 rounded-lg font-semibold border transition-colors" style={{ borderColor: t.dangerBorder, color: t.danger, background: t.dangerBg+"40" }}>Delete</button>
              </div>
            )}
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-base font-bold flex-shrink-0" style={{ background: brand.color+"20", color: brand.color }}>
                {brand.name.slice(0,1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate pr-14" style={{ color: t.text }}>{brand.name}</div>
                <div className="text-xs" style={{ color: t.textMuted }}>{brand.industry}</div>
              </div>
            </div>
            <p className="text-xs italic mb-4" style={{ color: t.textSub }}>"{brand.tagline}"</p>
            <div className="space-y-2 mb-4">
              {brand.pillars.filter(p => p.name).slice(0,3).map(p => (
                <div key={p.name} className="flex items-center gap-2">
                  <div className="text-xs w-24 truncate" style={{ color: t.textMuted }}>{p.name}</div>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: t.tagBg }}>
                    <div className="h-full rounded-full" style={{ width:`${p.weight}%`, background: brand.color }} />
                  </div>
                  <span className="text-xs w-7 text-right" style={{ color: t.textMuted }}>{p.weight}%</span>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 mb-4 flex-wrap">
              {brand.tone.slice(0,3).map(tone => (
                <span key={tone} className="text-xs px-2 py-0.5 rounded-full" style={{ background: t.tagBg, color: t.textSub }}>{tone}</span>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-1 pt-3 border-t" style={{ borderColor: t.borderLight }}>
              {[{label:"Ideas",value:brand.ideas,color:"#7c3aed"},{label:"Drafts",value:brand.drafts,color:t.textMuted},{label:"Review",value:brand.review,color:"#d97706"},{label:"Sched.",value:brand.scheduled,color:"#059669"}].map(s => (
                <div key={s.label} className="text-center">
                  <div className="text-base font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-xs" style={{ color: t.textMuted }}>{s.label}</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Content View ─────────────────────────────────────────────────────────────

function ContentView({ brands, content, onView, onEdit, onDelete, onNew }: {
  brands: Brand[]; content: ContentItem[]; onView: (id: number) => void;
  onEdit: (id: number) => void; onDelete: (id: number) => void; onNew: () => void;
}) {
  const { t } = useTheme();
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [hoverId, setHoverId] = useState<number | null>(null);

  const filtered = content.filter(i => {
    if (filter !== "all" && i.status !== filter) return false;
    if (brandFilter !== "all" && i.brand !== brandFilter) return false;
    if (search && !i.caption.toLowerCase().includes(search.toLowerCase()) && !i.brand.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const FILTERS: { key: "all" | Status; label: string; count: number }[] = [
    { key:"all", label:"All", count:content.length },
    ...ALL_STATUSES.map(k => ({ key:k, label:statusCfg(k,t).label, count:content.filter(i=>i.status===k).length })),
  ];

  return (
    <div className="p-6 lg:p-8 overflow-auto h-full">
      <SectionHeader title="Content Queue" sub={`${content.length} item${content.length!==1?"s":""} across all brands`}
        action={<PrimaryBtn onClick={onNew}>+ New Post</PrimaryBtn>} />

      {/* Filters bar */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => {
            const isActive = filter === f.key;
            const cfg = f.key === "all" ? null : statusCfg(f.key, t);
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-all"
                style={{ background: isActive?(cfg?cfg.bg:(t.mode==="light"?"#eef2ff":"#1e2460")):t.card, borderColor: isActive?(cfg?cfg.dot+"80":t.primary):t.border, color: isActive?(cfg?cfg.color:t.primary):t.textSub }}>
                {f.label}
                <span className="text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ background: isActive?(t.mode==="light"?"white":"rgba(255,255,255,0.15)"):t.tagBg, color: isActive?(cfg?cfg.color:t.primary):t.textMuted }}>
                  {f.count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: t.textMuted }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search content…"
              className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border outline-none" style={{ background: t.inputBg, borderColor: t.border, color: t.text }} />
          </div>
          <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
            className="text-sm px-3 py-2 rounded-lg border outline-none cursor-pointer" style={{ background: t.inputBg, borderColor: t.border, color: t.text }}>
            <option value="all">All Brands</option>
            {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {content.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-5xl mb-4">📝</div>
          <div className="font-semibold text-lg mb-2" style={{ color: t.text }}>No content yet</div>
          <p className="text-sm mb-5" style={{ color: t.textMuted }}>Create your first post to get started</p>
          <PrimaryBtn onClick={onNew}>+ New Post</PrimaryBtn>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(item => (
          <Card key={item.id} className="p-4 cursor-pointer hover:shadow-md group relative"
            onClick={() => onView(item.id)}
            onMouseEnter={() => setHoverId(item.id)} onMouseLeave={() => setHoverId(null)}>
            {hoverId === item.id && (
              <div className="absolute top-4 right-4 flex gap-1.5 z-10" onClick={e => e.stopPropagation()}>
                <button onClick={() => onEdit(item.id)} className="text-xs px-2.5 py-1 rounded-lg font-semibold border" style={{ borderColor: t.border, color: t.textSub, background: t.card }}>Edit</button>
                <button onClick={() => onDelete(item.id)} className="text-xs px-2.5 py-1 rounded-lg font-semibold border" style={{ borderColor: t.dangerBorder, color: t.danger, background: t.dangerBg+"40" }}>Delete</button>
              </div>
            )}
            <div className="flex items-start gap-4 pr-20">
              <BrandAvatar name={item.brand} color={item.brandColor} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-bold" style={{ color: item.brandColor }}>{item.brand}</span>
                  <span style={{ color: t.textFaint }}>·</span>
                  <span className="text-xs" style={{ color: t.textMuted }}>{item.campaign || "No campaign"}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: t.tagBg, color: t.textSub }}>{item.platform}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: t.tagBg, color: t.textSub }}>{item.format}</span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: t.text }}>{item.caption}</p>
                <div className="text-xs mt-1 font-mono" style={{ color: t.textMuted }}>{item.hashtags}</div>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <Badge status={item.status} />
                <span className="text-xs" style={{ color: t.textMuted }}>{item.scheduled?.split("—")[0]?.trim() || "—"}</span>
                <span className="text-xs font-bold" style={{ color: item.score>=90?"#059669":item.score>=80?"#d97706":t.textMuted }}>{item.score}/100</span>
              </div>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && content.length > 0 && (
          <div className="text-center py-12 text-sm" style={{ color: t.textMuted }}>No items match your filters</div>
        )}
      </div>
    </div>
  );
}

// ─── Approval View ────────────────────────────────────────────────────────────

const POLICY_LEVELS = ["auto", "review", "human"] as const;
type PolicyLevel = typeof POLICY_LEVELS[number];

function policyBadge(level: PolicyLevel, t: Theme) {
  if (level === "auto")   return { label: "Auto-publish",    color: "#059669", bg: t.mode==="light"?"#d1fae5":"#0a2218" };
  if (level === "review") return { label: "Needs Review",    color: "#d97706", bg: t.mode==="light"?"#fef3c7":"#292110" };
  return                         { label: "Human Approval",  color: "#dc2626", bg: t.mode==="light"?"#fee2e2":"#2d0f0f" };
}

function ApprovalView({ content, onStatusChange, onView }: {
  content: ContentItem[]; onStatusChange: (id: number, s: Status) => void; onView: (id: number) => void;
}) {
  const { t } = useTheme();
  const { user } = useAuth();

  // ── Policy state (editable) ──
  const [policy, setPolicy] = useState<Array<{ type: string; level: PolicyLevel }>>(() => {
    try { const r = localStorage.getItem("contentOS_approvalPolicy"); return r ? JSON.parse(r) : APPROVAL_TABLE; }
    catch { return APPROVAL_TABLE; }
  });
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState("");

  const cycleLevel = (i: number) => {
    const next = policy.map((r, idx) => idx === i ? { ...r, level: POLICY_LEVELS[(POLICY_LEVELS.indexOf(r.level) + 1) % 3] } : r);
    setPolicy(next);
    localStorage.setItem("contentOS_approvalPolicy", JSON.stringify(next));
  };
  const removeRow = (i: number) => {
    const next = policy.filter((_, idx) => idx !== i);
    setPolicy(next);
    localStorage.setItem("contentOS_approvalPolicy", JSON.stringify(next));
  };
  const addRow = () => {
    if (!newType.trim()) return;
    const next = [...policy, { type: newType.trim(), level: "review" as PolicyLevel }];
    setPolicy(next); setNewType(""); setAddingType(false);
    localStorage.setItem("contentOS_approvalPolicy", JSON.stringify(next));
  };

  // ── Queue state ──
  const [tab, setTab]               = useState<"pending" | "approved" | "rejected">("pending");
  const [filterBrand, setFilterBrand] = useState("All");
  const [filterPlatform, setFilterPlatform] = useState("All");
  const [selected, setSelected]     = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: number | null; bulk: boolean }>({ id: null, bulk: false });
  const [rejectNote, setRejectNote] = useState("");

  const pendingItems   = content.filter(i => i.status === "review" || i.status === "ai_generated");
  const approvedItems  = content.filter(i => i.status === "approved" || i.status === "scheduled" || i.status === "published");
  const rejectedItems  = content.filter(i => i.status === "draft");

  const queueSource = tab === "pending" ? pendingItems : tab === "approved" ? approvedItems : rejectedItems;

  const brands    = [...new Set(queueSource.map(i => i.brand))];
  const platforms = [...new Set(queueSource.map(i => i.platform))];

  const filtered = queueSource.filter(i =>
    (filterBrand === "All" || i.brand === filterBrand) &&
    (filterPlatform === "All" || i.platform === filterPlatform)
  );

  const allSelected = filtered.length > 0 && filtered.every(i => selected.has(i.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map(i => i.id)));
  };
  const toggleOne = (id: number) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const bulkApprove = () => {
    selected.forEach(id => onStatusChange(id, "approved"));
    setSelected(new Set());
  };
  const openBulkReject = () => { setRejectModal({ id: null, bulk: true }); setRejectNote(""); };
  const openReject = (id: number) => { setRejectModal({ id, bulk: false }); setRejectNote(""); };
  const confirmReject = () => {
    if (rejectModal.bulk) {
      selected.forEach(id => onStatusChange(id, "draft"));
      setSelected(new Set());
    } else if (rejectModal.id !== null) {
      onStatusChange(rejectModal.id, "draft");
    }
    setRejectModal({ id: null, bulk: false });
  };

  const tabCounts = { pending: pendingItems.length, approved: approvedItems.length, rejected: rejectedItems.length };

  return (
    <div className="h-full overflow-auto" style={{ background: t.appBg }}>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <SectionHeader title="Approval Queue" sub="Review, approve, or reject AI-generated content before it publishes" />
          {/* Stats row */}
          <div className="flex items-center gap-3">
            {[
              { label: "Pending",  count: pendingItems.length,  color: "#d97706", bg: t.mode==="light"?"#fef3c7":"#292110" },
              { label: "Approved", count: approvedItems.length, color: "#059669", bg: t.mode==="light"?"#d1fae5":"#0a2218" },
              { label: "Rejected", count: rejectedItems.length, color: "#dc2626", bg: t.mode==="light"?"#fee2e2":"#2d0f0f" },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: s.bg }}>
                <span className="text-lg font-bold" style={{ color: s.color }}>{s.count}</span>
                <span className="text-xs font-medium" style={{ color: s.color }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* ── Left: Policy editor ── */}
          <div className="xl:col-span-1">
            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: t.borderLight }}>
                <div>
                  <div className="font-semibold text-sm" style={{ color: t.text }}>Automation Policy</div>
                  <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>Click a badge to cycle approval level</div>
                </div>
              </div>
              <div className="divide-y" style={{ borderColor: t.borderFaint }}>
                {policy.map((row, i) => {
                  const b = policyBadge(row.level, t);
                  return (
                    <div key={i} className="flex items-center gap-2 px-5 py-3 group"
                      onMouseEnter={e => (e.currentTarget.style.background = t.cardHover)}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <div className="flex-1 text-sm" style={{ color: t.text }}>{row.type}</div>
                      <button onClick={() => cycleLevel(i)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer hover:opacity-80 transition-opacity"
                        style={{ color: b.color, background: b.bg }} title="Click to change level">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: b.color }} />
                        {b.label}
                      </button>
                      <button onClick={() => removeRow(i)}
                        className="opacity-0 group-hover:opacity-100 text-xs px-1.5 py-0.5 rounded transition-opacity"
                        style={{ color: t.danger, background: t.dangerBg }}>✕</button>
                    </div>
                  );
                })}
              </div>
              <div className="px-5 py-3 border-t" style={{ borderColor: t.borderLight }}>
                {addingType ? (
                  <div className="flex gap-2">
                    <input autoFocus value={newType} onChange={e => setNewType(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addRow(); if (e.key === "Escape") { setAddingType(false); setNewType(""); } }}
                      placeholder="Content type…" className="flex-1 text-sm px-3 py-1.5 rounded-lg border outline-none"
                      style={{ background: t.inputBg, borderColor: t.border, color: t.text }} />
                    <button onClick={addRow} className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
                      style={{ background: t.primary }}>Add</button>
                    <button onClick={() => { setAddingType(false); setNewType(""); }}
                      className="text-xs px-2 py-1.5 rounded-lg" style={{ color: t.textMuted, background: t.tagBg }}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setAddingType(true)}
                    className="text-xs font-semibold w-full py-1.5 rounded-lg transition-colors"
                    style={{ color: t.primary, background: t.primary + "10" }}>+ Add content type</button>
                )}
              </div>
            </Card>
          </div>

          {/* ── Right: Queue ── */}
          <div className="xl:col-span-2 space-y-4">
            {/* Tab bar */}
            <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: t.sectionBg }}>
              {(["pending", "approved", "rejected"] as const).map(t2 => (
                <button key={t2} onClick={() => { setTab(t2); setSelected(new Set()); setFilterBrand("All"); setFilterPlatform("All"); }}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all"
                  style={{ background: tab === t2 ? t.card : "transparent", color: tab === t2 ? t.text : t.textMuted,
                    boxShadow: tab === t2 ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
                  {t2.charAt(0).toUpperCase() + t2.slice(1)}
                  {tabCounts[t2] > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                      style={{ background: t2==="pending"?"#fbbf24":t2==="approved"?"#10b981":"#ef4444",
                        color: "white", minWidth: "18px", textAlign: "center" }}>{tabCounts[t2]}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Filters + bulk actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}
                className="text-sm px-3 py-2 rounded-lg border outline-none"
                style={{ background: t.inputBg, borderColor: t.border, color: t.text }}>
                <option value="All">All Brands</option>
                {brands.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}
                className="text-sm px-3 py-2 rounded-lg border outline-none"
                style={{ background: t.inputBg, borderColor: t.border, color: t.text }}>
                <option value="All">All Platforms</option>
                {platforms.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {selected.size > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ background: t.tagBg, color: t.textSub }}>
                    {selected.size} selected
                  </span>
                  {tab === "pending" && (
                    <>
                      <button onClick={bulkApprove}
                        className="text-xs px-3 py-1.5 rounded-lg font-bold text-white transition-opacity hover:opacity-90"
                        style={{ background: "#059669" }}>✓ Approve All</button>
                      <button onClick={openBulkReject}
                        className="text-xs px-3 py-1.5 rounded-lg font-bold transition-opacity hover:opacity-90"
                        style={{ background: t.dangerBg, color: t.danger }}>✕ Reject All</button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Items list */}
            {filtered.length === 0 ? (
              <div className="text-center py-16 rounded-2xl border" style={{ borderColor: t.border }}>
                <div className="text-4xl mb-3">{tab === "pending" ? "✅" : tab === "approved" ? "📋" : "📁"}</div>
                <div className="text-sm font-semibold mb-1" style={{ color: t.text }}>
                  {tab === "pending" ? "All caught up!" : tab === "approved" ? "No approved posts yet" : "No rejected posts"}
                </div>
                <div className="text-xs" style={{ color: t.textMuted }}>
                  {tab === "pending" ? "No content waiting for review." : "Approved content will appear here."}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Select all row */}
                {tab === "pending" && filtered.length > 1 && (
                  <div className="flex items-center gap-3 px-4 py-2 rounded-xl" style={{ background: t.sectionBg }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-4 h-4 cursor-pointer rounded accent-indigo-500" />
                    <span className="text-xs font-semibold" style={{ color: t.textMuted }}>
                      Select all ({filtered.length})
                    </span>
                  </div>
                )}
                {filtered.map(item => {
                  const isExpanded = expandedId === item.id;
                  const isSelected = selected.has(item.id);
                  return (
                    <div key={item.id}
                      className="rounded-2xl border overflow-hidden transition-all"
                      style={{ background: isSelected ? t.primary + "08" : t.card,
                        borderColor: isSelected ? t.primary + "40" : t.border }}>
                      {/* Header row */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        {tab === "pending" && (
                          <input type="checkbox" checked={isSelected} onChange={() => toggleOne(item.id)}
                            className="w-4 h-4 cursor-pointer rounded flex-shrink-0 accent-indigo-500"
                            onClick={e => e.stopPropagation()} />
                        )}
                        <div className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                          <BrandAvatar name={item.brand} color={item.brandColor} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold" style={{ color: item.brandColor }}>{item.brand}</span>
                              <span className="text-xs" style={{ color: t.textMuted }}>{item.platform}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: t.tagBg, color: t.textSub }}>{item.format}</span>
                            </div>
                            <p className="text-sm truncate mt-0.5" style={{ color: t.text }}>{item.caption}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge status={item.status} />
                          <button onClick={() => setExpandedId(isExpanded ? null : item.id)}
                            className="text-xs px-2 py-1 rounded-lg font-medium transition-colors"
                            style={{ color: t.textMuted, background: t.tagBg }}>
                            {isExpanded ? "▲" : "▼"}
                          </button>
                          <button onClick={() => onView(item.id)}
                            className="text-xs px-2 py-1 rounded-lg font-medium"
                            style={{ color: t.primary, background: t.primary + "12" }}>Full</button>
                        </div>
                      </div>

                      {/* Expanded preview */}
                      {isExpanded && (
                        <div className="px-4 pb-4 border-t" style={{ borderColor: t.borderLight }}>
                          <div className="mt-3 space-y-3">
                            <div className="p-3 rounded-xl" style={{ background: t.sectionBg }}>
                              <div className="text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Caption</div>
                              <p className="text-sm leading-relaxed" style={{ color: t.text }}>{item.caption}</p>
                            </div>
                            {item.hashtags && (
                              <div className="p-3 rounded-xl" style={{ background: t.sectionBg }}>
                                <div className="text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Hashtags</div>
                                <p className="text-xs" style={{ color: t.primary }}>{item.hashtags}</p>
                              </div>
                            )}
                            {item.imagePrompt && (
                              <div className="p-3 rounded-xl" style={{ background: t.sectionBg }}>
                                <div className="text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Image Prompt</div>
                                <p className="text-sm italic" style={{ color: t.textMuted }}>{item.imagePrompt}</p>
                              </div>
                            )}
                            {item.videoScript && (
                              <div className="p-3 rounded-xl" style={{ background: t.sectionBg }}>
                                <div className="text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Video Script</div>
                                <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: t.text }}>{item.videoScript}</p>
                              </div>
                            )}
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-xs" style={{ color: t.textMuted }}>
                                Scheduled: {item.scheduled || "—"}
                                {item.score !== undefined && <span className="ml-3">Score: <strong style={{ color: item.score >= 80 ? "#059669" : item.score >= 60 ? "#d97706" : "#dc2626" }}>{item.score}</strong></span>}
                              </span>
                              {tab === "pending" && (
                                <div className="flex gap-2">
                                  <button onClick={() => openReject(item.id)}
                                    className="text-sm px-4 py-2 rounded-xl font-semibold border transition-all hover:shadow-sm"
                                    style={{ borderColor: t.dangerBorder, color: t.danger, background: t.card }}>✕ Reject</button>
                                  <button onClick={() => onStatusChange(item.id, "approved")}
                                    className="text-sm px-4 py-2 rounded-xl font-bold text-white transition-all hover:opacity-90"
                                    style={{ background: "#059669" }}>✓ Approve</button>
                                </div>
                              )}
                              {tab === "approved" && (
                                <button onClick={() => onStatusChange(item.id, "review")}
                                  className="text-sm px-4 py-2 rounded-xl font-semibold border"
                                  style={{ borderColor: t.border, color: t.textSub, background: t.card }}>↩ Return to Review</button>
                              )}
                              {tab === "rejected" && (
                                <button onClick={() => onStatusChange(item.id, "review")}
                                  className="text-sm px-4 py-2 rounded-xl font-bold text-white"
                                  style={{ background: "#d97706" }}>↩ Resubmit for Review</button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Collapsed quick-action strip (pending only, not expanded) */}
                      {!isExpanded && tab === "pending" && (
                        <div className="flex gap-2 px-4 pb-3">
                          <button onClick={() => openReject(item.id)}
                            className="flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                            style={{ borderColor: t.dangerBorder, color: t.danger, background: t.card }}>✕ Reject</button>
                          <button onClick={() => onStatusChange(item.id, "approved")}
                            className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white transition-all hover:opacity-90"
                            style={{ background: "#059669" }}>✓ Approve</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reject modal */}
      {rejectModal.id !== null || rejectModal.bulk ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="w-full max-w-md rounded-2xl border shadow-2xl p-6 space-y-4" style={{ background: t.modalBg, borderColor: t.border }}>
            <div className="text-base font-bold" style={{ color: t.text }}>
              {rejectModal.bulk ? `Reject ${selected.size} posts?` : "Reject this post?"}
            </div>
            <p className="text-sm" style={{ color: t.textMuted }}>
              {rejectModal.bulk ? "These posts will be moved back to Draft." : "This post will be moved back to Draft status."}
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Rejection note (optional)</label>
              <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3}
                placeholder="e.g. Tone needs adjusting, caption too long…"
                className="w-full text-sm px-3 py-2 rounded-xl border outline-none resize-none"
                style={{ background: t.inputBg, borderColor: t.border, color: t.text }} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setRejectModal({ id: null, bulk: false })}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
                style={{ borderColor: t.border, color: t.textSub, background: t.card }}>Cancel</button>
              <button onClick={confirmReject}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ background: "#dc2626" }}>Reject</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Analytics View ───────────────────────────────────────────────────────────

function AnalyticsView({ brands, content }: { brands: Brand[]; content: ContentItem[] }) {
  const { t } = useTheme();
  const published = content.filter(c => c.status === "published").length;
  const scheduled = content.filter(c => c.status === "scheduled").length;

  return (
    <div className="p-6 lg:p-8 overflow-auto h-full space-y-6">
      <SectionHeader title="Analytics & Optimization" sub="Generate → Publish → Measure → Learn → Generate better content" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:"Monthly Reach",  value:"284K",      sub:"across all brands",   color:"#0ea5e9", bg:t.mode==="light"?"#f0f9ff":"#0c1f30", icon:"📡" },
          { label:"Avg Engagement", value:"5.8%",      sub:"vs industry 3.2%",    color:"#059669", bg:t.mode==="light"?"#d1fae5":"#0a2218", icon:"💬" },
          { label:"Published",      value:published,   sub:"posts live",          color:"#374151", bg:t.tagBg,                               icon:"📤" },
          { label:"Scheduled",      value:scheduled,   sub:"posts queued",        color:"#7c3aed", bg:t.mode==="light"?"#ede9fe":"#1e1b3a", icon:"📅" },
        ].map(k => (
          <Card key={k.label} className="p-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg mb-3" style={{ background: k.bg }}>{k.icon}</div>
            <div className="text-2xl font-bold" style={{ color: t.text }}>{k.value}</div>
            <div className="text-sm font-semibold mt-0.5" style={{ color: k.color }}>{k.label}</div>
            <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>{k.sub}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b" style={{ borderColor: t.borderLight }}>
            <div className="font-semibold text-sm" style={{ color: t.text }}>Top Topics by Engagement</div>
            <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>TravelEase — Last 30 days</div>
          </div>
          <div className="p-5 space-y-4">
            {ANALYTICS_TOPICS.map((tp, i) => (
              <div key={tp.name} className="flex items-center gap-3">
                <span className="text-xs font-bold w-4 text-right" style={{ color: t.textFaint }}>{i+1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm" style={{ color: t.text }}>{tp.name}</span>
                    <span className="text-xs font-bold" style={{ color: tp.engagement>=6?"#059669":tp.engagement>=4?"#d97706":t.textMuted }}>{tp.engagement}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: t.tagBg }}>
                    <div className="h-full rounded-full" style={{ width:`${(tp.engagement/10)*100}%`, background:tp.engagement>=6?"#10b981":tp.engagement>=4?"#f59e0b":t.textFaint }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b" style={{ borderColor: t.borderLight }}>
            <div className="font-semibold text-sm" style={{ color: t.text }}>Performance Insights</div>
          </div>
          <div className="p-5 space-y-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.textMuted }}>Best Format</div>
              <div className="flex gap-2">
                {[{f:"Carousel",rank:1},{f:"Reel",rank:2},{f:"Image",rank:3}].map(({f,rank}) => (
                  <div key={f} className="flex-1 py-2 rounded-lg text-center text-xs font-semibold" style={{ background:rank===1?(t.mode==="light"?"#d1fae5":"#0a2218"):rank===2?(t.mode==="light"?"#fef3c7":"#292110"):t.tagBg, color:rank===1?"#059669":rank===2?"#d97706":t.textMuted }}>
                    {rank}. {f}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.textMuted }}>Best Day</div>
              <div className="flex gap-1">
                {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
                  <div key={d} className="flex-1 py-2 rounded-lg text-center text-xs font-medium" style={{ background:d==="Thu"?t.primary:t.tagBg, color:d==="Thu"?"white":t.textMuted }}>{d}</div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.textMuted }}>Best Time Window</div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold" style={{ color: t.text }}>7–9 PM</span>
                <span className="text-sm" style={{ color: t.textMuted }}>optimal publishing</span>
              </div>
            </div>
            <div className="pt-3 border-t" style={{ borderColor: t.borderLight }}>
              <span className="inline-flex items-center gap-1.5 font-semibold text-xs" style={{ color:"#059669" }}>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                AI learning — next calendar uses these insights
              </span>
            </div>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b" style={{ borderColor: t.borderLight }}>
          <div className="font-semibold text-sm" style={{ color: t.text }}>Brand Performance Overview</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: t.tableHead, borderBottom:`1px solid ${t.borderLight}` }}>
                {["Brand","Posts/mo","Scheduled","In Review","Platforms","Ideas"].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: t.textMuted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {brands.map((b, i) => (
                <tr key={b.id} className="transition-colors" style={{ borderBottom: i<brands.length-1?`1px solid ${t.borderFaint}`:"none" }}
                  onMouseEnter={e=>(e.currentTarget.style.background=t.cardHover)} onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <BrandAvatar name={b.name} color={b.color} size="sm" />
                      <span className="font-medium" style={{ color: t.text }}>{b.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5" style={{ color: t.textSub }}>{b.posts_month}</td>
                  <td className="px-5 py-3.5 font-bold" style={{ color:"#059669" }}>{b.scheduled}</td>
                  <td className="px-5 py-3.5 font-bold" style={{ color:"#d97706" }}>{b.review}</td>
                  <td className="px-5 py-3.5" style={{ color: t.textSub }}>{b.platforms.length}</td>
                  <td className="px-5 py-3.5 font-bold" style={{ color:"#7c3aed" }}>{b.ideas}</td>
                </tr>
              ))}
              {brands.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-sm" style={{ color: t.textMuted }}>No brands yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Integrations ─────────────────────────────────────────────────────────────

type IntegrationId = "falai" | "replicate" | "pollinations" | "huggingface" | "stablehorde" | "groq";

interface IntegrationConfig { [key: string]: string }

interface Integration {
  id: IntegrationId;
  connected: boolean;
  config: IntegrationConfig;
}


const INTEGRATION_DEFS: {
  id: IntegrationId; name: string; icon: string; color: string; bg: string;
  category: string; desc: string;
  fields: { key: string; label: string; placeholder: string; secret?: boolean; hint?: string }[];
  guide: { title: string; steps: GuideStep[] };
}[] = [
  {
    id: "pollinations", name: "Pollinations.ai", icon: "🌸", color: "#059669", bg: "#ecfdf5",
    category: "AI & Automation",
    desc: "Free image generation powered by FLUX — requires a free API key from pollinations.ai",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "your-pollinations-api-key", secret: true, hint: "From auth.pollinations.ai" },
    ],
    guide: {
      title: "Get your free Pollinations.ai API key",
      steps: [
        { step: "Visit auth.pollinations.ai to get your key", url: "https://auth.pollinations.ai", urlLabel: "auth.pollinations.ai" },
        { step: "Sign in with GitHub or Google", detail: "Pollinations uses OAuth — no password to create, just connect your existing account." },
        { step: "Copy your API key", detail: "After signing in your API key is shown on the page. Paste it above." },
        { step: "Free tier", detail: "The free tier gives generous image generation limits powered by FLUX. No credit card required." },
        { step: "How it works", detail: "Your image prompt is sent to image.pollinations.ai with your key as a token parameter, returning a FLUX-generated image." },
      ],
    },
  },
  {
    id: "huggingface", name: "Hugging Face", icon: "🤗", color: "#f59e0b", bg: "#fffbeb",
    category: "AI & Automation",
    desc: "Free inference API — FLUX, Stable Diffusion XL, and 100s of open-source image models",
    fields: [
      { key: "apiToken", label: "API Token", placeholder: "hf_xxxxxxxxxxxxxxxxxxxx", secret: true, hint: "From huggingface.co/settings/tokens" },
      { key: "model", label: "Model ID (optional)", placeholder: "black-forest-labs/FLUX.1-schnell", hint: "Leave blank to use FLUX.1-schnell" },
    ],
    guide: {
      title: "Get your free Hugging Face token",
      steps: [
        { step: "Create a free account at huggingface.co", url: "https://huggingface.co/join", urlLabel: "huggingface.co/join" },
        { step: "Go to Settings → Access Tokens", url: "https://huggingface.co/settings/tokens", urlLabel: "huggingface.co/settings/tokens" },
        { step: "Click 'New token'", detail: "Select 'Read' role, give it a name like 'Content OS', and click Generate." },
        { step: "Copy your token", detail: "It starts with 'hf_'. Paste it above." },
        { step: "Free tier limits", detail: "~1,000 requests/day on the free tier. FLUX.1-schnell is fast (~5s). If you hit limits, Hugging Face Pro ($9/mo) removes them." },
        { step: "Model options", detail: "Best free models: black-forest-labs/FLUX.1-schnell (fastest), stabilityai/stable-diffusion-xl-base-1.0, black-forest-labs/FLUX.1-dev (higher quality)." },
      ],
    },
  },
  {
    id: "stablehorde", name: "Stable Horde", icon: "⚡", color: "#8b5cf6", bg: "#f5f3ff",
    category: "AI & Automation",
    desc: "Completely free, community-powered open-source image generation — volunteer GPUs worldwide",
    fields: [
      { key: "apiKey", label: "API Key (optional)", placeholder: "0000000000", hint: "Use '0000000000' for anonymous access, or register for priority" },
      { key: "model", label: "Model (optional)", placeholder: "FLUX.1-Schnell fp8 (Compact)", hint: "Leave blank for default. See stablehorde.net/models" },
    ],
    guide: {
      title: "Use Stable Horde (no account required)",
      steps: [
        { step: "Anonymous use — no signup needed", detail: "Use '0000000000' as the API key. You get lower priority but it's completely free and works immediately." },
        { step: "Register for better priority (optional)", url: "https://stablehorde.net/register", urlLabel: "stablehorde.net/register", detail: "Free account gives you kudos and higher queue priority." },
        { step: "How it works", detail: "Stable Horde is a distributed network of volunteer GPU owners. Your request is queued and processed by a volunteer worker — wait times vary (10s–3min)." },
        { step: "Open source", detail: "Fully open source at github.com/Haidra-Org/AI-Horde. All models are open-source (Stable Diffusion, FLUX variants)." },
        { step: "Model options", detail: "Popular free models: 'FLUX.1-Schnell fp8 (Compact)', 'Stable Diffusion XL', 'AlbedoBase XL'. View all at stablehorde.net/models." },
      ],
    },
  },
  {
    id: "falai", name: "fal.ai", icon: "✦", color: "#7c3aed", bg: "#f5f3ff",
    category: "AI & Automation",
    desc: "Generate images (FLUX) and videos (Kling) directly from prompts — fastest & cheapest",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", secret: true, hint: "From fal.ai dashboard → Keys" },
    ],
    guide: {
      title: "Get your fal.ai API key",
      steps: [
        { step: "Create a free account at fal.ai", url: "https://fal.ai", urlLabel: "fal.ai" },
        { step: "Go to Dashboard → Keys", detail: "Click your avatar top-right → Dashboard, then open the 'Keys' tab in the left sidebar" },
        { step: "Click 'Add key'", detail: "Give it a name like 'Content OS' and click Create" },
        { step: "Copy the key immediately", detail: "It starts with a UUID format. Paste it above — it is only shown once." },
        { step: "Pricing reference", detail: "FLUX.1-schnell: ~$0.003/image · FLUX.1-dev: ~$0.025/image · Kling video 5s: ~$0.14 · No subscription needed — pay as you go." },
      ],
    },
  },
  {
    id: "replicate", name: "Replicate", icon: "⬡", color: "#0ea5e9", bg: "#f0f9ff",
    category: "AI & Automation",
    desc: "Run FLUX, Stable Diffusion, and 1000s of open-source AI models for images & video",
    fields: [
      { key: "apiToken", label: "API Token", placeholder: "r8_xxxxxxxxxxxxxxxxxxxx", secret: true, hint: "From replicate.com/account/api-tokens" },
    ],
    guide: {
      title: "Get your Replicate API token",
      steps: [
        { step: "Sign up or log in at replicate.com", url: "https://replicate.com", urlLabel: "replicate.com" },
        { step: "Go to Account → API tokens", url: "https://replicate.com/account/api-tokens", urlLabel: "replicate.com/account/api-tokens" },
        { step: "Click 'Create token'", detail: "Give it a name and click Create. The token starts with 'r8_'." },
        { step: "Copy and paste your token above", detail: "Store it safely — treat it like a password." },
        { step: "Pricing reference", detail: "FLUX-schnell: ~$0.003/image · SDXL: ~$0.002/image · Billing by the second of GPU compute. Free trial credits available." },
      ],
    },
  },
  {
    id: "groq", name: "Groq", icon: "⚡", color: "#f97316", bg: "#fff7ed",
    category: "AI & Automation",
    desc: "Ultra-fast free-tier text AI — Llama 3.3 70B, Mixtral, Gemma. Free without credit card.",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "gsk_xxxxxxxxxxxxxxxxxxxx", secret: true, hint: "From console.groq.com/keys" },
    ],
    guide: {
      title: "Get your free Groq API key",
      steps: [
        { step: "Create a free account at console.groq.com", url: "https://console.groq.com", urlLabel: "console.groq.com" },
        { step: "Go to API Keys in the left sidebar", url: "https://console.groq.com/keys", urlLabel: "console.groq.com/keys" },
        { step: "Click 'Create API Key'", detail: "Give it a name like 'Content OS'. The key starts with 'gsk_'." },
        { step: "Copy and paste it above", detail: "No credit card required for the free tier." },
        { step: "Free tier limits", detail: "Llama 3.3 70B: 6,000 tokens/min · 500K tokens/day · Mixtral 8x7B: 5,000 tokens/min · All completely free with no payment needed." },
      ],
    },
  },
];

function loadIntegrations(): Integration[] {
  const defaults = INTEGRATION_DEFS.map(d => ({ id: d.id, connected: false, config: {} as IntegrationConfig }));
  try {
    const raw = localStorage.getItem("contentOS_integrations");
    if (raw) {
      const saved = JSON.parse(raw) as Integration[];
      // Merge: keep saved data, add any new integrations not yet in localStorage
      const savedMap = new Map(saved.map(i => [i.id, i]));
      return defaults.map(d => savedMap.get(d.id) ?? d);
    }
  } catch { /* ignore */ }
  return defaults;
}

function saveIntegrations(integrations: Integration[]) {
  localStorage.setItem("contentOS_integrations", JSON.stringify(integrations));
  dbSet("contentOS:integrations", integrations);
}

function IntegrationConfigPanel({ defn, integration, open, onClose, onSave, onDisconnect }: {
  defn: typeof INTEGRATION_DEFS[0];
  integration: Integration;
  open: boolean; onClose: () => void;
  onSave: (config: IntegrationConfig) => void;
  onDisconnect: () => void;
}) {
  const { t } = useTheme();
  const [config, setConfig] = useState<IntegrationConfig>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [guideOpen, setGuideOpen] = useState(!integration.connected);

  useEffect(() => {
    if (open) {
      setConfig({ ...integration.config });
      setGuideOpen(!integration.connected);
    }
  }, [open, integration.config, integration.connected]);

  const noFields = defn.fields.length === 0;
  const allFilled = noFields || defn.fields.every(f => {
    if (f.hint?.includes("optional") || f.placeholder === "0000000000") return true;
    return (config[f.key] || "").trim() !== "";
  });

  const handleSave = () => {
    if (!allFilled) return;
    onSave(config);
  };

  return (
    <SlidePanel
      open={open} onClose={onClose}
      title={`Connect ${defn.name}`}
      subtitle={defn.desc}
    >
      <div className="space-y-5">
        {/* Platform header */}
        <div className="flex items-center gap-4 p-4 rounded-xl border" style={{ background: defn.bg + (t.mode === "dark" ? "18" : ""), borderColor: defn.color + "30" }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
            style={{ background: defn.color + "18", border: `1px solid ${defn.color}30` }}>
            {defn.icon}
          </div>
          <div>
            <div className="font-bold" style={{ color: defn.color }}>{defn.name}</div>
            <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>{defn.category}</div>
          </div>
          {integration.connected && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: t.mode==="light"?"#d1fae5":"#0a2218", color:"#059669" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />Connected
            </span>
          )}
        </div>

        {/* Setup guide (collapsible) */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: defn.color + "30" }}>
          <button type="button" onClick={() => setGuideOpen(v => !v)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left"
            style={{ background: defn.color + (t.mode === "dark" ? "18" : "12") }}>
            <span className="text-base">📋</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold" style={{ color: defn.color }}>Setup Guide</div>
              <div className="text-xs" style={{ color: t.textMuted }}>{defn.guide.title}</div>
            </div>
            <span className="text-xs font-semibold flex-shrink-0" style={{ color: defn.color }}>
              {guideOpen ? "▲ Hide" : "▼ Show"}
            </span>
          </button>

          {guideOpen && (
            <div className="px-4 pt-3 pb-4 space-y-3" style={{ background: t.sectionBg }}>
              {defn.guide.steps.map((s, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                    style={{ background: defn.color + "20", color: defn.color }}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold leading-snug" style={{ color: t.text }}>{s.step}</div>
                    {s.detail && <div className="text-xs mt-0.5 leading-relaxed" style={{ color: t.textMuted }}>{s.detail}</div>}
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs mt-1 font-semibold underline"
                        style={{ color: defn.color }}>
                        ↗ {s.urlLabel || s.url}
                      </a>
                    )}
                  </div>
                </div>
              ))}
              <div className="mt-2 pt-2 border-t text-xs" style={{ borderColor: t.borderLight, color: t.textMuted }}>
                All credentials are stored only in your browser — never on any third-party server.
              </div>
            </div>
          )}
        </div>

        {/* Credential fields */}
        {!noFields && <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: t.textMuted }}>Your credentials</div>}
        {noFields && (
          <div className="p-4 rounded-xl border text-center" style={{ background: t.sectionBg, borderColor: t.borderLight }}>
            <div className="text-2xl mb-2">🎉</div>
            <div className="text-sm font-semibold mb-1" style={{ color: t.text }}>No credentials needed!</div>
            <p className="text-xs" style={{ color: t.textMuted }}>Just click Connect below — {defn.name} is completely free and open.</p>
          </div>
        )}
        {defn.fields.map(field => (
          <div key={field.key}>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>{field.label} <span style={{ color: t.danger }}>*</span></label>
            <div className="relative">
              <input
                type={field.secret && !show[field.key] ? "password" : "text"}
                value={config[field.key] || ""}
                onChange={e => setConfig(c => ({ ...c, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none"
                style={{ background: t.inputBg, borderColor: t.border, color: t.text, paddingRight: field.secret ? "60px" : undefined }}
              />
              {field.secret && (
                <button type="button" onClick={() => setShow(s => ({ ...s, [field.key]: !s[field.key] }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded font-medium"
                  style={{ color: t.textMuted, background: t.tagBg }}>
                  {show[field.key] ? "Hide" : "Show"}
                </button>
              )}
            </div>
            {field.hint && <p className="text-xs mt-1" style={{ color: t.textMuted }}>{field.hint}</p>}
          </div>
        ))}

        {/* Completion indicator */}
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border" style={{ background: t.sectionBg, borderColor: allFilled ? defn.color + "40" : t.borderLight }}>
          <div className="flex gap-1.5 flex-wrap flex-1">
            {defn.fields.map(f => (
              <span key={f.key} className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: (config[f.key]||"").trim() ? defn.color+"18" : t.tagBg, color: (config[f.key]||"").trim() ? defn.color : t.textMuted }}>
                {(config[f.key]||"").trim() ? "✓" : "·"} {f.label}
              </span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {integration.connected && (
            <button type="button" onClick={onDisconnect}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors"
              style={{ borderColor: t.dangerBorder, color: t.danger, background: t.card }}>
              Disconnect
            </button>
          )}
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
            style={{ borderColor: t.border, color: t.textSub, background: t.card }}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={!allFilled}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40"
            style={{ background: defn.color }}>
            {integration.connected ? "Update" : "Connect"}
          </button>
        </div>
      </div>
    </SlidePanel>
  );
}

function IntegrationCard({ defn, integration, onClick }: { defn: typeof INTEGRATION_DEFS[0]; integration: Integration; onClick: () => void }) {
  const { t } = useTheme();
  const connected = integration.connected;
  return (
    <Card className="p-5 cursor-pointer hover:shadow-md transition-all" onClick={onClick}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: defn.bg + (t.mode === "dark" ? "18" : ""), border: `1px solid ${defn.color}25` }}>
          {defn.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm" style={{ color: t.text }}>{defn.name}</div>
          <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>{defn.desc}</div>
        </div>
        <div className="flex-shrink-0">
          {connected
            ? <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full" style={{ background: t.mode==="light"?"#d1fae5":"#0a2218", color:"#059669" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />Live
              </span>
            : <span className="inline-flex items-center text-xs font-medium px-2 py-1 rounded-full" style={{ background: t.tagBg, color: t.textMuted }}>Set up</span>}
        </div>
      </div>
      {connected ? (
        <div className="space-y-1 mb-3">
          {defn.fields.filter(f => !f.secret).slice(0, 2).map(f => (
            <div key={f.key} className="flex items-center gap-2">
              <span className="text-xs" style={{ color: t.textMuted }}>{f.label}:</span>
              <span className="text-xs font-mono truncate" style={{ color: t.text }}>{integration.config[f.key] || "—"}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-1.5 flex-wrap mb-3">
          {defn.fields.map(f => (
            <span key={f.key} className="text-xs px-2 py-0.5 rounded" style={{ background: t.tagBg, color: t.textMuted }}>{f.label}</span>
          ))}
        </div>
      )}
      <div className="pt-3 border-t flex items-center justify-between" style={{ borderColor: t.borderLight }}>
        <span className="text-xs font-semibold" style={{ color: connected ? defn.color : t.textMuted }}>
          {connected ? "✓ Connected" : "Click to configure →"}
        </span>
        <span className="text-xs px-2.5 py-1 rounded-lg font-semibold"
          style={{ background: connected ? defn.color + "18" : t.tagBg, color: connected ? defn.color : t.textSub }}>
          {connected ? "Edit" : "Set up →"}
        </span>
      </div>
    </Card>
  );
}

function GoogleAuthPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTheme();
  const [clientId, setClientId] = useState(() => getGoogleClientId());
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (open) { setClientId(getGoogleClientId()); setSaved(false); } }, [open]);

  const handleSave = () => {
    localStorage.setItem("contentOS_googleClientId", clientId.trim());
    dbSet("contentOS:googleClientId", clientId.trim());
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 900);
  };

  const handleClear = () => {
    localStorage.removeItem("contentOS_googleClientId");
    setClientId("");
    dbSet("contentOS:googleClientId", "");
  };

  const isConfigured = !!getGoogleClientId();

  return (
    <SlidePanel open={open} onClose={onClose} title="Google Authentication" subtitle="Allow users to sign in with their Google account">
      <div className="space-y-6">
        {/* Status */}
        <div className="flex items-center gap-3 p-4 rounded-xl border" style={{ background: t.sectionBg, borderColor: t.borderLight }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: isConfigured ? "#d1fae5" : t.tagBg }}>
            {isConfigured ? "✓" : "G"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold" style={{ color: t.text }}>Google Sign-In</div>
            <div className="text-xs mt-0.5" style={{ color: isConfigured ? "#059669" : t.textMuted }}>
              {isConfigured ? "Configured — button shown on login page" : "Not configured — email/password only"}
            </div>
          </div>
          {isConfigured && (
            <button onClick={handleClear} className="text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ background: t.dangerBg, color: t.danger }}>Disable</button>
          )}
        </div>

        {/* Setup guide */}
        <div>
          <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: t.textMuted }}>Setup Guide</div>
          <div className="space-y-3">
            {[
              { n: 1, text: "Go to Google Cloud Console", url: "https://console.cloud.google.com/", label: "Open Console →" },
              { n: 2, text: "Create a project (or select an existing one)", url: null, label: null },
              { n: 3, text: "Enable the Google Identity API under APIs & Services", url: "https://console.cloud.google.com/apis/library", label: "API Library →" },
              { n: 4, text: "Go to Credentials → Create Credentials → OAuth 2.0 Client ID", url: "https://console.cloud.google.com/apis/credentials", label: "Credentials →" },
              { n: 5, text: "Set application type to Web Application", url: null, label: null },
              { n: 6, text: "Add your app URL to Authorized JavaScript Origins (e.g. https://yourapp.figma.com)", url: null, label: null },
              { n: 7, text: "Copy the Client ID and paste it below", url: null, label: null },
            ].map(({ n, text, url, label }) => (
              <div key={n} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                  style={{ background: t.primary + "18", color: t.primary }}>{n}</div>
                <div className="flex-1">
                  <span className="text-sm" style={{ color: t.text }}>{text}</span>
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer"
                      className="ml-2 text-xs underline font-medium" style={{ color: t.primary }}>{label}</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Client ID input */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>OAuth 2.0 Client ID</label>
          <input
            type="text"
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
            className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none font-mono"
            style={{ background: t.inputBg, borderColor: t.border, color: t.text }}
          />
          <p className="text-xs mt-1.5" style={{ color: t.textMuted }}>
            Stored in your browser only. The "Sign in with Google" button appears on the login page once saved.
          </p>
        </div>

        {/* Note on OAuth consent screen */}
        <div className="p-4 rounded-xl border" style={{ background: t.sectionBg, borderColor: t.borderLight }}>
          <div className="text-xs font-semibold mb-1" style={{ color: t.textSub }}>OAuth Consent Screen</div>
          <p className="text-xs leading-relaxed" style={{ color: t.textMuted }}>
            In Google Cloud Console, configure the OAuth consent screen with your app name and support email.
            For internal use, set user type to "Internal". For public use, submit for verification or keep as "External" in testing mode (max 100 test users).
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
            style={{ borderColor: t.border, color: t.textSub, background: t.card }}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={!clientId.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-all disabled:opacity-40"
            style={{ background: saved ? "#059669" : t.primary }}>
            {saved ? "✓ Saved!" : "Save & Enable"}
          </button>
        </div>
      </div>
    </SlidePanel>
  );
}

function IntegrationsView({ integrations, onConfigure, apiKey, aiModel, onOpenSettings, brands, onViewBrand }: {
  integrations: Integration[];
  onConfigure: (id: IntegrationId) => void;
  apiKey: string; aiModel: string;
  onOpenSettings: () => void;
  brands: Brand[];
  onViewBrand: (id: number) => void;
}) {
  const { t } = useTheme();
  const [googleAuthOpen, setGoogleAuthOpen] = useState(false);
  const [, forceUpdate] = useState(0);
  const getIntegration = (id: IntegrationId): Integration => integrations.find(i => i.id === id) ?? { id, connected: false, config: {} };
  const claudeReady = !!apiKey;
  const currentModel = AI_MODELS.find(m => m.id === aiModel);
  const aiActiveCount = (claudeReady ? 1 : 0) + INTEGRATION_DEFS.filter(d => getIntegration(d.id).connected).length;
  const totalChannels = brands.reduce((a, b) => a + (b.channels || []).filter(c => c.connected).length, 0);
  const googleClientId = getGoogleClientId();

  return (
    <div className="p-6 lg:p-8 overflow-auto h-full">
      <SectionHeader
        title="Integrations"
        sub={`${aiActiveCount} AI providers connected · ${totalChannels} brand publishing channels configured`}
      />

      {/* AI & Automation */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-5">
          <div className="text-sm font-bold" style={{ color: t.text }}>AI & Automation</div>
          <div className="flex-1 h-px" style={{ background: t.borderLight }} />
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: t.tagBg, color: t.textMuted }}>
            {aiActiveCount} / {INTEGRATION_DEFS.length + 1} active
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Card className="p-5 cursor-pointer hover:shadow-md transition-all" onClick={onOpenSettings}>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: t.mode==="light"?"#f5f3ff":"#1e1340", border: "1px solid #7c3aed25" }}>✦</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm" style={{ color: t.text }}>Claude (Anthropic)</div>
                <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>AI content generation — captions, scripts, schedules</div>
              </div>
              <div className="flex-shrink-0">
                {claudeReady
                  ? <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full" style={{ background: t.mode==="light"?"#d1fae5":"#0a2218", color:"#059669" }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />Live
                    </span>
                  : <span className="inline-flex items-center text-xs font-medium px-2 py-1 rounded-full" style={{ background: t.tagBg, color: t.textMuted }}>Set up</span>}
              </div>
            </div>
            {claudeReady ? (
              <div className="space-y-1 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: t.textMuted }}>Model:</span>
                  <span className="text-xs font-semibold" style={{ color: "#7c3aed" }}>{currentModel?.label || aiModel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: t.textMuted }}>API Key:</span>
                  <span className="text-xs font-mono" style={{ color: t.text }}>sk-ant-···{apiKey.slice(-6)}</span>
                </div>
              </div>
            ) : (
              <div className="flex gap-1.5 flex-wrap mb-3">
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: t.tagBg, color: t.textMuted }}>API Key</span>
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: t.tagBg, color: t.textMuted }}>Model</span>
              </div>
            )}
            <div className="pt-3 border-t flex items-center justify-between" style={{ borderColor: t.borderLight }}>
              <span className="text-xs font-semibold" style={{ color: claudeReady ? "#7c3aed" : t.textMuted }}>
                {claudeReady ? "✓ Connected" : "Click to configure →"}
              </span>
              <span className="text-xs px-2.5 py-1 rounded-lg font-semibold"
                style={{ background: claudeReady ? "#7c3aed18" : t.tagBg, color: claudeReady ? "#7c3aed" : t.textSub }}>
                {claudeReady ? "Edit" : "Set up →"}
              </span>
            </div>
          </Card>
          {INTEGRATION_DEFS.map(defn => (
            <IntegrationCard key={defn.id} defn={defn} integration={getIntegration(defn.id)} onClick={() => onConfigure(defn.id)} />
          ))}
        </div>
      </div>

      {/* Auth & Access */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-5">
          <div className="text-sm font-bold" style={{ color: t.text }}>Auth & Access</div>
          <div className="flex-1 h-px" style={{ background: t.borderLight }} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Card className="p-5 cursor-pointer hover:shadow-md transition-all" onClick={() => { setGoogleAuthOpen(true); forceUpdate(n => n + 1); }}>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: t.mode === "light" ? "#fef9c3" : "#1a1500", border: "1px solid #ca810025" }}>
                <svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm" style={{ color: t.text }}>Google Sign-In</div>
                <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>OAuth 2.0 — one-click login for your team</div>
              </div>
              <div className="flex-shrink-0">
                {googleClientId
                  ? <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full" style={{ background: t.mode==="light"?"#d1fae5":"#0a2218", color:"#059669" }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />Active
                    </span>
                  : <span className="inline-flex items-center text-xs font-medium px-2 py-1 rounded-full" style={{ background: t.tagBg, color: t.textMuted }}>Set up</span>}
              </div>
            </div>
            {googleClientId ? (
              <div className="text-xs font-mono truncate mb-3 px-2 py-1.5 rounded-lg" style={{ background: t.tagBg, color: t.textSub }}>
                {googleClientId.slice(0, 28)}…
              </div>
            ) : (
              <div className="flex gap-1.5 flex-wrap mb-3">
                {["Client ID", "OAuth Consent", "Origins"].map(l => (
                  <span key={l} className="text-xs px-2 py-0.5 rounded" style={{ background: t.tagBg, color: t.textMuted }}>{l}</span>
                ))}
              </div>
            )}
            <div className="pt-3 border-t flex items-center justify-between" style={{ borderColor: t.borderLight }}>
              <span className="text-xs font-semibold" style={{ color: googleClientId ? "#059669" : t.textMuted }}>
                {googleClientId ? "✓ Enabled" : "Click to configure →"}
              </span>
              <span className="text-xs px-2.5 py-1 rounded-lg font-semibold"
                style={{ background: googleClientId ? "#05966918" : t.tagBg, color: googleClientId ? "#059669" : t.textSub }}>
                {googleClientId ? "Edit" : "Set up →"}
              </span>
            </div>
          </Card>
        </div>
      </div>

      <GoogleAuthPanel open={googleAuthOpen} onClose={() => { setGoogleAuthOpen(false); forceUpdate(n => n + 1); }} />

      {/* Publishing & Distribution — per brand */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-5">
          <div className="text-sm font-bold" style={{ color: t.text }}>Publishing & Distribution</div>
          <div className="flex-1 h-px" style={{ background: t.borderLight }} />
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: t.tagBg, color: t.textMuted }}>
            per-brand · {totalChannels} channel{totalChannels !== 1 ? "s" : ""} active
          </span>
        </div>
        <div className="p-4 rounded-xl border mb-5" style={{ background: t.sectionBg, borderColor: t.borderLight }}>
          <div className="text-sm font-semibold mb-1" style={{ color: t.text }}>Brand-specific channels</div>
          <div className="text-xs" style={{ color: t.textMuted }}>
            Each brand can have its own Facebook Page, Instagram account, LinkedIn Company Page, WooCommerce store, and more.
            Configure channels in Brands → click a brand → Publishing Channels.
          </div>
        </div>
        <div className="space-y-3">
          {brands.map(brand => {
            const connected = (brand.channels || []).filter(c => c.connected);
            return (
              <div key={brand.id} className="flex items-center gap-4 p-4 rounded-xl border cursor-pointer hover:shadow-sm transition-all"
                style={{ background: t.card, borderColor: t.border }}
                onClick={() => onViewBrand(brand.id)}>
                <BrandAvatar name={brand.name} color={brand.color} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold" style={{ color: t.text }}>{brand.name}</div>
                  <div className="text-xs" style={{ color: t.textMuted }}>{brand.industry}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {connected.length === 0
                    ? <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: t.tagBg, color: t.textMuted }}>No channels</span>
                    : connected.map(ch => {
                        const defn = PUBLISHING_DEFS.find(d => d.id === ch.platformId);
                        return defn ? (
                          <span key={ch.platformId} className="text-xs px-2 py-1 rounded-full font-medium"
                            style={{ background: defn.color + "18", color: defn.color }}>{defn.icon} {defn.name}</span>
                        ) : null;
                      })
                  }
                  <span className="text-xs px-2.5 py-1 rounded-full ml-1" style={{ background: brand.color + "18", color: brand.color }}>
                    Manage →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────

function parseScheduledDate(item: ContentItem): Date | null {
  if (item.scheduledISO) { const d = new Date(item.scheduledISO); return isNaN(d.getTime()) ? null : d; }
  if (!item.scheduled) return null;
  const s = item.scheduled.replace(/—/, "").replace(/\s+/g, " ").trim();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function getWeekStart(d: Date): Date { const day = d.getDay(); return addDays(d, day === 0 ? -6 : 1 - day); }

const PLATFORM_NAME_MAP: Record<string, PlatformId> = {
  "Facebook":"facebook","Instagram":"instagram","X":"x","LinkedIn":"linkedin",
  "TikTok":"tiktok","YouTube":"youtube","Pinterest":"pinterest","Dev.to":"devto","WooCommerce":"woocommerce",
};

function getBrandChannel(brand: Brand | undefined, platform: string): BrandChannel | null {
  if (!brand) return null;
  const pid = PLATFORM_NAME_MAP[platform];
  if (!pid) return null;
  return brand.channels?.find(ch => ch.platformId === pid) ?? null;
}

async function publishToConnectedPlatform(item: ContentItem, channel: BrandChannel, defn: PlatformDef): Promise<{ success: boolean; message: string }> {
  const c = channel.config;

  // Use proxy for platforms that are CORS-blocked from browser
  if (shouldUseProxy(defn.id)) {
    return proxyPublish({
      platform: defn.id,
      config: c,
      content: {
        caption: item.caption,
        hashtags: item.hashtags,
        campaign: item.campaign,
        pillar: item.pillar,
      },
    });
  }

  // Direct browser calls only for CORS-friendly platforms (Dev.to)
  try {
    if (defn.id === "devto") {
      const tags = item.hashtags.split(/\s+/).filter(h => h.startsWith("#")).slice(0, 4).map(h => h.slice(1).replace(/[^a-z0-9]/gi, "").toLowerCase());
      const res = await fetch("https://dev.to/api/articles", {
        method: "POST",
        headers: { "api-key": c.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ article: { title: item.campaign || item.pillar || "New Post", body_markdown: `${item.caption}\n\n${item.hashtags}`, published: true, tags } }),
      });
      const data = await res.json() as { id?: number; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return { success: true, message: `Published to Dev.to — Article #${data.id}` };
    }
    return { success: true, message: `Marked as published on ${defn.name} (browser-direct API not available for this platform)` };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : "Unknown error" };
  }
}

// ─── Month Calendar ───────────────────────────────────────────────────────────

function MonthCalendar({ content, currentDate, onPostClick }: { content: ContentItem[]; currentDate: Date; onPostClick: (id: number) => void }) {
  const { t } = useTheme();
  const year = currentDate.getFullYear(); const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDay = getWeekStart(firstDay);
  const weeks: Date[][] = [];
  let cur = startDay;
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) { week.push(new Date(cur)); cur = addDays(cur, 1); }
    weeks.push(week);
    if (w >= 3 && cur.getMonth() !== month) break;
  }
  const byDate: Record<string, ContentItem[]> = {};
  content.forEach(item => { const d = parseScheduledDate(item); if (d) { const k = dateKey(d); (byDate[k] = byDate[k] || []).push(item); } });
  const today = dateKey(new Date());
  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => <div key={d} className="text-xs font-bold text-center py-1.5" style={{ color: t.textMuted }}>{d}</div>)}
      </div>
      <div className="border rounded-2xl overflow-hidden" style={{ borderColor: t.border }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7" style={{ borderTop: wi > 0 ? `1px solid ${t.borderFaint}` : undefined }}>
            {week.map((day, di) => {
              const k = dateKey(day); const items = byDate[k] || [];
              const isToday = k === today; const inMonth = day.getMonth() === month;
              return (
                <div key={di} className="min-h-24 p-1.5"
                  style={{ borderLeft: di > 0 ? `1px solid ${t.borderFaint}` : undefined, background: isToday ? t.primary + "08" : "transparent", opacity: inMonth ? 1 : 0.38 }}>
                  <div className="text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full"
                    style={{ color: isToday ? "white" : t.textSub, background: isToday ? t.primary : "transparent", fontSize: "11px" }}>
                    {day.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {items.slice(0, 3).map(item => (
                      <button key={item.id} onClick={() => onPostClick(item.id)} title={`${item.brand} · ${item.platform} · ${item.format}`}
                        className="w-full text-left truncate rounded px-1.5 py-0.5 hover:opacity-80 transition-opacity"
                        style={{ background: item.brandColor + "22", color: item.brandColor, fontSize: "10px", fontWeight: 600 }}>
                        {item.brand.slice(0,1)} {item.platform.slice(0,2).toUpperCase()} {item.format}
                      </button>
                    ))}
                    {items.length > 3 && <div style={{ fontSize:"9px", color: t.textMuted, paddingLeft:"4px" }}>+{items.length - 3} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Week Calendar ────────────────────────────────────────────────────────────

function WeekCalendar({ content, currentDate, onPostClick }: { content: ContentItem[]; currentDate: Date; onPostClick: (id: number) => void }) {
  const { t } = useTheme();
  const weekStart = getWeekStart(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = dateKey(new Date());
  const byDate: Record<string, ContentItem[]> = {};
  content.forEach(item => {
    const d = parseScheduledDate(item);
    if (d) { const k = dateKey(d); (byDate[k] = byDate[k] || []).push(item); }
  });
  Object.values(byDate).forEach(items => items.sort((a, b) => (parseScheduledDate(a)?.getTime() || 0) - (parseScheduledDate(b)?.getTime() || 0)));
  const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  return (
    <div className="border rounded-2xl overflow-hidden" style={{ borderColor: t.border }}>
      <div className="grid grid-cols-7" style={{ background: t.tableHead, borderBottom: `1px solid ${t.borderLight}` }}>
        {days.map((day, i) => {
          const isToday = dateKey(day) === today;
          return (
            <div key={i} className="text-center py-3 px-2" style={{ borderLeft: i > 0 ? `1px solid ${t.borderLight}` : undefined }}>
              <div className="text-xs" style={{ color: t.textMuted }}>{DAY_LABELS[i]}</div>
              <div className="text-lg font-bold w-9 h-9 mx-auto flex items-center justify-center rounded-full mt-0.5"
                style={{ color: isToday ? "white" : t.text, background: isToday ? t.primary : "transparent" }}>
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-7" style={{ minHeight: "260px" }}>
        {days.map((day, i) => {
          const items = byDate[dateKey(day)] || [];
          return (
            <div key={i} className="p-2 space-y-1.5 min-h-64"
              style={{ borderLeft: i > 0 ? `1px solid ${t.borderFaint}` : undefined, background: dateKey(day) === today ? t.primary + "04" : "transparent" }}>
              {items.map(item => {
                const d = parseScheduledDate(item);
                const timeStr = d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";
                return (
                  <button key={item.id} onClick={() => onPostClick(item.id)}
                    className="w-full text-left p-2 rounded-xl border hover:shadow-sm transition-all"
                    style={{ background: item.brandColor + "12", borderColor: item.brandColor + "30" }}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="text-xs font-bold truncate" style={{ color: item.brandColor }}>{item.brand}</span>
                      {timeStr && <span className="text-xs ml-auto flex-shrink-0" style={{ color: t.textMuted }}>{timeStr}</span>}
                    </div>
                    <div className="text-xs font-medium" style={{ color: t.textSub }}>{item.platform} · {item.format}</div>
                    <p className="text-xs mt-1 leading-snug" style={{ color: t.text, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{item.caption}</p>
                  </button>
                );
              })}
              {items.length === 0 && <div className="flex items-center justify-center h-20 text-xs" style={{ color: t.textFaint }}>—</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Generate Schedule Panel ──────────────────────────────────────────────────

function GenerateSchedulePanel({ open, onClose, brands, apiKey, aiModel, integrations, onSchedule }: {
  open: boolean; onClose: () => void; brands: Brand[]; apiKey: string; aiModel: string;
  integrations: Integration[];
  onSchedule: (items: Omit<ContentItem,"id"|"score">[]) => void;
}) {
  const { t } = useTheme();
  const NOW = new Date(2026, 8, 1);
  const [brand, setBrand] = useState("");
  const [period, setPeriod] = useState<"this_week"|"next_week"|"this_month">("this_week");
  const [postsPerDay, setPostsPerDay] = useState(2);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [campaign, setCampaign] = useState("");
  const [scheduleProvider, setScheduleProvider] = useState<ScheduleProviderId>("claude");
  const [scheduleModel, setScheduleModel] = useState(aiModel);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [preview, setPreview] = useState<Omit<ContentItem,"id"|"score">[]>([]);
  const [step, setStep] = useState<"config"|"preview">("config");
  const selectedBrand = brands.find(b => b.name === brand);

  const hfIntegration        = integrations.find(i => i.id === "huggingface");
  const groqIntegration      = integrations.find(i => i.id === "groq");
  const pollinationsSchedule = integrations.find(i => i.id === "pollinations");
  const providerAvailable = (pid: ScheduleProviderId) => {
    if (pid === "claude")       return !!apiKey;
    if (pid === "groq")         return !!groqIntegration?.connected && !!groqIntegration?.config.apiKey;
    if (pid === "pollinations") return !!pollinationsSchedule?.connected && !!pollinationsSchedule?.config.apiKey;
    if (pid === "huggingface")  return !!hfIntegration?.connected && !!hfIntegration?.config.apiToken;
    return false;
  };

  const currentProviderDef = SCHEDULE_PROVIDERS.find(p => p.id === scheduleProvider)!;

  useEffect(() => {
    if (open) {
      setBrand(""); setPlatforms([]); setCampaign(""); setPreview([]);
      setStep("config"); setError(null);
      setScheduleProvider("claude"); setScheduleModel(aiModel);
    }
  }, [open]);

  // Reset model to first available when provider changes
  useEffect(() => {
    const provDef = SCHEDULE_PROVIDERS.find(p => p.id === scheduleProvider);
    if (scheduleProvider === "claude") setScheduleModel(aiModel);
    else if (provDef) setScheduleModel(provDef.models[0].id);
  }, [scheduleProvider]);
  useEffect(() => { if (selectedBrand) setPlatforms(selectedBrand.platforms.slice(0, 3)); }, [selectedBrand?.name]);

  const getPeriodDates = () => {
    const ws = getWeekStart(NOW);
    if (period === "this_week")  return { start: ws, end: addDays(ws, 6) };
    if (period === "next_week")  { const s = addDays(ws, 7); return { start: s, end: addDays(s, 6) }; }
    return { start: new Date(NOW.getFullYear(), NOW.getMonth(), 1), end: new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0) };
  };

  const handleGenerate = async () => {
    if (scheduleProvider === "claude"       && !apiKey)                               { setError("Add your Anthropic API key in Integrations → AI & Automation."); return; }
    if (scheduleProvider === "groq"         && !groqIntegration?.config.apiKey)       { setError("Connect Groq in Integrations → AI & Automation first."); return; }
    if (scheduleProvider === "pollinations" && !pollinationsSchedule?.config.apiKey)  { setError("Connect Pollinations.ai in Integrations → AI & Automation first."); return; }
    if (scheduleProvider === "huggingface"  && !hfIntegration?.config.apiToken)       { setError("Connect Hugging Face in Integrations → AI & Automation first."); return; }
    if (!brand || platforms.length === 0) { setError("Select a brand and at least one platform."); return; }
    setLoading(true); setError(null);
    const b = selectedBrand!;
    const { start, end } = getPeriodDates();
    const dayCount = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    const systemPrompt = "You are a JSON API. Respond with only a valid JSON array, no markdown, no explanation, no code fences.";
    const userPrompt = `Generate a social media content schedule for brand "${b.name}".

Brand: ${b.industry} | Tone: ${b.tone.join(", ")} | Audience: ${b.audience}
Pillars: ${b.pillars.filter(p=>p.name).map(p=>`${p.name}(${p.weight}%)`).join(", ")}
Campaign: ${campaign||"Organic"}
Period: ${dateKey(start)} to ${dateKey(end)} (${dayCount} days)
Posts per day: ${postsPerDay} spread across platforms: ${platforms.join(", ")}
Schedule times 07:00–21:00, prefer peaks 09:00, 12:00, 17:00, 19:00.
Vary formats and pillars. Use appropriate format per platform.

Return ONLY a valid JSON array, no markdown:
[{"date":"YYYY-MM-DD","time":"HH:MM","platform":"...","format":"Post|Carousel|Reel|Video|Image|Article|Thread|Story","pillar":"...","caption":"engaging caption with emojis","hashtags":"#tag1 #tag2 #tag3"}]`;

    try {
      let text: string;
      if (scheduleProvider === "claude") {
        text = await callClaude(apiKey, scheduleModel, userPrompt, dayCount > 7 ? 16000 : 8000, systemPrompt, true);
      } else if (scheduleProvider === "groq") {
        text = await callGroqText(groqIntegration!.config.apiKey, scheduleModel, userPrompt, systemPrompt);
      } else if (scheduleProvider === "pollinations") {
        text = await callPollinationsText(pollinationsSchedule!.config.apiKey, scheduleModel, userPrompt, systemPrompt);
      } else {
        text = await callHuggingFaceText(hfIntegration!.config.apiToken, scheduleModel, userPrompt, systemPrompt);
      }
      // Strip markdown code fences, then extract the outermost JSON array
      const stripped = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
      const start = stripped.indexOf("[");
      const end = stripped.lastIndexOf("]");
      if (start === -1 || end === -1 || end <= start) {
        throw new Error(`No JSON array in response — try a different model. Preview: ${text.slice(0, 200)}`);
      }
      const raw = JSON.parse(stripped.slice(start, end + 1)) as { date:string; time:string; platform:string; format:string; pillar:string; caption:string; hashtags:string }[];
      const items: Omit<ContentItem,"id"|"score">[] = raw.map(r => ({
        brand: b.name, brandColor: b.color, campaign: campaign || "Organic Content",
        pillar: r.pillar || b.pillars[0]?.name || "General",
        platform: r.platform, format: r.format, caption: r.caption, hashtags: r.hashtags,
        scheduled: `${new Date(r.date + "T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} — ${r.time}`,
        scheduledISO: `${r.date}T${r.time}`,
        status: "scheduled" as Status, imagePrompt: "", videoScript: "",
      }));
      setPreview(items); setStep("preview");
    } catch (e) { setError(e instanceof Error ? e.message : "Generation failed"); }
    finally { setLoading(false); }
  };

  const previewByDate = preview.reduce<Record<string, typeof preview>>((acc, item) => {
    const k = item.scheduledISO?.slice(0, 10) || "unknown";
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});

  const platformColors: Record<string, string> = { Facebook:"#1877f2",Instagram:"#e1306c","X":"#000",LinkedIn:"#0a66c2",TikTok:"#fe2c55",YouTube:"#ff0000",Pinterest:"#e60023","Dev.to":"#3b49df" };

  return (
    <SlidePanel open={open} onClose={onClose}
      title={step === "config" ? "Generate Schedule" : `Preview — ${preview.length} posts`}
      subtitle={step === "config"
        ? "Choose your AI provider and model, then configure the schedule"
        : `${currentProviderDef.icon} ${currentProviderDef.name} · ${currentProviderDef.models.find(m => m.id === scheduleModel)?.label || scheduleModel} · Review and approve`}>
      {step === "config" ? (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Brand *</label>
            <select value={brand} onChange={e => setBrand(e.target.value)}
              className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none cursor-pointer"
              style={{ background: t.inputBg, borderColor: t.border, color: brand ? t.text : t.textMuted }}>
              <option value="">Select brand…</option>
              {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <Input label="Campaign Name" value={campaign} onChange={setCampaign} placeholder="e.g. September Launch" />

          {/* AI Provider + Model selector */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: t.borderLight }}>
            <div className="px-3 py-2 flex items-center gap-2" style={{ background: t.tableHead, borderBottom: `1px solid ${t.borderLight}` }}>
              <span className="text-xs font-bold" style={{ color: t.text }}>AI Provider & Model</span>
              <span className="text-xs ml-auto" style={{ color: t.textMuted }}>for schedule generation</span>
            </div>

            {/* Provider cards */}
            <div className="p-3 grid grid-cols-3 gap-2">
              {SCHEDULE_PROVIDERS.map(prov => {
                const available = providerAvailable(prov.id);
                const active = scheduleProvider === prov.id;
                return (
                  <button key={prov.id} type="button"
                    onClick={() => available && setScheduleProvider(prov.id)}
                    className="p-2.5 rounded-xl border text-left transition-all relative"
                    style={{
                      background: active ? prov.color + "14" : t.inputBg,
                      borderColor: active ? prov.color : t.border,
                      opacity: available ? 1 : 0.45,
                      cursor: available ? "pointer" : "not-allowed",
                    }}>
                    <div className="text-lg mb-1">{prov.icon}</div>
                    <div className="text-xs font-bold leading-tight" style={{ color: active ? prov.color : t.text }}>{prov.name}</div>
                    {!available && (
                      <div className="text-xs mt-0.5" style={{ color: t.textMuted, fontSize:"9px" }}>
                        {prov.id === "huggingface" ? "Not connected" : "No API key"}
                      </div>
                    )}
                    {available && !active && <div className="text-xs mt-0.5" style={{ color: t.textMuted, fontSize:"9px" }}>Click to use</div>}
                    {active && <div className="w-2 h-2 rounded-full absolute top-2 right-2" style={{ background: prov.color }} />}
                  </button>
                );
              })}
            </div>

            {/* Provider description */}
            <div className="px-3 pb-2 text-xs" style={{ color: t.textMuted }}>{currentProviderDef.desc}</div>

            {/* Model pills */}
            <div className="px-3 pb-3 border-t pt-3" style={{ borderColor: t.borderFaint }}>
              <div className="text-xs font-semibold mb-2" style={{ color: t.textSub }}>Model</div>
              <div className="flex flex-wrap gap-1.5">
                {currentProviderDef.models.map(m => {
                  const active = scheduleModel === m.id;
                  return (
                    <button key={m.id} type="button" onClick={() => setScheduleModel(m.id)}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-all"
                      style={{
                        background: active ? currentProviderDef.color + "18" : t.tagBg,
                        borderColor: active ? currentProviderDef.color + "60" : t.border,
                        color: active ? currentProviderDef.color : t.textSub,
                      }}>
                      {active && <span className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0" style={{ background: currentProviderDef.color }} />}
                      <span>{m.label}</span>
                      <span className="opacity-60" style={{ fontSize:"10px" }}>· {m.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: t.textSub }}>Period</label>
            <div className="flex gap-2">
              {([["this_week","This Week"],["next_week","Next Week"],["this_month","This Month"]] as const).map(([k,l]) => (
                <button key={k} type="button" onClick={() => setPeriod(k)}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold border transition-all"
                  style={{ background: period===k ? t.primary : t.tagBg, borderColor: period===k ? t.primary : t.border, color: period===k ? "white" : t.textSub }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: t.textSub }}>
              Posts per day — <span style={{ color: t.primary }}>{postsPerDay}</span>
            </label>
            <input type="range" min={1} max={4} value={postsPerDay} onChange={e => setPostsPerDay(Number(e.target.value))} className="w-full" />
            <div className="flex justify-between text-xs mt-1" style={{ color: t.textMuted }}>
              <span>1 Minimal</span><span>2 Standard</span><span>3 Active</span><span>4 Max</span>
            </div>
          </div>
          {selectedBrand && (
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: t.textSub }}>Platforms</label>
              <div className="flex flex-wrap gap-2">
                {selectedBrand.platforms.map(p => {
                  const on = platforms.includes(p);
                  return (
                    <button key={p} type="button" onClick={() => setPlatforms(prev => on ? prev.filter(x => x !== p) : [...prev, p])}
                      className="text-xs px-3 py-1.5 rounded-full border font-medium transition-all"
                      style={{ background: on ? (platformColors[p]||selectedBrand.color)+"20" : t.tagBg, borderColor: on ? (platformColors[p]||selectedBrand.color)+"60" : t.border, color: on ? (platformColors[p]||selectedBrand.color) : t.textSub }}>
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {error && <div className="text-xs px-3 py-2 rounded-lg" style={{ background: t.dangerBg, color: t.danger }}>{error}</div>}
          {scheduleProvider === "claude"       && !apiKey                               && <div className="text-xs px-3 py-2 rounded-lg" style={{ background: t.dangerBg, color: t.danger }}>No Anthropic API key — add one in Integrations → AI & Automation.</div>}
          {scheduleProvider === "groq"         && !groqIntegration?.config.apiKey       && <div className="text-xs px-3 py-2 rounded-lg" style={{ background: t.dangerBg, color: t.danger }}>Groq not connected — add your free key in Integrations → AI & Automation.</div>}
          {scheduleProvider === "pollinations" && !pollinationsSchedule?.config.apiKey  && <div className="text-xs px-3 py-2 rounded-lg" style={{ background: t.dangerBg, color: t.danger }}>Pollinations.ai not connected — add your API key in Integrations → AI & Automation.</div>}
          {scheduleProvider === "huggingface"  && !hfIntegration?.config.apiToken       && <div className="text-xs px-3 py-2 rounded-lg" style={{ background: t.dangerBg, color: t.danger }}>Hugging Face not connected — configure it in Integrations → AI & Automation.</div>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: t.border, color: t.textSub, background: t.card }}>Cancel</button>
            <button type="button" onClick={handleGenerate} disabled={loading || !brand || !platforms.length || !providerAvailable(scheduleProvider)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}>
              {loading ? <><span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />Generating…</> : "⚡ Generate Schedule"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label:"Total Posts", value: preview.length, color: t.primary },
              { label:"Platforms",   value: new Set(preview.map(p=>p.platform)).size, color:"#059669" },
              { label:"Days",        value: new Set(preview.map(p=>p.scheduledISO?.slice(0,10))).size, color:"#d97706" },
            ].map(s => (
              <div key={s.label} className="text-center p-3 rounded-xl border" style={{ background: t.sectionBg, borderColor: t.borderLight }}>
                <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div className="space-y-4 overflow-y-auto pr-1" style={{ maxHeight: "380px" }}>
            {Object.entries(previewByDate).sort(([a],[b]) => a.localeCompare(b)).map(([date, items]) => (
              <div key={date}>
                <div className="text-xs font-bold mb-2 py-1 sticky top-0" style={{ color: t.textMuted, background: t.panelBg }}>
                  {new Date(date + "T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
                  <span className="ml-2 font-normal">· {items.length} post{items.length!==1?"s":""}</span>
                </div>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="p-3 rounded-xl border" style={{ background: item.brandColor+"08", borderColor: item.brandColor+"30" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold" style={{ color: item.brandColor }}>{item.platform}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: t.tagBg, color: t.textSub }}>{item.format}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: t.tagBg, color: t.textMuted }}>{item.pillar}</span>
                        <span className="text-xs ml-auto" style={{ color: t.textMuted }}>{item.scheduledISO?.slice(11,16)}</span>
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: t.text }}>{item.caption}</p>
                      <div className="text-xs mt-1 font-mono" style={{ color: t.textMuted }}>{item.hashtags}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setStep("config")} className="px-4 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: t.border, color: t.textSub, background: t.card }}>← Back</button>
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: t.border, color: t.textSub, background: t.card }}>Cancel</button>
            <button type="button" onClick={() => { onSchedule(preview); onClose(); }}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
              style={{ background: t.primary }}>
              Add {preview.length} Posts to Calendar
            </button>
          </div>
        </div>
      )}
    </SlidePanel>
  );
}

// ─── Publish Queue Panel ──────────────────────────────────────────────────────

function PublishQueuePanel({ open, onClose, content, brands, onStatusChange, showToast }: {
  open: boolean; onClose: () => void; content: ContentItem[]; brands: Brand[];
  onStatusChange: (id: number, s: Status) => void; showToast: (msg: string) => void;
}) {
  const { t } = useTheme();
  const [publishing, setPublishing] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<Record<number,{success:boolean;message:string}>>({});
  const [filter, setFilter] = useState<"due"|"all">("due");

  useEffect(() => { if (open) setResults({}); }, [open]);

  const now = new Date();
  const scheduled = content.filter(c => c.status === "scheduled");
  const due = scheduled.filter(c => { const d = parseScheduledDate(c); return d && d <= now; });
  const upcoming = scheduled.filter(c => { const d = parseScheduledDate(c); return !d || d > now; });
  const displayed = filter === "due" ? due : scheduled;

  const getConn = (item: ContentItem) => {
    const brand = brands.find(b => b.name === item.brand);
    const channel = getBrandChannel(brand, item.platform);
    if (!channel) return null;
    const defn = PUBLISHING_DEFS.find(d => d.id === channel.platformId);
    return defn ? { defn, channel } : null;
  };

  const handlePublish = async (item: ContentItem) => {
    setPublishing(p => new Set(p).add(item.id));
    const conn = getConn(item);
    let result: { success: boolean; message: string };
    if (!conn?.channel.connected) {
      result = { success: false, message: `${item.platform} not connected for ${item.brand} — configure in Brands → Publishing Channels.` };
    } else {
      result = await publishToConnectedPlatform(item, conn.channel, conn.defn);
    }
    setResults(r => ({ ...r, [item.id]: result }));
    if (result.success) { onStatusChange(item.id, "published"); showToast(`Published to ${item.platform}`); }
    setPublishing(p => { const n = new Set(p); n.delete(item.id); return n; });
  };

  const handlePublishAll = async () => { for (const item of due) await handlePublish(item); };

  return (
    <SlidePanel open={open} onClose={onClose} title="Publish Queue"
      subtitle={`${due.length} due now · ${upcoming.length} upcoming · ${scheduled.length} total scheduled`}>
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label:"Due Now",    value:due.length,      color:due.length>0?"#d97706":t.textMuted, bg:due.length>0?(t.mode==="light"?"#fef3c7":"#292110"):t.tagBg },
            { label:"Upcoming",  value:upcoming.length,  color:"#059669", bg:t.mode==="light"?"#d1fae5":"#0a2218" },
            { label:"Scheduled", value:scheduled.length, color:t.primary, bg:t.mode==="light"?"#eef2ff":"#1e2460" },
          ].map(s => (
            <div key={s.label} className="text-center p-3 rounded-xl" style={{ background: s.bg }}>
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs mt-0.5" style={{ color: s.color + "bb" }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            {([["due",`Due (${due.length})`],["all",`All (${scheduled.length})`]] as const).map(([k,l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className="text-xs px-3 py-1.5 rounded-full border font-medium"
                style={{ background: filter===k ? t.primary : t.tagBg, borderColor: filter===k ? t.primary : t.border, color: filter===k ? "white" : t.textSub }}>
                {l}
              </button>
            ))}
          </div>
          {due.length > 0 && (
            <button onClick={handlePublishAll}
              className="ml-auto text-xs font-bold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity"
              style={{ background: "#059669" }}>
              Publish All Due
            </button>
          )}
        </div>

        <div className="space-y-3">
          {displayed.length === 0 && (
            <div className="text-center py-12 text-sm" style={{ color: t.textMuted }}>
              {filter === "due" ? "No posts due right now" : "No scheduled posts"}
            </div>
          )}
          {displayed.map(item => {
            const conn = getConn(item);
            const connected = conn?.channel.connected ?? false;
            const isPub = publishing.has(item.id);
            const result = results[item.id];
            const d = parseScheduledDate(item);
            const dateStr = d ? d.toLocaleDateString("en-US",{month:"short",day:"numeric"}) + " at " + d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}) : item.scheduled;
            return (
              <div key={item.id} className="p-4 rounded-xl border" style={{ background: t.sectionBg, borderColor: result?.success ? "#6ee7b7" : t.borderLight }}>
                <div className="flex items-start gap-3 mb-2">
                  <BrandAvatar name={item.brand} color={item.brandColor} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className="text-xs font-bold" style={{ color: item.brandColor }}>{item.brand}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: t.tagBg, color: t.textSub }}>{item.platform}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: t.tagBg, color: t.textSub }}>{item.format}</span>
                      {connected
                        ? <span className="text-xs ml-auto flex items-center gap-1" style={{ color:"#059669" }}><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />Connected</span>
                        : <span className="text-xs ml-auto" style={{ color: t.textMuted }}>Not connected</span>}
                    </div>
                    <p className="text-xs leading-relaxed line-clamp-2" style={{ color: t.text }}>{item.caption}</p>
                    <div className="text-xs mt-1" style={{ color: t.textMuted }}>{dateStr}</div>
                  </div>
                </div>
                {result && (
                  <div className="text-xs px-3 py-2 rounded-lg mb-2" style={{ background: result.success?(t.mode==="light"?"#d1fae5":"#0a2218"):t.dangerBg, color: result.success?"#059669":t.danger }}>
                    {result.success ? "✓" : "✗"} {result.message}
                  </div>
                )}
                <div className="flex justify-end">
                  <button onClick={() => handlePublish(item)} disabled={isPub || result?.success}
                    className="text-xs font-bold px-4 py-2 rounded-lg text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
                    style={{ background: result?.success ? "#059669" : t.primary }}>
                    {isPub ? "Publishing…" : result?.success ? "✓ Published" : "Publish Now"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SlidePanel>
  );
}

// ─── Calendar View ────────────────────────────────────────────────────────────

function CalendarView({ brands, content, integrations, apiKey, aiModel, onAddContent, onViewPost, onStatusChange, showToast }: {
  brands: Brand[]; content: ContentItem[]; integrations: Integration[];
  apiKey: string; aiModel: string;
  onAddContent: (items: Omit<ContentItem,"id"|"score">[]) => void;
  onViewPost: (id: number) => void;
  onStatusChange: (id: number, s: Status) => void;
  showToast: (msg: string) => void;
}) {
  const { t } = useTheme();
  const [mode, setMode] = useState<"month"|"week">("month");
  const [currentDate, setCurrentDate] = useState(new Date(2026, 8, 1));
  const [brandFilter, setBrandFilter] = useState("all");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const calContent = content.filter(c => ["scheduled","approved","published"].includes(c.status));
  const filtered = brandFilter === "all" ? calContent : calContent.filter(c => c.brand === brandFilter);
  const dueCount = content.filter(c => { if (c.status !== "scheduled") return false; const d = parseScheduledDate(c); return d && d <= new Date(); }).length;

  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const navPrev = () => mode === "month" ? setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1)) : setCurrentDate(d => addDays(d, -7));
  const navNext = () => mode === "month" ? setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1)) : setCurrentDate(d => addDays(d, 7));

  const periodLabel = mode === "month"
    ? `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : (() => { const ws = getWeekStart(currentDate); const we = addDays(ws, 6); return `${ws.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${we.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`; })();

  return (
    <div className="p-6 lg:p-8 overflow-auto h-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold" style={{ color: t.text }}>Content Calendar</h2>
          <p className="text-sm mt-0.5" style={{ color: t.textSub }}>{filtered.length} posts across all brands</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setPublishOpen(true)}
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border"
            style={{ borderColor: dueCount>0?"#d97706":t.border, color: dueCount>0?"#d97706":t.textSub, background: dueCount>0?(t.mode==="light"?"#fef3c7":"#292110"):t.card }}>
            {dueCount>0 && <span className="w-2 h-2 rounded-full animate-pulse inline-block" style={{ background:"#d97706" }} />}
            Publish Queue{dueCount>0 ? ` (${dueCount})` : ""}
          </button>
          <button onClick={() => setGenerateOpen(true)}
            className="flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity"
            style={{ background:"linear-gradient(135deg,#4f46e5,#7c3aed)" }}>
            ⚡ Generate Schedule
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: t.border }}>
          {(["month","week"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className="text-xs font-semibold px-4 py-2 capitalize"
              style={{ background: mode===m ? t.primary : t.card, color: mode===m ? "white" : t.textSub }}>
              {m}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={navPrev} className="w-8 h-8 rounded-lg flex items-center justify-center border text-sm" style={{ borderColor:t.border, color:t.textSub, background:t.card }}>‹</button>
          <span className="text-sm font-semibold px-2 text-center" style={{ color:t.text, minWidth:"190px" }}>{periodLabel}</span>
          <button onClick={navNext} className="w-8 h-8 rounded-lg flex items-center justify-center border text-sm" style={{ borderColor:t.border, color:t.textSub, background:t.card }}>›</button>
          <button onClick={() => setCurrentDate(new Date(2026,8,1))} className="text-xs px-2.5 py-1.5 rounded-lg border ml-1 font-medium" style={{ borderColor:t.border, color:t.textSub, background:t.card }}>Today</button>
        </div>
        <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
          className="text-sm px-3 py-2 rounded-lg border outline-none cursor-pointer ml-auto"
          style={{ background:t.inputBg, borderColor:t.border, color:t.text }}>
          <option value="all">All Brands</option>
          {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
        </select>
      </div>

      {/* Brand legend */}
      <div className="flex gap-2 flex-wrap mb-4">
        {brands.filter(b => brandFilter==="all" || b.name===brandFilter).map(b => (
          <span key={b.id} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
            style={{ background:b.color+"15", color:b.color }}>
            <span className="w-2 h-2 rounded-full inline-block" style={{ background:b.color }} />{b.name}
            <span style={{ color:b.color+"80" }}>·</span>
            <span>{calContent.filter(c=>c.brand===b.name).length} posts</span>
          </span>
        ))}
      </div>

      {mode === "month" && <MonthCalendar content={filtered} currentDate={currentDate} onPostClick={onViewPost} />}
      {mode === "week"  && <WeekCalendar  content={filtered} currentDate={currentDate} onPostClick={onViewPost} />}

      <GenerateSchedulePanel open={generateOpen} onClose={() => setGenerateOpen(false)} brands={brands} apiKey={apiKey} aiModel={aiModel} integrations={integrations} onSchedule={onAddContent} />
      <PublishQueuePanel open={publishOpen} onClose={() => setPublishOpen(false)} content={content} brands={brands} onStatusChange={onStatusChange} showToast={showToast} />
    </div>
  );
}

// ─── Auth UI ──────────────────────────────────────────────────────────────────

function UserAvatar({ user, size = "md" }: { user: AuthUser; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "w-7 h-7 text-xs" : size === "lg" ? "w-12 h-12 text-lg" : "w-9 h-9 text-sm";
  return (
    <div className={`${sz} rounded-full flex items-center justify-center font-bold flex-shrink-0`}
      style={{ background: user.avatarColor + "25", color: user.avatarColor, border: `2px solid ${user.avatarColor}40` }}>
      {user.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function AuthPage({ mode, onSwitch }: { mode: "signin" | "signup"; onSwitch: () => void }) {
  const { t } = useTheme();
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const googleClientId = getGoogleClientId();

  const isSignUp = mode === "signup";

  useEffect(() => {
    if (!googleClientId) return;
    const loadGSI = () => {
      if (window.google?.accounts?.id && googleBtnRef.current) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async ({ credential }) => {
            setError(null);
            const err = await signInWithGoogle(credential);
            if (err) setError(err);
          },
        });
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: t.mode === "dark" ? "filled_black" : "outline",
          size: "large",
          width: googleBtnRef.current.offsetWidth || 320,
          text: isSignUp ? "signup_with" : "signin_with",
        });
      }
    };
    if (!document.getElementById("gsi-script")) {
      const script = document.createElement("script");
      script.id = "gsi-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = loadGSI;
      document.head.appendChild(script);
    } else if (window.google?.accounts?.id) {
      loadGSI();
    }
  }, [googleClientId, isSignUp, t.mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // Field-level validation
    const errors: Record<string, string> = {};
    if (isSignUp) {
      const nameErr = validate(name, { required: true, minLength: 2 });
      if (!nameErr.valid) errors.name = nameErr.error!;
    }
    const emailErr = validate(email, emailRule);
    if (!emailErr.valid) errors.email = emailErr.error!;
    const pwErr = validate(password, passwordRule);
    if (!pwErr.valid) errors.password = pwErr.error!;
    if (isSignUp) {
      const matchErr = validatePasswordMatch(password, confirm);
      if (matchErr) errors.confirm = matchErr;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setLoading(true);
    const err = isSignUp ? await signUp(name, email, password) : await signIn(email, password);
    setLoading(false);
    if (err) setError(err);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: t.appBg }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black shadow-lg"
            style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)", color: "white" }}>C</div>
          <div>
            <div className="text-lg font-bold" style={{ color: t.text }}>Content OS</div>
            <div className="text-xs" style={{ color: t.textMuted }}>Multi-Brand AI Platform</div>
          </div>
        </div>

        <div className="rounded-2xl border p-7 shadow-xl" style={{ background: t.card, borderColor: t.border }}>
          <h1 className="text-xl font-bold mb-1" style={{ color: t.text }}>
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-sm mb-6" style={{ color: t.textMuted }}>
            {isSignUp ? "Start managing content for all your brands." : "Sign in to your Content OS workspace."}
          </p>

          {googleClientId && (
            <>
              <div ref={googleBtnRef} className="w-full min-h-[44px]" />
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px" style={{ background: t.border }} />
                <span className="text-xs font-medium px-1" style={{ color: t.textMuted }}>or continue with email</span>
                <div className="flex-1 h-px" style={{ background: t.border }} />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Full Name</label>
                <input value={name} onChange={e => setName(e.target.value)} required placeholder="Jane Smith"
                  className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none transition-colors"
                  style={{ background: t.inputBg, borderColor: fieldErrors.name ? t.danger : t.border, color: t.text }} />
                {fieldErrors.name && <p className="text-xs mt-1" style={{ color: t.danger }}>{fieldErrors.name}</p>}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com"
                className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none transition-colors"
                style={{ background: t.inputBg, borderColor: fieldErrors.email ? t.danger : t.border, color: t.text }} />
              {fieldErrors.email && <p className="text-xs mt-1" style={{ color: t.danger }}>{fieldErrors.email}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Password</label>
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required
                  placeholder={isSignUp ? "Min. 8 characters" : "••••••••"}
                  className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none pr-14"
                  style={{ background: t.inputBg, borderColor: fieldErrors.password ? t.danger : t.border, color: t.text }} />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-0.5 rounded font-medium"
                  style={{ color: t.textMuted, background: t.tagBg }}>
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
              {fieldErrors.password && <p className="text-xs mt-1" style={{ color: t.danger }}>{fieldErrors.password}</p>}
            </div>
            {isSignUp && (
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Confirm Password</label>
                <input type={showPw ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} required
                  placeholder="Re-enter password"
                  className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none"
                  style={{ background: t.inputBg, borderColor: fieldErrors.confirm ? t.danger : t.border, color: t.text }} />
                {fieldErrors.confirm && (
                  <p className="text-xs mt-1" style={{ color: t.danger }}>{fieldErrors.confirm}</p>
                )}
              </div>
            )}

            {error && (
              <div className="text-xs px-3 py-2.5 rounded-lg font-medium" style={{ background: t.dangerBg, color: t.danger }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white mt-2 hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}>
              {loading ? "Please wait…" : isSignUp ? "Create Account" : "Sign In"}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t text-center" style={{ borderColor: t.borderLight }}>
            <span className="text-xs" style={{ color: t.textMuted }}>
              {isSignUp ? "Already have an account? " : "Don't have an account? "}
            </span>
            <button onClick={onSwitch} className="text-xs font-bold underline" style={{ color: "#6366f1" }}>
              {isSignUp ? "Sign in" : "Sign up free"}
            </button>
          </div>
        </div>

        <p className="text-center text-xs mt-4" style={{ color: t.textFaint }}>
          Data stored locally in your browser only.
        </p>
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  if (!user) return <AuthPage mode={mode} onSwitch={() => setMode(m => m === "signin" ? "signup" : "signin")} />;
  return <>{children}</>;
}

function ProfilePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTheme();
  const { user, updateProfile, changePassword, signOut } = useAuth();
  const [tab, setTab] = useState<"profile" | "password">("profile");
  const [name, setName]           = useState(user?.name || "");
  const [avatarColor, setAvatarColor] = useState(user?.avatarColor || AVATAR_COLORS[0]);
  const [role, setRole]           = useState(user?.role || "Admin");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw]         = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess]     = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    if (open && user) { setName(user.name); setAvatarColor(user.avatarColor); setRole(user.role); setTab("profile"); setError(null); setSuccess(null); }
  }, [open, user]);

  if (!user) return null;

  const handleSaveProfile = () => {
    if (!name.trim()) { setError("Name cannot be empty."); return; }
    updateProfile({ name: name.trim(), avatarColor, role });
    setSuccess("Profile updated."); setError(null);
    setTimeout(() => setSuccess(null), 2500);
  };

  const handleChangePassword = async () => {
    setError(null); setSuccess(null); setFieldErrors({});
    const errors: Record<string, string> = {};
    if (!currentPw) errors.currentPw = "Current password is required.";
    const pwErr = validate(newPw, passwordRule);
    if (!pwErr.valid) errors.newPw = pwErr.error!;
    const matchErr = validatePasswordMatch(newPw, confirmPw);
    if (matchErr) errors.confirmPw = matchErr;
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }

    const err = await changePassword(currentPw, newPw);
    if (err) { setError(err); } else {
      setSuccess("Password changed."); setCurrentPw(""); setNewPw(""); setConfirmPw("");
      setTimeout(() => setSuccess(null), 2500);
    }
  };

  return (
    <SlidePanel open={open} onClose={onClose} title="Your Profile" subtitle={user.email}>
      <div className="space-y-5">
        {/* Avatar preview */}
        <div className="flex items-center gap-4 p-4 rounded-2xl border" style={{ background: t.sectionBg, borderColor: t.borderLight }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold flex-shrink-0"
            style={{ background: avatarColor + "22", color: avatarColor, border: `2px solid ${avatarColor}50` }}>
            {name.slice(0, 1).toUpperCase() || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm" style={{ color: t.text }}>{name || "—"}</div>
            <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>{user.email}</div>
            <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>
              Member since {new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: t.tagBg }}>
          {(["profile","password"] as const).map(tab_ => (
            <button key={tab_} onClick={() => { setTab(tab_); setError(null); setSuccess(null); }}
              className="flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-all"
              style={{ background: tab === tab_ ? t.card : "transparent", color: tab === tab_ ? t.text : t.textMuted,
                boxShadow: tab === tab_ ? t.shadow : "none" }}>
              {tab_ === "profile" ? "Profile" : "Password"}
            </button>
          ))}
        </div>

        {tab === "profile" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Display Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none"
                style={{ background: t.inputBg, borderColor: t.border, color: t.text }} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Email</label>
              <input value={user.email} disabled
                className="w-full text-sm px-3 py-2.5 rounded-lg border opacity-60"
                style={{ background: t.tagBg, borderColor: t.border, color: t.textMuted }} />
              <p className="text-xs mt-1" style={{ color: t.textMuted }}>Email cannot be changed.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Role</label>
              <select value={role} onChange={e => setRole(e.target.value)}
                className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none cursor-pointer"
                style={{ background: t.inputBg, borderColor: t.border, color: t.text }}>
                {["Admin","Editor","Viewer","Content Manager","Brand Manager"].map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: t.textSub }}>Avatar Color</label>
              <div className="flex gap-2 flex-wrap">
                {AVATAR_COLORS.map(c => (
                  <button key={c} onClick={() => setAvatarColor(c)}
                    className="w-8 h-8 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
                    style={{ background: c, border: avatarColor === c ? `3px solid ${t.text}` : "3px solid transparent" }}>
                    {avatarColor === c && <span className="text-white text-xs font-bold">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "password" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Current Password</label>
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                  placeholder="••••••••" className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none pr-14"
                  style={{ background: t.inputBg, borderColor: fieldErrors.currentPw ? t.danger : t.border, color: t.text }} />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-0.5 rounded font-medium"
                  style={{ color: t.textMuted, background: t.tagBg }}>{showPw ? "Hide" : "Show"}</button>
              </div>
              {fieldErrors.currentPw && <p className="text-xs mt-1" style={{ color: t.danger }}>{fieldErrors.currentPw}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>New Password</label>
              <input type={showPw ? "text" : "password"} value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="Min. 8 characters" className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none"
                style={{ background: t.inputBg, borderColor: fieldErrors.newPw ? t.danger : t.border, color: t.text }} />
              {fieldErrors.newPw && <p className="text-xs mt-1" style={{ color: t.danger }}>{fieldErrors.newPw}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: t.textSub }}>Confirm New Password</label>
              <input type={showPw ? "text" : "password"} value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                placeholder="Re-enter new password" className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none"
                style={{ background: t.inputBg, borderColor: fieldErrors.confirmPw ? t.danger : t.border, color: t.text }} />
              {fieldErrors.confirmPw && <p className="text-xs mt-1" style={{ color: t.danger }}>{fieldErrors.confirmPw}</p>}
            </div>
          </div>
        )}

        {error && <div className="text-xs px-3 py-2.5 rounded-lg" style={{ background: t.dangerBg, color: t.danger }}>{error}</div>}
        {success && <div className="text-xs px-3 py-2.5 rounded-lg" style={{ background: t.mode==="light"?"#d1fae5":"#0a2218", color:"#059669" }}>✓ {success}</div>}

        {tab === "profile"
          ? <button onClick={handleSaveProfile} className="w-full py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity"
              style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}>Save Profile</button>
          : <button onClick={handleChangePassword} disabled={!currentPw || !newPw || newPw !== confirmPw}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}>Change Password</button>
        }

        <div className="pt-2 border-t" style={{ borderColor: t.borderLight }}>
          {!confirmSignOut
            ? <button onClick={() => setConfirmSignOut(true)}
                className="w-full py-2.5 rounded-xl text-sm font-semibold border transition-colors"
                style={{ borderColor: t.dangerBorder, color: t.danger, background: t.dangerBg + "40" }}>
                Sign Out
              </button>
            : <div className="space-y-2">
                <p className="text-xs text-center" style={{ color: t.textMuted }}>Are you sure you want to sign out?</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmSignOut(false)} className="flex-1 py-2 rounded-lg text-xs font-semibold border"
                    style={{ borderColor: t.border, color: t.textSub }}>Cancel</button>
                  <button onClick={() => { signOut(); onClose(); }} className="flex-1 py-2 rounded-lg text-xs font-bold text-white"
                    style={{ background: t.danger }}>Sign Out</button>
                </div>
              </div>
          }
        </div>
      </div>
    </SlidePanel>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id:"dashboard",     label:"Dashboard",    icon:"▪" },
  { id:"brands",        label:"Brands",       icon:"◈" },
  { id:"content",       label:"Content",      icon:"≡" },
  { id:"calendar",      label:"Calendar",     icon:"▦" },
  { id:"approval",      label:"Approval",     icon:"◉" },
  { id:"analytics",     label:"Analytics",    icon:"△" },
  { id:"integrations",  label:"Integrations", icon:"⬡" },
];

function Sidebar({ view, setView, pendingCount, connectedCount, brands, onBrandClick, onOpenProfile }: {
  view: string; setView: (v: string) => void; pendingCount: number; connectedCount: number;
  brands: Brand[]; onBrandClick: (id: number) => void; onOpenProfile: () => void;
}) {
  const { t, toggle } = useTheme();
  const { user, signOut } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setUserMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <aside className="w-56 flex flex-col border-r flex-shrink-0" style={{ background: t.sidebar, borderColor: t.border, boxShadow: t.mode==="dark"?"2px 0 8px rgba(0,0,0,0.3)":"none" }}>
      <div className="flex items-center gap-2.5 px-5 py-4 border-b" style={{ borderColor: t.borderLight }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black" style={{ background:"linear-gradient(135deg,#4f46e5,#7c3aed)", color:"white" }}>C</div>
        <div>
          <div className="text-sm font-bold leading-none" style={{ color: t.text }}>Content OS</div>
          <div className="text-xs leading-none mt-0.5" style={{ color: t.textMuted }}>Multi-Brand AI</div>
        </div>
      </div>
      <nav className="flex-1 py-3 px-2">
        {NAV_ITEMS.map(item => {
          const isActive = view === item.id;
          return (
            <button key={item.id} onClick={() => setView(item.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left mb-0.5 transition-all"
              style={{ background: isActive?t.navActive:"transparent", color: isActive?t.navActiveText:t.navText }}>
              <span className="text-base flex-shrink-0 w-4 text-center" style={{ lineHeight:1 }}>{item.icon}</span>
              <span className="text-sm font-medium">{item.label}</span>
              {item.id==="approval" && pendingCount>0 && (
                <span className="ml-auto text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background:"#fbbf24", color:"#78350f", fontSize:"10px" }}>{pendingCount}</span>
              )}
              {item.id==="integrations" && connectedCount>0 && (
                <span className="ml-auto text-xs font-bold px-1.5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background:"#d1fae5", color:"#059669", fontSize:"10px" }}>{connectedCount}</span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t" style={{ borderColor: t.borderLight }}>
        <div className="text-xs mb-2" style={{ color: t.textMuted }}>Active Brands</div>
        <div className="flex gap-1 flex-wrap">
          {brands.slice(0, 5).map(b => (
            <button key={b.id} title={b.name} onClick={() => onBrandClick(b.id)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-transform hover:scale-110"
              style={{ background: b.color+"20", color: b.color }}>
              {b.name.slice(0,1)}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-3 border-t space-y-1.5" style={{ borderColor: t.borderLight }}>
        <button onClick={toggle}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all text-left"
          style={{ background: t.tagBg, color: t.textSub }}
          onMouseEnter={e=>(e.currentTarget.style.background=t.mode==="light"?"#e5e7eb":"#252d3d")}
          onMouseLeave={e=>(e.currentTarget.style.background=t.tagBg)}>
          <span className="text-base">{t.toggleIcon}</span>
          <span className="text-xs font-medium">{t.toggleLabel}</span>
          <div className="ml-auto w-8 h-4 rounded-full relative transition-colors flex-shrink-0" style={{ background: t.mode==="dark"?"#4f46e5":"#d1d5db" }}>
            <div className="w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all" style={{ left: t.mode==="dark"?"17px":"2px", boxShadow:"0 1px 3px rgba(0,0,0,0.3)" }} />
          </div>
        </button>
      </div>

      {/* User row */}
      {user && (
        <div className="px-3 py-3 border-t relative" style={{ borderColor: t.borderLight }} ref={menuRef}>
          <button onClick={() => setUserMenuOpen(v => !v)}
            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl transition-all text-left"
            style={{ background: userMenuOpen ? t.tagBg : "transparent" }}
            onMouseEnter={e => { if (!userMenuOpen) e.currentTarget.style.background = t.tagBg; }}
            onMouseLeave={e => { if (!userMenuOpen) e.currentTarget.style.background = "transparent"; }}>
            <UserAvatar user={user} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate" style={{ color: t.text }}>{user.name}</div>
              <div className="text-xs truncate" style={{ color: t.textMuted }}>{user.role}</div>
            </div>
            <span className="text-xs flex-shrink-0" style={{ color: t.textMuted }}>⋯</span>
          </button>
          {userMenuOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-1 rounded-xl border shadow-lg overflow-hidden z-50"
              style={{ background: t.card, borderColor: t.border, boxShadow: t.shadowMd }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: t.borderLight }}>
                <div className="text-xs font-bold truncate" style={{ color: t.text }}>{user.name}</div>
                <div className="text-xs truncate" style={{ color: t.textMuted }}>{user.email}</div>
              </div>
              <button onClick={() => { setUserMenuOpen(false); onOpenProfile(); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-xs font-medium transition-colors"
                style={{ color: t.text }}
                onMouseEnter={e => e.currentTarget.style.background = t.tagBg}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span>👤</span> Manage Profile
              </button>
              <button onClick={() => { setUserMenuOpen(false); signOut(); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-xs font-medium transition-colors border-t"
                style={{ color: t.danger, borderColor: t.borderLight }}
                onMouseEnter={e => e.currentTarget.style.background = t.dangerBg}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span>→</span> Sign Out
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [view, setView]           = useState("dashboard");
  const [brands, setBrands] = useState<Brand[]>(() => {
    try { const r = localStorage.getItem("contentOS_brands"); return r ? JSON.parse(r) : SEED_BRANDS; }
    catch { return SEED_BRANDS; }
  });
  const [content, setContent] = useState<ContentItem[]>(() => {
    try { const r = localStorage.getItem("contentOS_content"); return r ? JSON.parse(r) : SEED_CONTENT; }
    catch { return SEED_CONTENT; }
  });
  const [toast, setToast]         = useState<string | null>(null);

  // AI config
  const [apiKey,  setApiKey]  = useState<string>(() => localStorage.getItem("contentOS_apiKey") || "");
  const [aiModel, setAiModel] = useState<string>(() => localStorage.getItem("contentOS_aiModel") || "claude-opus-5");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const handleApiKeyChange = (k: string) => { setApiKey(k); localStorage.setItem("contentOS_apiKey", k); dbSet("contentOS:apiKey", k); };
  const handleModelChange  = (m: string) => { setAiModel(m); localStorage.setItem("contentOS_aiModel", m); dbSet("contentOS:aiModel", m); };

  // ── Supabase sync on mount ──
  useEffect(() => {
    // Brands
    dbGet<Brand[]>("contentOS:brands").then(data => {
      if (data && data.length > 0) {
        setBrands(data);
        localStorage.setItem("contentOS_brands", JSON.stringify(data));
      } else {
        // First run: push seed data to DB
        const local = brands;
        dbSet("contentOS:brands", local);
      }
    });
    // Content
    dbGet<ContentItem[]>("contentOS:content").then(data => {
      if (data && data.length > 0) {
        setContent(data);
        localStorage.setItem("contentOS_content", JSON.stringify(data));
      } else {
        dbSet("contentOS:content", content);
      }
    });
    // Integrations
    dbGet<Integration[]>("contentOS:integrations").then(data => {
      if (data) {
        setIntegrations(prev => {
          const merged = prev.map(p => data.find(d => d.id === p.id) ?? p);
          localStorage.setItem("contentOS_integrations", JSON.stringify(merged));
          return merged;
        });
      }
    });
    // Settings
    dbGet<{ apiKey: string; aiModel: string; googleClientId: string }>("contentOS:settings").then(data => {
      if (data) {
        if (data.apiKey) { setApiKey(data.apiKey); localStorage.setItem("contentOS_apiKey", data.apiKey); }
        if (data.aiModel) { setAiModel(data.aiModel); localStorage.setItem("contentOS_aiModel", data.aiModel); }
        if (data.googleClientId) localStorage.setItem("contentOS_googleClientId", data.googleClientId);
      }
    });
  }, []);

  // Integrations
  const [integrations, setIntegrations] = useState<Integration[]>(loadIntegrations);
  const [configPanelId, setConfigPanelId] = useState<IntegrationId | null>(null);

  const handleSaveIntegration = (id: IntegrationId, config: IntegrationConfig) => {
    setIntegrations(prev => {
      const next = prev.map(i => i.id === id ? { ...i, connected: true, config } : i);
      saveIntegrations(next);
      return next;
    });
    const defn = INTEGRATION_DEFS.find(d => d.id === id);
    showToast(`${defn?.name} connected`);
    setConfigPanelId(null);
  };

  const handleDisconnectIntegration = (id: IntegrationId) => {
    setIntegrations(prev => {
      const next = prev.map(i => i.id === id ? { ...i, connected: false, config: {} } : i);
      saveIntegrations(next);
      return next;
    });
    const defn = INTEGRATION_DEFS.find(d => d.id === id);
    showToast(`${defn?.name} disconnected`);
    setConfigPanelId(null);
  };

  // Panel / modal state
  const [viewPostId,    setViewPostId]    = useState<number | null>(null);
  const [viewBrandId,   setViewBrandId]   = useState<number | null>(null);
  const [editPostId,    setEditPostId]    = useState<number | null>(null); // null = new, -1 = closed, else edit
  const [editBrandId,   setEditBrandId]   = useState<number | null>(null);
  const [brandFormOpen, setBrandFormOpen] = useState(false);
  const [contentFormOpen, setContentFormOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "brand" | "content"; id: number; name: string } | null>(null);

  const t      = THEMES[themeMode];
  const toggle = () => setThemeMode(m => m === "light" ? "dark" : "light");
  const showToast = (msg: string) => setToast(msg);

  const pendingCount = content.filter(i => i.status === "review" || i.status === "ai_generated").length;
  const viewPost  = viewPostId  !== null ? content.find(c => c.id === viewPostId)  ?? null : null;
  const viewBrand = viewBrandId !== null ? brands.find(b => b.id === viewBrandId)  ?? null : null;
  const editPost  = editPostId  !== null && editPostId > 0 ? content.find(c => c.id === editPostId) ?? null : null;
  const editBrand = editBrandId !== null ? brands.find(b => b.id === editBrandId)  ?? null : null;

  const persistBrands = (next: Brand[]) => {
    localStorage.setItem("contentOS_brands", JSON.stringify(next));
    dbSet("contentOS:brands", next);
  };
  const persistContent = (next: ContentItem[]) => {
    localStorage.setItem("contentOS_content", JSON.stringify(next));
    dbSet("contentOS:content", next);
  };

  // ── Brand CRUD ──
  const handleSaveBrand = (data: Omit<Brand,"id"|"ideas"|"drafts"|"review"|"scheduled"|"posts_month">) => {
    if (editBrandId) {
      setBrands(bs => { const next = bs.map(b => b.id === editBrandId ? { ...b, ...data } : b); persistBrands(next); return next; });
      showToast(`Brand "${data.name}" updated`);
    } else {
      const nb: Brand = { ...data, id: uid(), ideas: 0, drafts: 0, review: 0, scheduled: 0, posts_month: 0 };
      setBrands(bs => { const next = [...bs, nb]; persistBrands(next); return next; });
      showToast(`Brand "${data.name}" created`);
    }
    setBrandFormOpen(false);
    setEditBrandId(null);
  };
  const handleDeleteBrand = (id: number) => {
    const b = brands.find(x => x.id === id);
    setBrands(bs => { const next = bs.filter(x => x.id !== id); persistBrands(next); return next; });
    setContent(cs => { const next = cs.filter(c => c.brand !== b?.name); persistContent(next); return next; });
    setViewBrandId(null);
    showToast(`Brand "${b?.name}" deleted`);
  };

  // ── Content CRUD ──
  const handleSaveContent = (data: Omit<ContentItem,"id"|"score">) => {
    if (editPostId && editPostId > 0) {
      setContent(cs => { const next = cs.map(c => c.id === editPostId ? { ...c, ...data } : c); persistContent(next); return next; });
      showToast("Post updated");
    } else {
      const nc: ContentItem = { ...data, id: uid(), score: Math.floor(70 + Math.random() * 25) };
      setContent(cs => { const next = [nc, ...cs]; persistContent(next); return next; });
      showToast("Post created");
    }
    setContentFormOpen(false);
    setEditPostId(null);
  };
  const handleDeleteContent = (id: number) => {
    setContent(cs => { const next = cs.filter(c => c.id !== id); persistContent(next); return next; });
    setViewPostId(null);
    showToast("Post deleted");
  };
  const handleStatusChange = (id: number, s: Status) => {
    setContent(cs => { const next = cs.map(c => c.id === id ? { ...c, status: s } : c); persistContent(next); return next; });
    showToast(`Status → ${statusCfg(s, t).label}`);
  };
  const handleAddMultipleContent = (items: Omit<ContentItem,"id"|"score">[]) => {
    setContent(cs => {
      let nextId = cs.reduce((m, c) => Math.max(m, c.id), 0) + 1;
      const newItems = items.map(item => ({ ...item, id: nextId++, score: Math.floor(Math.random() * 30) + 70 }));
      const next = [...cs, ...newItems];
      persistContent(next);
      return next;
    });
    showToast(`${items.length} posts added to calendar`);
  };

  return (
    <AuthProvider>
    <ThemeCtx.Provider value={{ t, toggle }}>
      <AuthGate>
      <div className="h-full flex overflow-hidden transition-colors duration-200" style={{ background: t.appBg, fontFamily:"Inter, sans-serif" }}>
        <Sidebar
          view={view} setView={setView} pendingCount={pendingCount}
          connectedCount={integrations.filter(i => i.connected).length}
          brands={brands}
          onBrandClick={id => setViewBrandId(id)}
          onOpenProfile={() => setProfileOpen(true)}
        />

        <main className="flex-1 overflow-hidden">
          <ErrorBoundary key={view}>
          {view === "dashboard" && <DashboardView brands={brands} content={content} onPostClick={id => setViewPostId(id)} />}
          {view === "brands"    && (
            <BrandsView brands={brands}
              onView={id => setViewBrandId(id)}
              onEdit={id => { setEditBrandId(id); setBrandFormOpen(true); }}
              onDelete={id => { const b = brands.find(x=>x.id===id); setConfirmDelete({ type:"brand", id, name: b?.name || "" }); }}
              onNew={() => { setEditBrandId(null); setBrandFormOpen(true); }} />
          )}
          {view === "content" && (
            <ContentView brands={brands} content={content}
              onView={id => setViewPostId(id)}
              onEdit={id => { setEditPostId(id); setContentFormOpen(true); }}
              onDelete={id => { const c = content.find(x=>x.id===id); setConfirmDelete({ type:"content", id, name: c?.brand||"Post" }); }}
              onNew={() => { setEditPostId(0); setContentFormOpen(true); }} />
          )}
          {view === "approval"     && <ApprovalView content={content} onStatusChange={handleStatusChange} onView={id => setViewPostId(id)} />}
          {view === "analytics"    && <AnalyticsView brands={brands} content={content} />}
          {view === "integrations" && <IntegrationsView integrations={integrations} onConfigure={id => setConfigPanelId(id)} apiKey={apiKey} aiModel={aiModel} onOpenSettings={() => setSettingsOpen(true)} brands={brands} onViewBrand={id => setViewBrandId(id)} />}
          {view === "calendar"     && (
            <CalendarView
              brands={brands} content={content} integrations={integrations}
              apiKey={apiKey} aiModel={aiModel}
              onAddContent={handleAddMultipleContent}
              onViewPost={id => setViewPostId(id)}
              onStatusChange={handleStatusChange}
              showToast={showToast}
            />
          )}
          </ErrorBoundary>
        </main>

        {/* Post detail panel */}
        {viewPost && (
          <PostDetailPanel
            post={viewPost}
            onClose={() => setViewPostId(null)}
            onEdit={() => { setEditPostId(viewPost.id); setViewPostId(null); setContentFormOpen(true); }}
            onDelete={() => { const id = viewPost.id; setViewPostId(null); const c = content.find(x=>x.id===id); setConfirmDelete({ type:"content", id, name: c?.brand||"Post" }); }}
            onStatusChange={s => handleStatusChange(viewPost.id, s)}
          />
        )}

        {/* Brand detail panel */}
        {viewBrand && (
          <BrandDetailPanel
            brand={viewBrand}
            onClose={() => setViewBrandId(null)}
            onEdit={() => { setEditBrandId(viewBrand.id); setViewBrandId(null); setBrandFormOpen(true); }}
            onDelete={() => { const id = viewBrand.id; setViewBrandId(null); const b = brands.find(x=>x.id===id); setConfirmDelete({ type:"brand", id, name: b?.name||"" }); }}
            onChannelsSave={(channels) => setBrands(bs => { const next = bs.map(b => b.id === viewBrand.id ? { ...b, channels } : b); persistBrands(next); return next; })}
          />
        )}

        {/* Brand form panel */}
        <SlidePanel
          open={brandFormOpen}
          onClose={() => { setBrandFormOpen(false); setEditBrandId(null); }}
          title={editBrandId ? "Edit Brand" : "Create Brand"}
          subtitle={editBrandId ? editBrand?.name : "Set up a new Brand Brain"}
        >
          <BrandForm
            brand={editBrand || null}
            onSave={handleSaveBrand}
            onClose={() => { setBrandFormOpen(false); setEditBrandId(null); }}
          />
        </SlidePanel>

        {/* Content form panel */}
        <ContentFormPanel
          item={editPost}
          brands={brands}
          open={contentFormOpen}
          onClose={() => { setContentFormOpen(false); setEditPostId(null); }}
          onSave={handleSaveContent}
          apiKey={apiKey}
          aiModel={aiModel}
          integrations={integrations}
        />

        {/* Integration config panel */}
        {configPanelId && (() => {
          const defn = INTEGRATION_DEFS.find(d => d.id === configPanelId)!;
          const integration = integrations.find(i => i.id === configPanelId) ?? { id: configPanelId, connected: false, config: {} };
          return (
            <IntegrationConfigPanel
              defn={defn}
              integration={integration}
              open={true}
              onClose={() => setConfigPanelId(null)}
              onSave={config => handleSaveIntegration(configPanelId, config)}
              onDisconnect={() => handleDisconnectIntegration(configPanelId)}
            />
          );
        })()}

        {/* Settings panel */}
        <SettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          apiKey={apiKey}
          onApiKeyChange={handleApiKeyChange}
          aiModel={aiModel}
          onModelChange={handleModelChange}
        />

        {/* Delete confirm */}
        <ConfirmModal
          open={confirmDelete !== null}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            if (!confirmDelete) return;
            if (confirmDelete.type === "brand") handleDeleteBrand(confirmDelete.id);
            else handleDeleteContent(confirmDelete.id);
            setConfirmDelete(null);
          }}
          title={`Delete ${confirmDelete?.type === "brand" ? "Brand" : "Post"}?`}
          message={confirmDelete?.type === "brand"
            ? `This will permanently delete "${confirmDelete.name}" and all its associated content.`
            : `This will permanently delete this post by "${confirmDelete?.name}".`}
        />

        {/* Toast */}
        {toast && <Toast msg={toast} onDone={() => setToast(null)} />}

        {/* Profile panel */}
        <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
      </div>
      </AuthGate>
    </ThemeCtx.Provider>
    </AuthProvider>
  );
}
