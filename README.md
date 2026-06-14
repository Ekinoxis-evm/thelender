# Kredito

**Kredito** is **sponsored, gasless, credit-gated *undercollateralized* USDC lending** on Ethereum **Sepolia**. A business uploads its documents, an AI underwriter scores it privately, that score becomes a portable onchain identity (`<you>.kredito.eth`), and the identity unlocks an undercollateralized loan — all without the borrower ever paying gas or exposing their financials onchain.

Built on **Scaffold-ETH 2** (Next.js App Router + Foundry monorepo) with an **AI provider lab** (MCP servers, subagents, slash commands, skills for Claude Code). Auth/wallet is **Privy** (email + Google only) with embedded → **ERC-4337 gas-sponsored smart wallets**; off-chain data lives in **Supabase**; deployed on **Vercel**.

> Built on the [AI-Native Web3 App template](https://github.com/Ekinoxis-evm/ai_scafolding_web3_app). New here? Read this, then [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/architecture.md`](docs/architecture.md).

> **TL;DR** — `yarn install && git submodule update --init --recursive` → set Privy + Supabase + Alchemy keys → `yarn start`. ENS contracts are already live on Sepolia; the vault is built but not yet deployed. Authorize MCPs with `/mcp`.

## The flow — credit → identity → loan

A single page (`packages/nextjs/components/kredito/KreditoFlow.tsx`) walks the borrower through five steps:

| # | Step | What happens |
|---|------|--------------|
| 1 | **Onboarding** | Business profile + document uploads (financials, tax, bank, A/R, debt schedule, legal). Demo profiles preload docs. |
| 2 | **Score** | `POST /api/lendsignal/score` — the **Chainlink Confidential AI Attester** analyzes the documents inside a TEE (raw docs never leave the enclave or hit the DB), blended **70/30** with a mock credit bureau into a combined **score (0–1000)** + risk tier + eligibility. Persisted to Supabase `credit_checks` (**results + hashes only**). Falls back to a deterministic mock if `CHAINLINK_CONFIDENTIAL_AI_API_KEY` is unset. |
| 3 | **Identity** | Issuer signs an **EIP-712 `CreditAttestation`** server-side (`POST /api/lendsignal/attest`), then mints `<label>.kredito.eth`: the user signs the mint message → `POST /api/identity/mint` → `KreditoController.mint(label, wallet, attestationHash)`, issuer-submitted and **Privy-sponsored**. The issuer locks `kredito.status = approved` + the attestation hash; the user owns the name and its editable profile records. |
| 4 | **Borrow** | `KreditoVault.borrow(attestation, sig, amount)` — the vault verifies the EIP-712 signature **onchain** (signer == issuer), checks score / expiry / max principal, then releases USDC. **Deferred:** the vault is built and tested but **not yet deployed**. |
| 5 | **Liquidity** | ERC-4626 deposit + **ERC-7540 async redeem** (request → fulfill → claim) for lenders. **Deferred** alongside the vault. |

## Onchain state

| Contract | Address (Sepolia) | Status |
|----------|-------------------|--------|
| `KreditoController` | `0xE498cbC0F0ED0b9059FEc2a7F1275834108915B0` | **Live** |
| `KreditoResolver` | `0xE68F49F6256a2aF1702855dc62B82afF6Fd65F0E` | **Live** |
| subRegistry (ENSv2 `UserRegistry` proxy) | `0x2167d6DF85bC76f22b7f150220740444DC257AAf` | **Live** |
| parent `kredito.eth` | on ENSv2 / Namechain Sepolia | **Live** |
| `KreditoVault` | — | **Built & tested, not deployed** |

The ENS contracts are wired into the frontend via env (`NEXT_PUBLIC_KREDITO_CONTROLLER` / `NEXT_PUBLIC_KREDITO_RESOLVER`) — they are **not** in the auto-generated `deployedContracts.ts`. Issuer, deployer, and owner are currently one key (the Foundry keystore `kredito-issuer`); production would split a cold owner from a hot issuer.

```
                       ┌─────────────────────────────────────────────┐
   You + Claude Code ──┤  Agents · /commands · Skills · 9 MCP servers │
                       └───────────────┬─────────────────────────────┘
                                       │ drives
        ┌──────────────────────────────┴──────────────────────────────┐
        │                    Scaffold-ETH 2 (monorepo)                 │
        │   packages/nextjs  ◄── hot-reload ABI ──►  packages/foundry  │
        │   Next.js · wagmi/viem · Privy            Foundry · anvil     │
        └──────────────────────────────┬──────────────────────────────┘
                                        │ integrates
   Privy · ENS · Chainlink · Supabase · The Graph · Blockscout · Railway · Vercel
```

---

## 1 · Prerequisites
| Tool | Version | Install |
|------|---------|---------|
| Node | ≥ 20.18.3 (24 LTS recommended) | [nodejs.org](https://nodejs.org) |
| Yarn | 4.x (bundled in repo) | nothing to do — `.yarn/releases/` ships it |
| Foundry | latest | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| Git | any | — |

## 2 · Install
```bash
git clone <your-repo> && cd <your-repo>
git submodule update --init --recursive   # Foundry libs (forge-std, OpenZeppelin)
yarn install                              # uses the bundled yarn 4 — no corepack needed
```

## 3 · Run

The ENS contracts (`KreditoController`, `KreditoResolver`, subRegistry) are **already live on Sepolia** — to run the credit → identity flow you only need the frontend + keys:
```bash
yarn start                      # frontend at http://localhost:3000
```
End users pay no gas: Privy's smart wallet + your dashboard gas credits sponsor every transaction.

**Redeploy the ENS contracts** (only if you're forking the protocol) — uses the `kredito-issuer` keystore as issuer/deployer/owner:
```bash
forge script script/SetupKreditoEns.s.sol --rpc-url sepolia --account kredito-issuer            # simulate
forge script script/SetupKreditoEns.s.sol --rpc-url sepolia --account kredito-issuer --broadcast # send
```
(Run from `packages/foundry`. After running, update `NEXT_PUBLIC_KREDITO_CONTROLLER` / `NEXT_PUBLIC_KREDITO_RESOLVER`.)

**Optional — local fast iteration** (no Privy sponsorship; smart wallets need a real network):
```bash
# temporarily set targetNetworks: [chains.foundry] in packages/nextjs/scaffold.config.ts
yarn chain      # local Anvil
yarn deploy     # deploy locally → ABIs hot-reload to the UI
yarn start
```
Edit a contract → `yarn deploy` again → the UI auto-adapts to the new ABI. That hot loop is SE-2's superpower.

Other useful scripts: `yarn test` (Foundry tests — `KreditoController`, `KreditoResolver`, `KreditoVault`) · `yarn compile` · `yarn account` (deploy keystore) · `yarn next:check-types` · `yarn lint`.

## 4 · Configure

### Environment (per package)
```bash
cp packages/nextjs/.env.example   packages/nextjs/.env.local    # frontend keys
cp packages/foundry/.env.example  packages/foundry/.env         # deploy/verify keys
```
Minimum to run the app:
- **`NEXT_PUBLIC_PRIVY_APP_ID`** — login/wallets ([dashboard.privy.io](https://dashboard.privy.io), **required at runtime**).
- **`NEXT_PUBLIC_ALCHEMY_API_KEY`** — RPC ([Alchemy](https://dashboard.alchemy.com)).
- **Supabase** — `NEXT_PUBLIC_SUPABASE_URL` (project ref `rooclfwqvmwehaqmtflp`) + keys, for `credit_checks`, `ai_config`, and `ens_identities`.
- **`NEXT_PUBLIC_KREDITO_CONTROLLER` / `NEXT_PUBLIC_KREDITO_RESOLVER`** — the live ENS contract addresses above.

Server-only (never `NEXT_PUBLIC_`): `CHAINLINK_CONFIDENTIAL_AI_API_KEY` (the TEE attester — omit it and scoring uses a deterministic mock), the issuer key for EIP-712 attestation signing, and `ADMIN_SECRET` (gates the `/admin` AI-config dashboard).

For Privy sponsorship: enable smart wallets + add **Sepolia** to supported networks + add `http://localhost:3000` to allowed origins, and turn on gas-sponsorship credits (see `docs/privy.md`). Every key is documented in `.env.example` (root, master reference) and `docs/rpc.md`.

### MCP servers (the AI's live tools)
Restart Claude Code, then run `/mcp`:
- **OAuth** (just authorize): `vercel`, `github`
- **Keyed** (need env vars): `supabase`, `railway`, `blockscout`, `graph-subgraph`, `graph-token-api`
- **No auth**: `privy-docs`, `context7`

Which key unlocks which server → `docs/tooling-lab.md`.

---

## 5 · How to build *with the AI*

Kredito is built on an AI-native scaffold: Claude Code has the right context and tools wired in for each job. Use the **slash commands** and let it pull in the matching **agent + skill + MCP**:

| You want to… | Run / ask | What kicks in |
|--------------|-----------|---------------|
| Work on a contract (vault / controller / resolver) | "add X to KreditoVault" | `solidity-engineer` agent + `openzeppelin` skill → `ethskills:ship` first |
| Customize Privy login / wallets | `/setup-privy` | `web3-frontend` agent + `privy` skill + `privy-docs` MCP |
| Resolve ENS names/avatars | `/integrate-ens` | context7-grounded ENS docs |
| Add a Chainlink integration | "add a Chainlink ETH/USD feed" | `chainlink-*` skills (incl. `confidential-ai-attester`), live addresses |
| Index events | "index events from KreditoController" | `subgraph` / `ponder` skills + Graph MCPs |
| Add off-chain DB | "add a Supabase table for X" | `integrations-engineer` + `supabase`/`drizzle-neon` |
| Verify a deployed contract | `/verify-contract` | Foundry + Etherscan V2 (one key, all chains) |
| Check a tx / address while debugging | "inspect tx 0x… on Sepolia" | `blockscout` MCP |
| Pre-flight before deploy | `/ship-check` | full gate: state, decimals, addresses, secrets, tests, audit |
| Run CI locally before pushing | `/test-ci` | Foundry tests + Next lint/typecheck/build |

**Always ground library questions** by adding `use context7` to a prompt (e.g. *"Add ENS resolution. use context7 for ensdomains/docs"*).

### Agents (`.claude/agents/`)
| Agent | Use it for |
|-------|-----------|
| `solidity-engineer` | Writing/refactoring contracts + Foundry tests. Invokes `ethskills:ship`/`security`. |
| `web3-frontend` | Next.js + Privy + wagmi/viem + ENS UI. |
| `onchain-security-reviewer` | Adversarial pre-deploy audit (read-only). |
| `integrations-engineer` | Supabase / Railway / Chainlink wiring. |
| `grumpy-carlos-code-reviewer` | SE-2's opinionated code reviewer. |

### Skills (`.claude/skills/` — 27 + plugins)
Skills give the agent *how-to / best-practices* context; they pair with the live-access MCPs.
- **Chainlink**: `data-feeds` · `data-streams` · `vrf` · `ccip` · `cre` · `ace` · `confidential-ai-attester` (the TEE attester Kredito's scoring uses)
- **Scaffold-ETH 2**: `openzeppelin` · `erc-721` · `siwe` · `eip-5792` · `x402` · `subgraph` · `ponder` · `drizzle-neon`
- **Privy**: `privy`
- **Vercel** (vercel-labs): `deploy-to-vercel` · `vercel-optimize` · `vercel-cli-with-tokens` · `vercel-composition-patterns` · `vercel-react-best-practices` · `vercel-react-view-transitions` · `web-design-guidelines` · `writing-guidelines`
- **Supabase**: `supabase` · `supabase-postgres-best-practices`
- Plus in-session plugins: `ethskills:*`, Uniswap/viem

### MCP servers (`.mcp.json` — 9)
`context7` · `privy-docs` · `supabase` · `railway` · `vercel` · `github` · `blockscout` · `graph-subgraph` · `graph-token-api`

---

## 6 · Project structure
```
packages/
  nextjs/                 # Next.js app
    app/  components/kredito/KreditoFlow.tsx   # the 5-step credit→identity→loan flow
    app/api/lendsignal/{score,attest}/  app/api/identity/mint/  # scoring + attestation + ENS mint
    app/admin/            # AI-config dashboard (gated by ADMIN_SECRET)
    services/lendsignal/  # Confidential AI scoring + 70/30 blend
    kredito/  lib/kredito/ # attestation typed-data, vault config, mint helpers
    hooks/scaffold-eth/useSmartWallet.ts  # useSponsoredWrite + useSmartWalletSign
    services/web3/        # Privy config (email + Google), smart-account connector
    contracts/            # auto-generated deployedContracts.ts (do NOT hand-edit; ENS addrs come from env)
    scaffold.config.ts    # targetNetworks (Sepolia), polling, RPC overrides
  foundry/                # Foundry project
    contracts/kredito/    # KreditoController.sol, KreditoResolver.sol
    contracts/lendsignal/ # KreditoVault.sol (ERC-4626 + ERC-7540, built & tested, not deployed)
    script/SetupKreditoEns.s.sol  # deploys + wires the ENSv2 controller/resolver/registry
    test/  lib/(submodules)
    foundry.toml          # tuned: reproducible bytecode + Etherscan V2 multichain verify
.claude/                  # agents · commands · skills · settings
.agents/skills/           # skill sources (symlinked into .claude/skills)
docs/                     # tooling-lab · rpc · ens · privy · chainlink · infra · indexing-explorers
.github/workflows/        # CI (Foundry + Next + secret scan) and SE-2 lint
.mcp.json                 # MCP servers
CLAUDE.md  AGENTS.md       # project memory (CLAUDE.md imports AGENTS.md)
```
> Naming: the product is **Kredito**; `kredito/` and `lendsignal/` are internal code-module names.

## 7 · Deploy
- **ENS contracts** → `forge script script/SetupKreditoEns.s.sol --rpc-url sepolia --account kredito-issuer --broadcast` (already live; re-run only to redeploy). Re-verify with `/verify-contract`.
- **Vault** → not yet deployed; build a deploy script and gate it through `/ship-check` first.
- **Frontend** → `yarn vercel` (or `yarn vercel:yolo --prod`) or the `vercel` MCP. Pull env with `vercel env pull`.
- **Services/indexers** → Railway (`railway` MCP).

## 8 · Reuse as a template for the next app
```bash
npx degit <this-repo> my-new-app && cd my-new-app
yarn install && git submodule update --init --recursive
```
Keep `.claude/`, `.agents/`, `.mcp.json`, `docs/`, `CLAUDE.md`, `AGENTS.md`, `packages/foundry/foundry.toml`. Edit the stack table + `targetNetworks`, then `cp` the env files and re-authorize MCPs.

## Golden rules — never skip (see [`CLAUDE.md`](CLAUDE.md))
**"onchain"** is one word · **0–2 contracts** for an MVP · verify addresses / decimals / gas **live**, never from memory · **USDC = 6 decimals** · **Chainlink feeds**, never spot prices, as oracles · contract addresses come from generated artifacts or env, never hand-copied · raw borrower documents never leave the TEE or land onchain · **never commit secrets** (AI agents are the #1 leak vector).

---
*Built on [Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2). Setup & deeper docs in [`docs/`](docs/); full tooling inventory in [`docs/tooling-lab.md`](docs/tooling-lab.md).*
