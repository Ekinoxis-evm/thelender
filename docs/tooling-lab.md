# Tooling Lab — complete inventory

The full set of tooling wired into this workspace. **Base framework: Scaffold-ETH 2** (yarn-4 monorepo, `packages/nextjs` + `packages/foundry`) with our AI provider lab layered on top. Auth statuses below tell you what's ready vs. what needs a key/authorization.

## MCP servers (`.mcp.json`)

| Server | Endpoint / command | Auth | What you need to do |
|--------|--------------------|------|---------------------|
| **context7** | `https://mcp.context7.com/mcp` (http) | none | Ready — hosted library-docs search. Add "use context7" to prompts. |
| **privy-docs** | `https://docs.privy.io/mcp` | none | Ready — hosted docs search. |
| **supabase** | `npx @supabase/mcp-server-supabase` (read-only) | token | Set `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`. |
| **railway** | `npx @railway/mcp-server` | token | Set `RAILWAY_API_TOKEN`. |
| **vercel** | `https://mcp.vercel.com` | **OAuth** | Run `/mcp` → authorize. No token in file. |
| **github** | `https://api.githubcopilot.com/mcp/` | **OAuth** (or PAT) | Run `/mcp` → authorize. PAT alt: add `Authorization: Bearer` header + `GITHUB_PERSONAL_ACCESS_TOKEN`. |
| **blockscout** | `https://mcp.blockscout.com/mcp` | PRO key | Set `BLOCKSCOUT_PRO_API_KEY` (`proapi_…`) from dev.blockscout.com. Explorer reads. |
| **graph-subgraph** | `https://subgraphs.mcp.thegraph.com/sse` | Bearer | Set `GRAPH_GATEWAY_API_KEY` from Subgraph Studio. Query 15k+ subgraphs. |
| **graph-token-api** | `https://token-api.mcp.thegraph.com/sse` | Bearer | Set `GRAPH_TOKEN_API_JWT` from The Graph Market. Token balances/holders/prices. |

> Note: GitHub's **official** Claude integration is the MCP server above — there is no separate "GitHub skills" package. The server exposes toolsets (repos, issues, pull_requests, actions…) and supports `--read-only`. A local Docker alternative exists (`ghcr.io/github/github-mcp-server`) if you ever need to pin it.

**Activation:** edit `.mcp.json` → restart Claude Code → `/mcp` to authorize OAuth servers and confirm all show connected.

## Skills

| Skill(s) | Location | Source |
|----------|----------|--------|
| `privy` | `.claude/skills/privy` | `npx skills add https://docs.privy.io` |
| `chainlink-{data-feeds,data-streams,vrf,ccip,cre,ace,confidential-ai-attester}` | `.claude/skills/chainlink-*` → `.agents/skills/` | `npx skills add smartcontractkit/chainlink-agent-skills` |
| `openzeppelin, erc-721, siwe, eip-5792, x402, subgraph, ponder, drizzle-neon` | `.claude/skills/*` → `.agents/skills/` | Scaffold-ETH 2 (bundled) |
| `ethskills:{ship,security,gas,l2s,standards,tools,addresses,wallets,testing,audit,frontend-ux,…}` | plugin (in-session) | ethskills.com |
| `vercel:*`, `supabase:*`, `uniswap-*`, `viem-integration`, `frontend-design` | plugins (in-session) | bundled |

## Agents (`.claude/agents/`)

- **solidity-engineer** — contracts + Foundry tests; invokes `ethskills:ship`/`security`.
- **web3-frontend** — Next.js + Privy + wagmi/viem + ENS.
- **onchain-security-reviewer** — adversarial pre-deploy audit (read-only).
- **integrations-engineer** — Supabase / Railway / Chainlink wiring.
- **grumpy-carlos-code-reviewer** — SE-2's opinionated reviewer (bundled).

## Commands (`.claude/commands/`)

- `/ship-check` — pre-deploy gate (state, decimals, addresses, secrets, tests, audit).
- `/integrate-ens` — ENS forward/reverse/avatar, grounded via context7.
- `/setup-privy` — Privy auth + embedded wallets scaffold.
- `/verify-onchain` — verify an address/feed/token live with `cast`.
- `/verify-contract` — clean Etherscan V2 verification via Foundry.
- `/test-ci` — run the full CI suite locally before pushing.

## Local toolchain

- **Scaffold-ETH 2** monorepo — `yarn chain` / `yarn deploy` / `yarn start`; ABIs hot-reload to the frontend. Run `yarn install` + `git submodule update --init --recursive` after clone.
- **Foundry 1.7.1** — `forge`/`cast`/`anvil`/`chisel` at `~/.foundry/bin`. Project at `packages/foundry/`; `foundry.toml` pre-tuned for reproducible bytecode + Etherscan V2 multichain verify. See `docs/indexing-explorers.md`.

## Auth checklist (do these once)

- [ ] `yarn install` + `git submodule update --init --recursive`
- [ ] `cp packages/nextjs/.env.example packages/nextjs/.env.local` and `cp packages/foundry/.env.example packages/foundry/.env`
- [ ] `/mcp` → authorize **vercel** and **github** (OAuth)
- [ ] MCP keys → Supabase (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`), `RAILWAY_API_TOKEN`, `BLOCKSCOUT_PRO_API_KEY`, `GRAPH_GATEWAY_API_KEY`, `GRAPH_TOKEN_API_JWT`
- [ ] App keys → `NEXT_PUBLIC_ALCHEMY_API_KEY`, `NEXT_PUBLIC_PRIVY_APP_ID` (+ `PRIVY_APP_SECRET`), `ETHERSCAN_API_KEY`

## Done / next
- ✅ **Privy is the default wallet/auth** with sponsored ERC-4337 smart wallets (RainbowKit removed). Runtime needs `NEXT_PUBLIC_PRIVY_APP_ID` + a dashboard paymaster — see `docs/privy.md`.
- Optional adds when needed: Tenderly, an Alchemy MCP. Cleanup: remove dormant RainbowKit deps/files once confirmed unused.
