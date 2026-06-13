# Off-chain Infra: Supabase + Railway + Vercel

## Supabase (DB / auth / realtime)
- Skill: `supabase` · MCP: `supabase` (read-only, needs `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`).
- **RLS ON for every table**, always, with explicit policies. No exceptions.
- Migrations as SQL under `supabase/migrations/` — version-controlled, not dashboard edits.
- Keys: anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) on client + RLS; `SUPABASE_SERVICE_ROLE_KEY` **server only**.
- Good for: app state, user profiles, indexed onchain events, realtime feeds, Edge Functions for webhooks.

## Railway (long-running services)
- MCP: `railway` (needs `RAILWAY_API_TOKEN`).
- Use for what serverless can't do: chain indexers, websocket listeners, cron workers, persistent processes.
- Env + config in Railway dashboard/CLI — never committed.
- Indexers must be idempotent and reorg-safe.

## Vercel (frontend + serverless)
- Next.js App Router. Fluid Compute (Node 24), default 300s function timeout.
- Prefer `vercel.ts` over `vercel.json`. `vercel env pull` to sync env locally.
- Middleware supports full Node.js. Don't reach for Edge runtime unless needed.

## Division of labor
Onchain = ownership/transfers/commitments only. Everything else (queries, search, user data, caching, indexing) → Supabase/Railway. Keep contracts at 0–2 for the MVP.
