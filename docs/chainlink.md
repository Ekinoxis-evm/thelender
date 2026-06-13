# Chainlink Integration Notes

Skills installed at `.claude/skills/chainlink-*` (symlinked from `.agents/skills/`). Pick by need:

| Need | Skill | Use |
|------|-------|-----|
| Price / asset data onchain | `chainlink-data-feeds-skill` | Read `AggregatorV3Interface` feeds. |
| Low-latency / pull-based data | `chainlink-data-streams-skill` | REST/WS SDK + onchain report verification. |
| Verifiable randomness | `chainlink-vrf-skill` | VRF v2.5 (subscription or direct funding). |
| Cross-chain messaging/tokens | `chainlink-ccip-skill` | CCIP sends, CCT, local testing. |
| Offchain compute / PoR | `chainlink-cre-skill` | CRE workflows. |
| Compliance / identity tokens | `chainlink-ace-skill` | Policy mgmt, cross-chain identity. |

## Data Feeds — the right way
```solidity
(, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
require(answer > 0, "bad price");
require(block.timestamp - updatedAt < HEARTBEAT, "stale price"); // staleness guard
uint8 decimals = feed.decimals(); // feeds are often 8 decimals — verify
```

## Rules
- **Never** use a spot/DEX price as an oracle — flash-loanable. Use a Data Feed.
- **Verify the feed address** on the target chain with `cast code` before using it. Don't trust memorized addresses — use the skill's address list.
- Always check `updatedAt` staleness + the feed's heartbeat and decimals.
- VRF/CCIP need funded subscriptions/lanes — track subscription IDs in env per environment.
