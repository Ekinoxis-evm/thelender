-- Kredito — align ens_identities with lib/kredito PROFILE_FIELDS. 0003 created only the basic profile
-- columns; the editor/mint write the full set. Add the missing ones (idempotent).
alter table public.ens_identities add column if not exists description text;
alter table public.ens_identities add column if not exists header_url  text;
alter table public.ens_identities add column if not exists email       text;
alter table public.ens_identities add column if not exists location    text;
alter table public.ens_identities add column if not exists github      text;
alter table public.ens_identities add column if not exists telegram    text;
alter table public.ens_identities add column if not exists discord     text;
alter table public.ens_identities add column if not exists linkedin    text;
