# ENS Integration Notes

Source: https://docs.ens.domains/llms.txt · ground new code with **"use context7 for ensdomains/docs"**.

## Key fact
ENS resolution **always reads from Ethereum Mainnet**, even if your app runs on Base/OP/Arbitrum. Keep a dedicated mainnet viem client (`NEXT_PUBLIC_ENS_RPC_URL`). Primary (reverse) names are now also supported natively on Base, OP, Arbitrum, Scroll, Linea — but mainnet is the safe default for resolution.

## viem actions
```ts
import { normalize } from 'viem/ens'

// Forward: name → address
const addr = await mainnetClient.getEnsAddress({ name: normalize('alice.eth') })

// Reverse: address → primary name  (then verify it forward-resolves back!)
const name = await mainnetClient.getEnsName({ address })

// Avatar (text record, ENSIP-12)
const avatar = await mainnetClient.getEnsAvatar({ name: normalize(name) })
```

- **Always `normalize()`** user-supplied names before resolving (ENSIP-15).
- **Verify reverse records**: a reverse record is user-set and unverified. After `getEnsName`, call `getEnsAddress` on the result and confirm it matches the original address before displaying it as trusted.
- Cache via wagmi/react-query — resolution is an RPC round-trip.

## Libraries
- **viem** — actions above (server + client).
- **wagmi** — `useEnsName`, `useEnsAvatar`, `useEnsAddress` hooks (set `chainId: mainnet.id`).
- **@ensdomains/ensjs** — richer record reads (text records, subnames) when viem isn't enough.

## L2 / CCIP Read
Records can live offchain or on an L2 via CCIP Read; viem follows the gateway automatically. No special handling for standard reads.
