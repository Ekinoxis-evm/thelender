# RPC Access

Every onchain read/write needs an RPC endpoint. Don't ship public/free RPCs in production — they rate-limit and drop.

## Recommended: Alchemy (one key, every chain)
Get a key at [dashboard.alchemy.com](https://dashboard.alchemy.com). URL pattern:

```
https://<chain>.g.alchemy.com/v2/<ALCHEMY_API_KEY>
```

| Chain | subdomain |
|-------|-----------|
| Ethereum Mainnet | `eth-mainnet` |
| Base | `base-mainnet` |
| Base Sepolia | `base-sepolia` |
| Optimism | `opt-mainnet` |
| Arbitrum One | `arb-mainnet` |
| Sepolia | `eth-sepolia` |

Two ways to wire it (pick one):
- **Derive in code** — Scaffold-ETH 2 reads `NEXT_PUBLIC_ALCHEMY_API_KEY` in `packages/nextjs/scaffold.config.ts` and builds RPC URLs per chain automatically. Override per-chain via `rpcOverrides` there.
- **Full URLs in env** — paste into `NEXT_PUBLIC_RPC_URL_*`. Simpler, but a public env var exposes the URL (+key) to the browser. For client-side reads that's usually acceptable on Alchemy; for sensitive/high-volume use a server route or a key with a domain allowlist + restricted methods.

## Key facts
- **ENS resolution always uses the Ethereum *Mainnet* RPC**, even when the app runs on an L2. Set `NEXT_PUBLIC_ENS_RPC_URL` to your mainnet endpoint.
- Foundry reads RPCs from `packages/foundry/foundry.toml` → `[rpc_endpoints]` (resolved from `ALCHEMY_API_KEY` in `packages/foundry/.env`). `forge` / `cast` use `--rpc-url base` etc.
- **Alternatives:** Infura, Ankr, drpc, or a chain's public RPC for quick testnet work. Same URL-in-env pattern.
- An **Alchemy MCP** server exists if you want agent-driven RPC/enhanced-API calls — add it later if needed; for the app itself a plain RPC URL is all that's required.

## Security
- A key in `NEXT_PUBLIC_*` is public. Restrict it in the Alchemy dashboard (domain allowlist, method limits) or proxy through a server route.
- Never put a mainnet deployer key near frontend env. That lives only in `DEPLOYER_PRIVATE_KEY` (server/CLI) or a `cast wallet`.
