# ethglobanyc — AI-Native Web3 App Template

A **Scaffold-ETH 2** dApp (Next.js + Foundry monorepo) supercharged with an **AI provider lab**: a curated set of MCP servers, subagents, slash commands, and skills that let you build, verify, index, and ship onchain apps with Claude Code — fast and safely.

> **TL;DR** — `yarn install` → `yarn chain` / `yarn deploy` / `yarn start`. Then build with the agents and `/commands` below. Authorize MCPs with `/mcp`.

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
git clone <your-repo> && cd ethglobanyc
git submodule update --init --recursive   # Foundry libs (forge-std, OpenZeppelin)
yarn install                              # uses the bundled yarn 4 — no corepack needed
```

## 3 · Run (three terminals)
```bash
yarn chain      # 1) local Anvil chain
yarn deploy     # 2) deploy contracts → ABIs auto-sync to the frontend
yarn start      # 3) frontend at http://localhost:3000
```
Edit a contract → `yarn deploy` again → the UI auto-adapts to the new ABI. That hot loop is SE-2's superpower.

Other useful scripts: `yarn test` (Foundry tests) · `yarn compile` · `yarn account` (manage deploy keystore) · `yarn next:check-types` · `yarn lint`.

## 4 · Configure

### Environment (per package)
```bash
cp packages/nextjs/.env.example   packages/nextjs/.env.local    # frontend keys
cp packages/foundry/.env.example  packages/foundry/.env         # deploy/verify keys
```
Minimum to build: **`NEXT_PUBLIC_ALCHEMY_API_KEY`** (RPC — [Alchemy](https://dashboard.alchemy.com)) and, once you swap in Privy, **`NEXT_PUBLIC_PRIVY_APP_ID`**. Every key is documented in `.env.example` (root) — the master reference — and `docs/rpc.md`. SE-2 ships working defaults so you can start with nothing set.

### MCP servers (the AI's live tools)
Restart Claude Code, then run `/mcp`:
- **OAuth** (just authorize): `vercel`, `github`
- **Keyed** (need env vars): `supabase`, `railway`, `blockscout`, `graph-subgraph`, `graph-token-api`
- **No auth**: `privy-docs`, `context7`

Which key unlocks which server → `docs/tooling-lab.md`.

---

## 5 · How to build *with the AI* (the point of this template)

This repo is wired so Claude Code has the right context and tools for each job. Use the **slash commands** and let it pull in the matching **agent + skill + MCP**:

| You want to… | Run / ask | What kicks in |
|--------------|-----------|---------------|
| Add a smart contract | "add an ERC-721 mint contract" | `solidity-engineer` agent + `openzeppelin`/`erc-721` skills → `ethskills:ship` first |
| Swap RainbowKit → Privy | `/setup-privy` | `web3-frontend` agent + `privy` skill + `privy-docs` MCP |
| Resolve ENS names/avatars | `/integrate-ens` | context7-grounded ENS docs |
| Add a price feed / VRF / CCIP | "add a Chainlink ETH/USD feed" | `chainlink-*` skills, live addresses |
| Index events | "index Transfer events" | `subgraph` / `ponder` skills + Graph MCPs |
| Add off-chain DB | "add a Postgres table for X" | `integrations-engineer` + `supabase`/`drizzle-neon` |
| Verify a deployed contract | `/verify-contract` | Foundry + Etherscan V2 (one key, all chains) |
| Check a tx / address while debugging | "inspect tx 0x… on Base" | `blockscout` MCP |
| Pre-flight before deploy | `/ship-check` | full gate: state, decimals, addresses, secrets, tests, audit |
| Run CI locally before pushing | `/test-ci` | Foundry tests + Next lint/typecheck/build |

**Always ground library questions** by adding `use context7` to a prompt (e.g. *"Add ENS resolution. use context7 for ensdomains/docs"*).

### Agents (`.claude/agents/`)
| Agent | Use it for |
|-------|-----------|
| `solidity-engineer` | Writing/refactoring contracts + Foundry tests. Invokes `ethskills:ship`/`security`. |
| `web3-frontend` | Next.js + Privy + wagmi/viem + ENS UI. |
| `onchain-security-reviewer` | Adversarial pre-deploy audit (read-only). |
| `integrations-engineer` | Supabase / Railway / Chainlink / indexer wiring. |
| `grumpy-carlos-code-reviewer` | SE-2's opinionated code reviewer. |

### Skills (`.claude/skills/` — 16 + plugins)
- **Chainlink**: `data-feeds` · `data-streams` · `vrf` · `ccip` · `cre` · `ace` · `confidential-ai-attester`
- **Scaffold-ETH 2**: `openzeppelin` · `erc-721` · `siwe` · `eip-5792` · `x402` · `subgraph` · `ponder` · `drizzle-neon`
- **Privy**: `privy` · plus in-session `ethskills:*`, `vercel:*`, `supabase:*`, Uniswap/viem plugins

### MCP servers (`.mcp.json` — 9)
`context7` · `privy-docs` · `supabase` · `railway` · `vercel` · `github` · `blockscout` · `graph-subgraph` · `graph-token-api`

---

## 6 · Project structure
```
packages/
  nextjs/                 # Next.js app
    app/  components/  hooks/scaffold-eth/   # SE-2 typed hooks (useScaffoldReadContract…)
    services/web3/        # wagmi config + connectors (← swap RainbowKit→Privy here)
    contracts/            # auto-generated deployedContracts.ts (do NOT hand-edit)
    scaffold.config.ts    # target networks, polling, burner wallet
  foundry/                # Foundry project
    contracts/  script/  test/  lib/(submodules)
    foundry.toml          # tuned: reproducible bytecode + Etherscan V2 multichain verify
.claude/                  # agents · commands · skills · settings
.agents/skills/           # skill sources (symlinked into .claude/skills)
docs/                     # tooling-lab · rpc · ens · privy · chainlink · infra · indexing-explorers
.github/workflows/        # CI (Foundry + Next + secret scan) and SE-2 lint
.mcp.json                 # MCP servers
CLAUDE.md  AGENTS.md       # project memory (CLAUDE.md imports AGENTS.md)
```

## 7 · Deploy
- **Contracts** → `yarn deploy --network <net> --verify` (auto-verifies via Etherscan V2). Re-verify with `/verify-contract`.
- **Frontend** → `yarn vercel` or the `vercel` MCP. Pull env with `vercel env pull`.
- **Services/indexers** → Railway (`railway` MCP).

## 8 · Reuse as a template for the next app
```bash
npx degit <this-repo> my-new-app && cd my-new-app
yarn install && git submodule update --init --recursive
```
Keep `.claude/`, `.agents/`, `.mcp.json`, `docs/`, `CLAUDE.md`, `AGENTS.md`, `packages/foundry/foundry.toml`. Edit the stack table + `targetNetworks`, then `cp` the env files and re-authorize MCPs.

## Golden rules — never skip (see [`CLAUDE.md`](CLAUDE.md))
**"onchain"** is one word · **0–2 contracts** for an MVP · verify addresses / decimals / gas **live**, never from memory · **USDC = 6 decimals** · **Chainlink feeds**, never spot prices, as oracles · contract addresses come from generated artifacts, never hand-copied · **never commit secrets** (AI agents are the #1 leak vector).

---
*Built on [Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2). Setup & deeper docs in [`docs/`](docs/); full tooling inventory in [`docs/tooling-lab.md`](docs/tooling-lab.md).*
