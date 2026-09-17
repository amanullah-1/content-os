/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KV_BASE_URL: string;
  readonly VITE_PUBLISH_PROXY_URL: string;
  readonly VITE_SUPABASE_BASE_URL: string;
  readonly VITE_SUPABASE_PROXY_URL: string;
  readonly VITE_MASTER_EMAIL: string;
  readonly VITE_MASTER_PASSWORD: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
