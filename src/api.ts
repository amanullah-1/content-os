// ContentOS relational API client (local PHP backend in /api).
// Server is the source of truth when a token exists; without one the app
// falls back to the legacy localStorage + KV behaviour (offline / pre-login).
//
// Phase 1 auth hardening:
//   - Access token is kept in module memory only (not localStorage) so an XSS
//     hole can't exfiltrate it. 30-minute lifetime.
//   - Refresh token lives in an HTTP-only cookie (`contentos_refresh`, 7 days);
//     JS never sees it. `/auth.php?action=refresh` rotates both tokens.
//   - apiFetch transparently refreshes once on a 401 and retries the request.
//   - All exported function signatures are unchanged from the legacy client.

const API_ROOT = (() => {
  const host = typeof window !== "undefined" ? (window.location.hostname || "localhost") : "localhost";
  return (import.meta.env.VITE_API_ROOT || `http://${host}/ContentOS/api`).replace(/\/$/, "");
})();

// ── In-memory access token + refresh plumbing ───────────────────────────────

let accessToken: string | null = null;
let refreshInFlight: Promise<ServerUser | null> | null = null;

/** Access token currently held in memory, or null. */
export function getToken(): string | null {
  return accessToken;
}

/** Store (or clear) the access token. Replaces the old localStorage behavior. */
export function setToken(t: string | null): void {
  accessToken = t;
  tokenListeners.forEach(fn => fn());
}

const tokenListeners = new Set<() => void>();

/** Subscribe to access-token changes (login, logout, silent refresh). Returns an unsubscribe fn. */
export function onTokenChange(fn: () => void): () => void {
  tokenListeners.add(fn);
  return () => { tokenListeners.delete(fn); };
}

/** Ask the server (via the HTTP-only cookie) for a fresh access token. */
export async function apiRefresh(): Promise<AuthResult> {
  return apiFetch<AuthResult>(`/auth.php?action=refresh`, { method: "POST" });
}

/**
 * Restore a session on boot using the refresh cookie. Safe to call once at
 * startup; subsequent calls while a refresh is in flight share that promise.
 * Returns the restored user, or null when there is no valid session.
 */
export async function tryBootstrapAuth(): Promise<ServerUser | null> {
  if (accessToken) {
    try {
      const { user } = await apiMe(accessToken);
      return user;
    } catch { /* fall through to refresh */ }
  }
  if (!refreshInFlight) {
    refreshInFlight = apiRefresh()
      .then(({ token, user }) => { setToken(token); return user; })
      .catch(() => null)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/** Force a refresh cycle now (used by the 401 code path). */
function refreshAccessToken(): Promise<string | null> {
  const inFlight = tryBootstrapAuth();
  return inFlight.then(u => getToken() || (u ? (accessToken ?? null) : null));
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
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? e.message : "Network error", true);
  }

  // On 401, try a single token refresh then retry (avoids an expired access
  // token booting the user out mid-session). Never loops on /refresh itself.
  if (res.status === 401 && !path.includes("action=refresh")) {
    const fresh = await refreshAccessToken();
    if (fresh) return apiFetchAgainAfterRefresh<T>(path, opts, fresh);
    throw new ApiError(401, "Not authenticated.");
  }
  return parseResponse<T>(res, path);
}

async function apiFetchAgainAfterRefresh<T>(path: string, opts: {
  method?: string; body?: unknown; token?: string | null;
}, freshToken: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}${path}`, {
      method: opts.method || "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${freshToken}`,
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? e.message : "Network error", true);
  }
  return parseResponse<T>(res, path);
}

async function parseResponse<T>(res: Response, _path: string): Promise<T> {
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

/** Revoke every session for the current user (security self-service). */
export async function apiRevokeAllSessions(token: string): Promise<void> {
  try { await apiFetch(`/auth.php?action=revoke-all`, { method: "POST", token }); }
  catch { /* clear locally regardless */ }
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

// ── Content templates ───────────────────────────────────────────────────────

export type TemplateDTO = Record<string, unknown> & { id: number };

export const apiListTemplates = (token: string, params: { brandId?: number; category?: string } = {}) => {
  const q = new URLSearchParams();
  if (params.brandId) q.set("brand_id", String(params.brandId));
  if (params.category) q.set("category", params.category);
  const qs = q.toString();
  return apiFetch<TemplateDTO[]>(`/templates.php${qs ? `?${qs}` : ""}`, { token });
};

export const apiCreateTemplate = (token: string, data: Record<string, unknown>) =>
  apiFetch<TemplateDTO>(`/templates.php`, { method: "POST", token, body: data });

export const apiUpdateTemplate = (token: string, id: number, data: Record<string, unknown>) =>
  apiFetch<TemplateDTO>(`/templates.php?id=${id}`, { method: "PUT", token, body: data });

export const apiDeleteTemplate = (token: string, id: number) =>
  apiFetch<{ success: boolean }>(`/templates.php?id=${id}`, { method: "DELETE", token });

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