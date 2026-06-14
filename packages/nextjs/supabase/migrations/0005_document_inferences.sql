-- Kredito — per-document Confidential AI inference log.
-- PRIVACY: only the prompt, system prompt, model output (a JSON summary) and the
-- Chainlink request id are stored. RAW DOCUMENT BYTES NEVER TOUCH THE DATABASE.
-- One row per analyzed document, written best-effort by the /finish handler.
--
-- Apply: paste into the Supabase SQL editor, or `supabase db push` if the CLI is linked.

create table if not exists public.document_inferences (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  borrower      text,                       -- connected wallet (credit identity)
  inference_id  text,                       -- Chainlink Confidential AI request id (per document)
  filename      text,
  document_type text,
  status        text,                       -- terminal inference status (completed | failed)
  section_score integer,                    -- 0..1000, how well THIS document supports the loan
  prompt        text,                       -- the section prompt that was sent
  system_prompt text,                       -- the section system prompt that was sent
  output        text                        -- the model's JSON output (a summary; no raw doc bytes)
);

create index if not exists document_inferences_borrower_created_at_idx
  on public.document_inferences (borrower, created_at desc);

-- RLS enabled, no public policies: anon/auth roles cannot read or write. Writes are
-- done server-side with the service-role key (bypasses RLS). Privacy by default.
alter table public.document_inferences enable row level security;
