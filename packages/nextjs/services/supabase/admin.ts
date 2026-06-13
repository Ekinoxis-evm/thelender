import { createClient } from "@supabase/supabase-js";
import "server-only";

/**
 * SERVER-ONLY Supabase admin client. Uses the service-role key and **bypasses RLS**.
 * Never import this into a Client Component. Use only in Route Handlers / Server
 * Actions for privileged writes (e.g. caching onchain state keyed by wallet).
 */
export const createAdminClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
