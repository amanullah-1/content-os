const BASE = import.meta.env.VITE_SUPABASE_BASE_URL || "https://rssvhitxlyfpysxqkwff.supabase.co/functions/v1/make-server-76b9a4db";

export async function dbGet<T>(key: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}/kv/${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return (json.value ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function dbSet(key: string, value: unknown): Promise<void> {
  try {
    await fetch(`${BASE}/kv/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
  } catch {
    // silent — localStorage remains the sync cache
  }
}

export async function dbDel(key: string): Promise<void> {
  try {
    await fetch(`${BASE}/kv/${encodeURIComponent(key)}`, { method: "DELETE" });
  } catch { /* silent */ }
}
