---
description: Pre-deploy gate — verify onchain state, decimals, addresses, secrets, and tests before any deploy.
---

Run the full pre-ship checklist before deploying anything onchain. Do NOT deploy if any item fails — report the failures instead.

1. Invoke the `ethskills:ship` skill and follow its current roadmap for this stage.
2. **Secrets**: `git status` + grep the diff for anything resembling a private key, mnemonic, API key, or `.env` content. Block if found.
3. **Addresses**: for every external protocol/token/feed address the code touches, run `cast code <addr> --rpc-url <chain-rpc>` and confirm bytecode exists on the *target* chain.
4. **Decimals**: confirm token decimals on-chain for every token in math (USDC = 6). Flag any 18-assumption.
5. **Oracles**: confirm no spot/DEX price is used as truth; Chainlink feeds check `updatedAt` staleness + heartbeat.
6. **Tests**: run `forge test -vvv` — all green. Paste the real output.
7. **Gas**: `cast base-fee` on the target chain; note rough deploy cost.
8. Hand off to the `onchain-security-reviewer` agent for an adversarial pass. Block on any Critical/High.

Report a pass/fail table. Only on all-pass, state the exact deploy command but ask for explicit confirmation before running it.

$ARGUMENTS
