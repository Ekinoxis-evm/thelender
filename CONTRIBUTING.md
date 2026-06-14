# Contributing to Kredito

Welcome. Kredito is a sponsored, gasless, credit-gated **undercollateralized** USDC lending app on Ethereum (Sepolia), built on Scaffold-ETH 2 with an AI provider lab for Claude Code. The core flow is **credit → identity → loan**: a business is scored privately by a Chainlink Confidential AI Attester (TEE), the score becomes an onchain `<label>.kredito.eth` identity, and that identity unlocks an undercollateralized loan — all gasless. This guide is how the team works — read it once before your first PR.

> First time? Get running with the [README](README.md), then skim [`docs/architecture.md`](docs/architecture.md) and the rules in [`CLAUDE.md`](CLAUDE.md).

## 1 · Setup
```bash
git clone https://github.com/Ekinoxis-evm/thelender && cd thelender
git submodule update --init --recursive   # Foundry libs
yarn install
cp packages/nextjs/.env.example packages/nextjs/.env.local   # fill keys (ask a maintainer)
cp packages/foundry/.env.example packages/foundry/.env
```
Run: `yarn start`. The ENS contracts (`KreditoController`, `KreditoResolver`, subRegistry) are already live on Sepolia and wired via `NEXT_PUBLIC_KREDITO_CONTROLLER` / `NEXT_PUBLIC_KREDITO_RESOLVER`; `KreditoVault` is built and tested but not yet deployed. Full detail in the README.

## 2 · Branches & commits
- **Branch off `main`**: `feat/<short-desc>`, `fix/<short-desc>`, `chore/…`, `docs/…`, `refactor/…`. Never commit to `main` directly.
- **Commit messages** use a type prefix (matches our history): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `db:` (Supabase/migrations). Imperative, concise. One logical change per commit.
- Keep PRs focused and small where possible.

## 3 · The workflow (use the AI lab)
This repo is wired for Claude Code. Lean on it:
| Task | Use |
|------|-----|
| Contracts (vault / controller / resolver) | `solidity-engineer` agent (invokes `ethskills:ship` first) |
| Frontend / wallet UX / the 5-step flow | `web3-frontend` agent + `/setup-privy`, `/integrate-ens` |
| Scoring / attestation / Supabase / Chainlink | `integrations-engineer` agent + `supabase` + `confidential-ai-attester` skills |
| Verify a contract | `/verify-contract` |
| Inspect a tx/address | `blockscout` MCP |
| Review before merge | `onchain-security-reviewer` / `grumpy-carlos-code-reviewer` |

Ground library questions with `use context7`. Full inventory: [`docs/tooling-lab.md`](docs/tooling-lab.md).

## 4 · Before you push / open a PR
1. **`/test-ci`** — runs Foundry tests + Next lint/typecheck/build locally (husky also gates commits).
2. For any **onchain change**: **`/ship-check`** (verifies state, decimals, addresses, secrets, tests) and a pass from `onchain-security-reviewer`.
3. Open a PR against `main`, fill the PR template. **CI must be green.**
4. Changes to `packages/foundry/**` or `supabase/migrations/**` require review from a [CODEOWNER](.github/CODEOWNERS).

## 5 · Code rules (non-negotiable — see [`CLAUDE.md`](CLAUDE.md))
- **Sponsored writes**: user writes go through `useSponsoredWrite()`; user signatures (mint message, etc.) through `useSmartWalletSign()` — **never** `useScaffoldWriteContract` (that's the un-sponsored EOA path). Reads pass `{ account: useSmartWalletAddress() }`.
- **Privacy**: raw borrower documents stay inside the Confidential AI TEE — only **scores + hashes** are persisted (Supabase `credit_checks`) or written onchain. Never log or store raw financials.
- **Secrets server-side**: the issuer key (EIP-712 attestation signing), `CHAINLINK_CONFIDENTIAL_AI_API_KEY`, and `ADMIN_SECRET` are server-only — never `NEXT_PUBLIC_`, never sent to the client.
- **Supabase**: RLS ON for every table (`credit_checks`, `ai_config`, `ens_identities`); privileged writes server-side with the service-role key; never expose `service_role` / `PRIVY_APP_SECRET` to the client.
- **Onchain**: "onchain" is one word · 0–2 contracts for an MVP · verify addresses/decimals/gas live · **USDC = 6 decimals** · Chainlink feeds not spot prices · ENS addresses come from env (`NEXT_PUBLIC_KREDITO_*`), other contract addresses from generated artifacts — never hand-copied.
- **Never commit secrets.** `.env.local` / `packages/*/.env` are gitignored — keep it that way.

## 6 · Remotes
- `origin` → `Ekinoxis-evm/thelender` (this app — push here).
- `template` → `Ekinoxis-evm/ai_scafolding_web3_app` (the upstream AI-Native template). To pull template improvements: `git fetch template && git merge template/main` (review carefully).

## 7 · Questions
Open an issue (templates provided) or ask a maintainer. Keep `CLAUDE.md` and the `docs/` current when you change how things work — docs drift is a bug.
