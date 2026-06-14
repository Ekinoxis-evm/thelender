<!-- Thanks for contributing to Kredito. Keep PRs focused. -->

## What & why
<!-- What does this change and why? Link any issue: Closes #__ -->

## Type
- [ ] feat  - [ ] fix  - [ ] docs  - [ ] chore  - [ ] refactor  - [ ] test  - [ ] db (migration)

## Checklist
- [ ] `/test-ci` passes locally (Foundry tests + Next lint/typecheck/build)
- [ ] Onchain changes: ran `/ship-check` + `onchain-security-reviewer` (skip if none)
- [ ] User writes go through `useSponsoredWrite` and message signing through `useSmartWalletSign` (not `useScaffoldWriteContract` / raw EOA); reads pass `{ account: smartWalletAddress }` (skip if N/A)
- [ ] Supabase changes keep **RLS on**; no `service_role` / secrets exposed to the client
- [ ] No secrets committed; new env vars added to the relevant `.env.example`
- [ ] Updated `CLAUDE.md` / `docs/` if behavior or architecture changed

## Notes for reviewers
<!-- Anything tricky, screenshots, or testing steps -->
