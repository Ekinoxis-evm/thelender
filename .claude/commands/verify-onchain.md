---
description: Verify a protocol/token/feed address and its key facts live onchain before using it in code.
---

For the address(es) in $ARGUMENTS (and the chain implied or named), verify against live chain state — never trust memorized values:

1. `cast code <addr> --rpc-url <rpc>` → confirm bytecode exists (not an EOA / wrong chain).
2. If it's a token: read `decimals()`, `symbol()` via `cast call`. Report them. (USDC = 6, not 18.)
3. If it's a Chainlink feed: read `decimals()`, `description()`, and `latestRoundData()`; report `updatedAt` staleness and the answer.
4. If it's a known protocol router/factory: cross-check against the `ethskills:addresses` skill / `chainlink-*` skills for the canonical address on that chain.

Output a table: address · chain · type · verified facts · ✅/⚠️. Flag anything that looks like an EOA, an empty account, or a chain mismatch.
