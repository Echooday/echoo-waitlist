import { createClient } from "@supabase/supabase-js";

function normalizeProjectUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  // Common mis-paste: API base URL instead of project URL (breaks all requests).
  u = u.replace(/\/rest\/v1\/?$/i, "");
  try {
    new URL(u);
  } catch {
    throw new Error(
      "Invalid VITE_SUPABASE_URL. Use https://<project-ref>.supabase.co without a /rest/v1 suffix.",
    );
  }
  return u;
}

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";

if (!rawUrl || !anonKey) {
  throw new Error(
    "Missing Supabase env vars. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
}

const supabaseUrl = normalizeProjectUrl(rawUrl);

/** Project root URL (for Edge Functions fetch, logging). Same base passed to createClient. */
export const supabaseProjectUrl = supabaseUrl;

export const supabaseAnonKey = anonKey;

export const supabase = createClient(supabaseUrl, anonKey);
