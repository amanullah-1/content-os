// ContentOS relational API client (local PHP backend in /api).
// Server is the source of truth when a token exists; without one the app
// falls back to the legacy localStorage + KV behaviour (offline / pre-login).

const API_ROOT = (
  import.meta.env.VITE_KV_BASE_URL || "http://localhost/ContentOS/api"
).replace(/\/$/, "");

const TOKEN_KEY = "contentOS_token";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

export interface ServerUser {
  id: string; email: string; name: string;
  avatarColor: string; role: string; roleSlug: string;
  seesAll: boolean; brandIds: number[]; createdAt: string;
}

export class ApiError extends Error {
  status: number;
  isNetwork: boolean;
  constructor(status: number, message: string, isNetwork = false) {
    super(message);
    this.status = status;
    this.isNetwork = isNetwork;
  }
}

async function apiFetch<T>(path: string, opts: {
  method?: string; body?: unknown; token?: string | null;
} = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}${path}`, {
      method: opts.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? e.message : "Network error", true);
  }
  if (res.status === 401) throw new ApiError(401, "Not authenticated.");
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (json as { message?: string } | null)?.message || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  // Business-logic failure with HTTP 200: { success: false, message }
  if (json && typeof json === "object" && "success" in json && (json as { success: boolean }).success === false) {
    throw new ApiError(200, (json as { message?: string }).message || "Request failed.");
  }
  return json as T;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export interface AuthResult { user: ServerUser; token: string }

export const apiLogin = (email: string, password: string) =>
  apiFetch<AuthResult>(`/auth.php?action=login`, { method: "POST", body: { email, password } });

export const apiSignup = (name: string, email: string, password: string) =>
  apiFetch<AuthResult>(`/auth.php?action=signup`, { method: "POST", body: { name, email, password } });

export const apiGoogle = (credential: string) =>
  apiFetch<AuthResult>(`/auth.php?action=google`, { method: "POST", body: { credential } });

export async function apiLogout(token: string): Promise<void> {
  try { await apiFetch(`/auth.php?action=logout`, { method: "POST", token }); }
  catch { /* logging out locally regardless */ }
}

export const apiMe = (token: string) =>
  apiFetch<{ user: ServerUser }>(`/auth.php?action=me`, { token });

export const apiChangePassword = (token: string, current: string, next: string) =>
  apiFetch<{ success: boolean }>(`/auth.php?action=change-password`, {
    method: "POST", token, body: { current, next },
  });

export const apiUpdateProfile = (token: string, patch: { name?: string; avatarColor?: string; role?: string }) =>
  apiFetch<{ user: ServerUser }>(`/auth.php?action=update-profile`, {
    method: "POST", token, body: patch,
  });

// ── Brands / content (Bearer required; server scopes by membership) ─────────

export interface BrandPayload {
  name: string; industry?: string; color?: string; tagline?: string;
  tone?: string[]; audience?: string;
  pillars?: { name: string; weight: number }[];
  platforms?: string[];
  channels?: { platformId: string; connected: boolean; config: Record<string, string> }[];
}

// Loose structural types — App.tsx owns the canonical Brand/ContentItem types.
export type BrandDTO = Record<string, unknown> & { id: number };
export type ContentDTO = Record<string, unknown> & { id: number };

export const apiListBrands = (token: string) =>
  apiFetch<BrandDTO[]>(`/brands.php`, { token });

export const apiCreateBrand = (token: string, data: BrandPayload) =>
  apiFetch<BrandDTO>(`/brands.php`, { method: "POST", token, body: data });

export const apiUpdateBrand = (token: string, id: number, data: BrandPayload) =>
  apiFetch<BrandDTO>(`/brands.php?id=${id}`, { method: "PUT", token, body: data });

export const apiDeleteBrand = (token: string, id: number) =>
  apiFetch<{ success: boolean }>(`/brands.php?id=${id}`, { method: "DELETE", token });

export const apiListContent = (token: string) =>
  apiFetch<ContentDTO[]>(`/content.php`, { token });

export const apiCreateContent = (token: string, data: Record<string, unknown>) =>
  apiFetch<ContentDTO>(`/content.php`, { method: "POST", token, body: data });

export const apiUpdateContent = (token: string, id: number, data: Record<string, unknown>) =>
  apiFetch<ContentDTO>(`/content.php?id=${id}`, { method: "PUT", token, body: data });

export const apiDeleteContent = (token: string, id: number) =>
  apiFetch<{ success: boolean }>(`/content.php?id=${id}`, { method: "DELETE", token });

// ── Team (super admin only) ─────────────────────────────────────────────────

export interface TeamUser extends ServerUser {
  brands: { brandId: number; brandName: string; memberRole: string }[];
}

export const apiListTeam = (token: string) =>
  apiFetch<TeamUser[]>(`/members.php`, { token });

export const apiListAllBrands = (token: string) =>
  apiFetch<{ id: number; name: string }[]>(`/members.php?action=brands`, { token });

export const apiGrant = (token: string, user_id: string, brand_id: number, member_role = "owner") =>
  apiFetch<{ success: boolean }>(`/members.php?action=grant`, {
    method: "POST", token, body: { user_id, brand_id, member_role },
  });

export const apiRevoke = (token: string, user_id: string, brand_id: number) =>
  apiFetch<{ success: boolean }>(`/members.php?action=revoke`, {
    method: "POST", token, body: { user_id, brand_id },
  });

export const apiSetRole = (token: string, user_id: string, role: string) =>
  apiFetch<{ success: boolean }>(`/members.php?action=set-role`, {
    method: "POST", token, body: { user_id, role },
  });
