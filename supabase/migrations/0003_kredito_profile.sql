-- thelender / KreditoOne — richer profile fields for the identity card.
-- Each mirrors an ENS text record on the subname's KreditoResolver (owner-editable). No score here.

alter table public.ens_identities add column if not exists description text;   -- bio / background  (ENS "description")
alter table public.ens_identities add column if not exists header_url  text;   -- background banner (ENS "header")
alter table public.ens_identities add column if not exists email       text;   -- contact          (ENS "email")
alter table public.ens_identities add column if not exists location    text;   -- address / location (ENS "location")
alter table public.ens_identities add column if not exists github      text;   -- ENS "com.github"
alter table public.ens_identities add column if not exists telegram    text;   -- ENS "org.telegram"
alter table public.ens_identities add column if not exists discord     text;   -- ENS "com.discord"
alter table public.ens_identities add column if not exists linkedin    text;   -- ENS "com.linkedin"
