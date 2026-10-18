import type { Backend } from "./types";
import { LocalBackend } from "./localBackend";
import { SupabaseBackend } from "./supabaseBackend";

/**
 * Backend selection.
 *
 * If Supabase is configured (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY) the
 * application talks to Supabase. Otherwise it runs the fully-functional local
 * backend so the game is playable immediately with no external services — see
 * README "Development mode".
 */
export function createBackend(): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (url && key) {
    try {
      return new SupabaseBackend(url, key);
    } catch {
      // Fall through to local if the client cannot initialise.
    }
  }
  return new LocalBackend();
}

export type { Backend } from "./types";
export * from "./types";
