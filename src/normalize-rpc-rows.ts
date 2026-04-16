/** Supabase usually returns an array of rows; tolerate a single object. */
export function normalizeRpcRows(data: unknown): Record<string, unknown>[] {
  if (data == null) return [];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === "object") return [data as Record<string, unknown>];
  return [];
}
