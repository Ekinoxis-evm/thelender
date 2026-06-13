import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client (use in Client Components).
 * Uses the public anon key + RLS. Never import the service-role key here.
 *
 * Note: this app authenticates users with Privy, not Supabase Auth. For
 * row-level authorization tied to a user, bridge Privy → Supabase (verify the
 * Privy JWT in a server route / Edge Function, or mint a Supabase session).
 * Until then, treat the anon client as read-only-public and do privileged
 * writes server-side with the service-role key. See docs/infra.md.
 */
export const createClient = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
