# Kredito — project memory

@AGENTS.md

**Kredito** is a sponsored, gasless, **credit-gated undercollateralized USDC lending** app on Ethereum (Sepolia). A business proves creditworthiness through private document analysis (**Chainlink Confidential AI Attester**, run in a TEE), receives an **issuer-signed EIP-712 credit attestation**, mints an **ENS credit identity** — `<label>.kredito.eth`, an ENSv2 subname that is the onchain certificate — and then borrows undercollateralized USDC from a vault gated by that attestation. Liquidity providers supply USDC (ERC-4626 shares with ERC-7540 async redeem). This file is the shared project memory for Claude Code — keep it current. New collaborators: also read `CONTRIBUTING.md`, `docs/architecture.md`, and `docs/deployments.md`.

## Product — the credit→identity→loan flow

The whole app is one page: `packages/nextjs/components/kredito/KreditoFlow.tsx` — Onboarding → Score → Certificate → Profile → Borrow → Liquidity.

1. **Onboarding** — exactly 5 business-identity fields: legal name (text), country (ISO dropdown), type of enterprise (LLC / Corporation / Sole Proprietorship / Partnership / Nonprofit / Cooperative / Other), tax number, registry number — persisted to `credit_checks` (`legal_name`, `country`, `enterprise_type`, `tax_number`, `registry_number`). No loan-amount, industry, monthly-revenue, or ENS-name field. Plus evidence documents.
2. **Score** — `POST /api/lendsignal/score`. The score is **100% the Chainlink Confidential AI Attester** over the borrower's uploaded documents, analyzed in a TEE (raw docs never leave the enclave or touch the DB). The pipeline is **map** (one inference per document, section prompts) → **reduce** (final decision); the combined score (0–1000) **equals** the AI score. There is **no** credit-bureau blend, no off-chain profile signal, and no synthetic/mock fallback. If `CHAINLINK_CONFIDENTIAL_AI_API_KEY` is missing or any inference fails / returns unparseable output, the route returns a **clear error** (never a fake score). Persisted to Supabase `credit_checks` (results + content hashes only). Eligibility: tiers `>=750` low · `600–749` medium · `<600` high; `eligible = score >= 600 AND tier != high` — recomputed from the stored score + tier against `MIN_ELIGIBLE_SCORE` (600), not a persisted flag.
3. **Certificate** — `POST /api/lendsignal/attest` (the issuer signs an EIP-712 `CreditAttestation` server-side; its `maxPrincipal` credit limit is **derived from the score** via `creditLimitUsd`, not user-entered), then the user mints `<label>.kredito.eth`: sign `mintMessage` (proves wallet control) → `POST /api/identity/mint` → `KreditoController.mint(label, wallet, attestationHash)`. The issuer submits the mint (holds `ISSUER_ROLE`); Privy sponsors the gas. Issuer-locked `kredito.status="approved"` + attestation hash are written; the user owns the name and its editable profile records, but cannot forge status.
4. **Profile** — customize the public ENS credit identity (display name, about, avatar, banner, website, email, location, X / GitHub / Telegram / Discord / LinkedIn). Records are written onchain via `KreditoResolver.setTexts` (gas-sponsored) and mirrored to Supabase `ens_identities`; a live preview card renders as you type. Public verification at `/identity/<label>` and a `/verify` lookup page.
5. **Borrow** — `KreditoVault.borrow(attestation, signature, amount)`: the vault verifies the EIP-712 signature onchain (recovers signer == issuer), enforces score ≥ minScore, not-expired, `amount ≤ maxPrincipal`. *(Coming soon — vault not yet deployed. The vault's hardcoded `minScore` is higher than the ≥600 off-chain mint threshold, so the two gates may differ.)*
6. **Liquidity** — ERC-4626 `deposit` + ERC-7540 async redeem (`requestRedeem` → `fulfillRedeem` → `redeem`). *(Coming soon with the vault.)*

**Why ENSv2 subnames are the certificate:** an ENSv2 name is natively an ERC-1155 token, so the subname *is* the credential — no separate soulbound NFT. The score stays private (Supabase, RLS); only the approved/denied status + attestation hash go onchain. See `docs/ens.md` and [[ens-kreditoone-ensv2]].
**Base framework: Scaffold-ETH 2** (yarn-4 monorepo). SE-2's own agent guidance lives in `AGENTS.md` (imported above) — read it for the contract↔frontend hot-reload model, `scaffold.config.ts`, the typed `useScaffold*` hooks, and `yarn` workflows. This file adds our provider lab (Privy, Chainlink, ENS, Supabase, Graph, Blockscout) and onchain rules on top.

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Base scaffold | **Scaffold-ETH 2** | Yarn-4 monorepo: `packages/nextjs` + `packages/foundry`. Hot-reload contracts→frontend, burner wallet, local chain, faucet. |
| App | Next.js (App Router) + TS | `packages/nextjs`. Deploy on Vercel. |
| Auth + wallets | **Privy** (default) | `@privy-io/react-auth` + `@privy-io/wagmi`: login is **email + Google only** (no external wallet connectors — one consistent gasless UX), embedded wallet on login, **ERC-4337 smart wallets with gas sponsorship** (Privy-managed paymaster, "App pays" gas credits set in the Dashboard). RainbowKit + burner-connector fully removed. Needs `NEXT_PUBLIC_PRIVY_APP_ID` at runtime + dashboard smart-wallets/gas-credits/allowed-origins — see `docs/privy.md`. |
| Chain I/O | **viem** + **wagmi** | SE-2's typed `useScaffoldReadContract` / `useScaffoldWriteContract` hooks wrap wagmi — prefer them. |
| ENS | viem ENS actions | Resolution always reads **Ethereum Mainnet**, even if the app runs on an L2. |
| Oracles / onchain data | **Chainlink** | Data Feeds, VRF, CCIP, Data Streams, Functions. |
| Database / backend | **Supabase** | Postgres + Auth + Realtime + Edge Functions. RLS on by default. |
| Long-running services | **Railway** | Indexers, workers, cron — anything that can't be a serverless function. |
| Contracts | **Foundry** | `forge`/`cast`/`anvil` (v1.7.1). In `packages/foundry/` (`contracts/`, `script/`, `test/`). Etherscan V2 verify pre-configured. |
| Indexing | **The Graph** | Token API for balances/prices; subgraphs for custom events. Via MCP. SE-2 `subgraph`/`ponder` skills available. |
| Explorer | **Blockscout** | Multichain reads/debugging via MCP. Verify contracts on Etherscan (V2, one key). |

Working chain: **Ethereum Sepolia (11155111)** — set in `packages/nextjs/scaffold.config.ts` (`targetNetworks: [chains.sepolia]`). Everything (Privy smart-wallet sponsorship, Foundry deploy/verify, RPC) aligns to Sepolia. Mainnet is auto-added for ENS resolution only.

## Onchain deployment (Sepolia, live — see `docs/deployments.md`)

| Contract | Address | Role |
|----------|---------|------|
| **KreditoController** | `0xE498cbC0F0ED0b9059FEc2a7F1275834108915B0` | Issuance authority. `ISSUER_ROLE` mints `<label>.kredito.eth`; holds `ROLE_REGISTRAR` on the child registry. |
| **KreditoResolver** | `0xE68F49F6256a2aF1702855dc62B82afF6Fd65F0E` | Split-ACL ENSIP-10 resolver: issuer-locked `kredito.status`/`lendsignal.attestation`, owner-editable profile records. |
| subRegistry (ENSv2 UserRegistry proxy) | `0x2167d6DF85bC76f22b7f150220740444DC257AAf` | `kredito.eth`'s child registry; attached via `setSubregistry`. |
| **KreditoVault** | *not yet deployed* | EIP-712 attestation-gated ERC-4626 + ERC-7540 lender (`lendsignal/KreditoVault.sol`, 87 tests). Borrow/Liquidity steps wire to it. |

**Parent name:** `kredito.eth` is registered on **ENSv2 / Namechain on Sepolia** (`.eth` PermissionedRegistry `0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67`).

**Issuer key — one address does everything (demo posture):** `0x4B24116Df4C31c40aB5B3cb3bA3Ffe743A346978` is simultaneously the Foundry **deployer**, the controller's **`ISSUER_ROLE`**, the future vault **`issuer`**, the app's **`ISSUER_PRIVATE_KEY`** (signs the EIP-712 attestation + submits mints), and the **`kredito.eth` owner** (signed `setSubregistry`). For production, split a cold owner/admin from a hot issuer (the contracts already support `DEFAULT_ADMIN_ROLE` ≠ `ISSUER_ROLE`). Imported as foundry keystore `kredito-issuer`. **Deploy/verify with `forge script script/SetupKreditoEns.s.sol --rpc-url sepolia --account kredito-issuer …` — never hardcode these addresses; they're wired into the app via `NEXT_PUBLIC_KREDITO_CONTROLLER`/`NEXT_PUBLIC_KREDITO_RESOLVER` env (the ENS contracts are intentionally NOT in `deployedContracts.ts`).**

**Supabase (project ref `rooclfwqvmwehaqmtflp`):** `credit_checks` (score results + hashes, private), `ai_config` (admin-managed AI model + prompts), `ens_identities` (issued-subname mirror + profile), `profiles`. RLS on, **service-role only** (auth is Privy, not Supabase Auth). The `/admin` dashboard (gated by `ADMIN_SECRET`) edits `ai_config` and shows live status.

## Run loop (Scaffold-ETH 2)
Three terminals: `yarn chain` (local anvil) · `yarn deploy` (deploy contracts) · `yarn start` (frontend at :3000). Edit a contract → redeploy → frontend auto-adapts to the new ABI. `yarn test` runs Foundry tests.

## Onchain rules (from ethskills — non-negotiable)

- Say **"onchain"** (one word).
- **0–2 contracts** for an MVP, 3 is the ceiling. Contracts are for ownership/transfers/commitments — not a database or backend. Push everything else to Supabase.
- **Verify state before coding.** Check live gas (`cast base-fee`), real protocol addresses (`cast code <addr>`), and token decimals. Stale training data causes fund-loss bugs.
- **Decimals kill apps.** USDC = 6 decimals, not 18. Always verify on the target chain.
- **Never hardcode addresses.** Resolve from a config keyed by chainId. Wrong address = permanent loss.
- **Never use spot DEX prices as an oracle** — flash-loanable in one tx. Use Chainlink feeds.
- **Never commit secrets.** AI agents are the #1 credential leak vector. Secrets live in `.env.local` (gitignored) and Vercel/Railway env, never in code or chat.
- **Design for incentives, not timers.** Contracts can't self-execute; every function needs a caller who pays gas. Plan who calls what and what happens if nobody does.
- Before writing Solidity or shipping anything onchain, invoke the **`ethskills:ship`** skill (and `ethskills:security` before deploy).

## Skills available

- **Privy**: `.claude/skills/privy` — auth/wallet/policy implementation sequences. Live docs via `privy-docs` MCP.
- **Chainlink** (`.claude/skills/chainlink-*` → `.agents/skills/`): `data-feeds`, `data-streams`, `vrf`, `ccip`, `cre`, `ace`, `confidential-ai-attester`.
- **Scaffold-ETH 2** (`.agents/skills/` → symlinked into `.claude/skills/`): `openzeppelin`, `erc-721`, `siwe`, `eip-5792` (batch tx), `x402` (machine payments), `subgraph`, `ponder` (indexer), `drizzle-neon` (db).
- **Vercel** (vercel-labs/agent-skills): `deploy-to-vercel`, `vercel-optimize`, `vercel-cli-with-tokens`, `vercel-composition-patterns`, `vercel-react-best-practices`, `vercel-react-view-transitions`, `web-design-guidelines`, `writing-guidelines`. Pair with the `vercel` MCP.
- **Supabase** (supabase/agent-skills): `supabase`, `supabase-postgres-best-practices`. Pair with the `supabase` MCP.
- **ethskills** (plugin): `ship`, `security`, `gas`, `l2s`, `standards`, `tools`, `addresses`, `wallets`, `testing`, `audit`, `frontend-ux`, etc.
- **Uniswap / viem** plugins: `viem-integration`, `swap-integration`, `v4-*` for AMM/hook work.
- **Supabase / Vercel** plugins: DB, deploy, env management.

## MCP servers (`.mcp.json`)

- **context7** — live library docs. Append "use context7" to prompts for ENS/any lib (e.g. "Add ENS resolution. Use context7 for ensdomains/docs").
- **privy-docs** — live Privy docs search (hosted, no auth).
- **supabase** — read-only project access (needs `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`).
- **railway** — deploy/manage services (needs `RAILWAY_API_TOKEN`).
- **vercel** — official, remote, OAuth. Projects/deployments/logs/docs. Authorize via `/mcp`.
- **github** — official GitHub MCP (`api.githubcopilot.com/mcp/`), remote, OAuth. Repos/PRs/issues/actions. Authorize via `/mcp`.
- **blockscout** — explorer reads (tx/address/contract/token), multichain. Needs `BLOCKSCOUT_PRO_API_KEY`.
- **graph-subgraph** / **graph-token-api** — The Graph indexing. Subgraph queries + token balances/holders/prices. Need `GRAPH_GATEWAY_API_KEY` / `GRAPH_TOKEN_API_JWT`. See `docs/indexing-explorers.md`.

After editing `.mcp.json`, restart Claude Code and run `/mcp` to authorize the OAuth servers (vercel, github) and check connection status. Full tooling map: `docs/tooling-lab.md`.

## Conventions

- TypeScript strict. No `any` in shared code.
- Frontend lives in `packages/nextjs`; contracts in `packages/foundry`.
- **Onchain WRITES → `useSponsoredWrite()`** (`hooks/scaffold-eth/useSmartWallet.ts`): `writeContractSponsored({address,abi,functionName,args})` for single, `sendCalls([...])` for atomic batches (e.g. approve+deposit). These go through the Privy smart wallet → **gas-sponsored** by dashboard credits. **Do NOT use `useScaffoldWriteContract` for user writes** — it signs from the embedded EOA and is NOT sponsored.
- **Onchain READS → `useScaffoldReadContract({ ..., account: useSmartWalletAddress() })`** so balances/positions reflect the smart wallet, not the EOA signer.
- Contract addresses/ABIs are auto-generated by SE-2 into `packages/nextjs/contracts/deployedContracts.ts` on deploy — never hand-copy them.
- Server-only secrets never imported into client components. Public env = `NEXT_PUBLIC_*` only.
- Run `/ship-check` before any onchain deploy.

## Layout (monorepo)

```
packages/
  nextjs/       # Next.js app: app/ components/ hooks/ services/web3/ scaffold.config.ts
  foundry/      # Foundry: contracts/ script/ test/ lib/(submodules) foundry.toml
docs/           # Provider integration notes
.claude/        # agents, commands, skills (chainlink + SE-2 + privy), settings
.mcp.json       # MCP servers
AGENTS.md       # SE-2 agent guidance (imported into this file)
```

## CI & quality gates

- `.github/workflows/ci.yml` — yarn monorepo: Foundry tests + Next.js lint/typecheck/build + gitleaks. (SE-2 also ships `.github/workflows/lint.yaml`.)
- `/test-ci` runs the same locally before a push. `/ship-check` gates onchain deploys.

## Env & RPC

Per-package env (SE-2): `packages/nextjs/.env.local` (frontend, `NEXT_PUBLIC_*`) and `packages/foundry/.env` (deploy keys, RPC, Etherscan). Root `.env.example` documents every key as the master reference.
RPC via **Alchemy** (one key, all chains) — `ALCHEMY_API_KEY`. ENS resolution always uses the **mainnet** RPC. See `docs/rpc.md`.

## Onboarding

New here / reusing as a template → start with **`README.md`** (full setup + tooling walkthrough).
