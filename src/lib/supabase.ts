import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Storage flips to Supabase automatically when these are set; otherwise the app
// falls back to the local JSON store. Server-only — never expose the service
// role key to the client (no NEXT_PUBLIC_ prefix).
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return client;
}
