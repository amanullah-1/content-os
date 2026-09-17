export type Status = "ai_generated" | "draft" | "review" | "approved" | "scheduled" | "published";
export type ThemeMode = "light" | "dark";

export interface Pillar { name: string; weight: number }
export interface GuideStep { step: string; detail?: string; url?: string; urlLabel?: string }
export type PlatformId = "woocommerce"|"facebook"|"instagram"|"x"|"linkedin"|"tiktok"|"youtube"|"pinterest"|"devto";
export interface PlatformDef {
  id: PlatformId; name: string; icon: string; color: string; bg: string;
  desc: string;
  fields: { key: string; label: string; placeholder: string; secret?: boolean; hint?: string }[];
  guide: { title: string; steps: GuideStep[] };
}

export interface BrandChannel {
  platformId: string;
  connected: boolean;
  config: Record<string, string>;
}

export interface Brand {
  id: number; name: string; industry: string; color: string;
  tagline: string; tone: string[]; audience: string;
  pillars: Pillar[]; platforms: string[];
  channels: BrandChannel[];
  ideas: number; drafts: number; review: number; scheduled: number; posts_month: number;
}

export interface ContentItem {
  id: number; brand: string; brandColor: string; campaign: string;
  pillar: string; platform: string; status: Status;
  caption: string; hashtags: string; scheduled: string; format: string; score: number;
  imagePrompt?: string;
  videoScript?: string;
  scheduledISO?: string;
  generatedImageUrl?: string;
  generatedVideoUrl?: string;
}

export interface AuthUser {
  id: string; email: string; name: string;
  avatarColor: string; role: string; createdAt: string;
}

export interface AuthCtxValue {
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (name: string, email: string, password: string) => Promise<string | null>;
  signInWithGoogle: (credential: string) => Promise<string | null>;
  signOut: () => void;
  updateProfile: (patch: Partial<Pick<AuthUser, "name" | "avatarColor" | "role">>) => void;
  changePassword: (current: string, next: string) => Promise<string | null>;
}

export interface StoredUser extends AuthUser { pwHash: string }

export type IntegrationId = "falai" | "replicate" | "pollinations" | "huggingface" | "stablehorde" | "groq";

export interface IntegrationConfig { [key: string]: string }

export interface Integration {
  id: IntegrationId;
  connected: boolean;
  config: IntegrationConfig;
}

export type ScheduleProviderId = "claude" | "groq" | "pollinations" | "huggingface";

export interface ProviderCreds {
  claudeKey: string;
  groqKey: string;
  pollinationsKey: string;
  hfToken: string;
}

export type PolicyLevel = "auto" | "review" | "human";
