---
description: Add ENS name + avatar resolution (forward & reverse) to the frontend, grounded in current ENS docs.
---

Integrate ENS resolution into the app. **Use context7 for ensdomains/docs** to ground every API call in current documentation before writing code.

Requirements:
- Resolution runs against an **Ethereum Mainnet** viem client (`NEXT_PUBLIC_ENS_RPC_URL`), independent of the app's active L2 chain.
- Provide a reusable hook/util covering:
  - **Reverse** (address → primary name): `getEnsName`, then verify it forward-resolves back to the same address before trusting it.
  - **Forward** (name → address): `getEnsAddress` with `normalize()` from `viem/ens`.
  - **Avatar**: `getEnsAvatar`, with a sensible fallback.
- Replace raw `0x…` address displays across the UI with name + avatar, falling back to a truncated address.
- Cache results (wagmi/react-query) to avoid hammering the RPC.

Target: $ARGUMENTS (default: the main address-display component and any address input field).

Hand the implementation to the `web3-frontend` agent.
