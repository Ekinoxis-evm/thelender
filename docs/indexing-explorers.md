# Indexing, Explorers & Verification

How the app reads chain data at scale, inspects it, and proves its contracts.

## The Graph — indexing (two MCPs)
For querying large amounts of historical/aggregated onchain data — don't loop RPC calls, index it.

| MCP | Endpoint | Auth | Use |
|-----|----------|------|-----|
| `graph-subgraph` | `https://subgraphs.mcp.thegraph.com/sse` (SSE) | `Authorization: Bearer ${GRAPH_GATEWAY_API_KEY}` | Search 15k+ subgraphs, inspect GraphQL schemas, run live queries. Key from [Subgraph Studio](https://thegraph.com/studio). |
| `graph-token-api` | `https://token-api.mcp.thegraph.com/sse` (SSE) | `Authorization: Bearer ${GRAPH_TOKEN_API_JWT}` | Token balances, transfers, holders, prices on ETH/Base/Arbitrum/Polygon/OP/BSC. JWT from [The Graph Market](https://thegraph.market). |

- **Token API** = drop-in token data, no subgraph to write. Best first reach for balances/holders/prices.
- **Subgraph MCP** = query any existing subgraph in natural language; write your own subgraph when the app needs custom event indexing.
- For custom indexing of *your* contract's events, author a subgraph (deploy via Studio) or run a worker on Railway.

## Blockscout — open-source explorer MCP
| MCP | Endpoint | Auth |
|-----|----------|------|
| `blockscout` | `https://mcp.blockscout.com/mcp` (Streamable HTTP) | header `Blockscout-MCP-Pro-Api-Key: ${BLOCKSCOUT_PRO_API_KEY}` (PRO key from [dev.blockscout.com](https://dev.blockscout.com)) |

Tools: balances/holdings, token & NFT lookups, contract ABI + source, tx/transfer history, block/tx details, read-only contract calls, ENS resolution, raw API access — multichain. Great for "what happened in this tx / what does this contract hold" during debugging. Also available as an official Anthropic connector.

## Etherscan — clean contract verification (no separate MCP needed)
The clean, official path is **Foundry + Etherscan V2**: one `ETHERSCAN_API_KEY` verifies across 60+ chains via `https://api.etherscan.io/v2/api?chainid=<id>`. Foundry routes automatically from the chain alias.

```bash
# from packages/foundry/  — or just: yarn deploy --network base --verify
forge verify-contract <addr> contracts/Foo.sol:Foo --chain base --watch \
  --constructor-args $(cast abi-encode "constructor(uint256)" 100)
```
Reproducible bytecode is pre-configured in `packages/foundry/foundry.toml` (`bytecode_hash="none"`, `cbor_metadata=false`) so verification matches first try. Use the `/verify-contract` command. Get the key at [etherscan.io/myapikey](https://etherscan.io/myapikey).

> A community **Etherscan MCP** exists for *reading* chain data, but it's third-party — we rely on the official Foundry verify flow above for verification and on Blockscout/The Graph MCPs for reads. Add an Etherscan MCP only after reviewing the source.

## When to use which
- Verify my contract → **Foundry + Etherscan V2** (`/verify-contract`).
- Inspect a tx / address / contract while debugging → **Blockscout MCP**.
- Token balances/holders/prices → **Graph Token API MCP**.
- Custom historical queries / aggregations → **Graph Subgraph MCP** (or write a subgraph).
