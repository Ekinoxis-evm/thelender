---
description: Run the full CI suite locally (contracts + app) before pushing.
---

Run the same checks CI runs, locally (yarn-4 monorepo), and report a pass/fail table.

From the repo root:
1. `yarn foundry:format --check`
2. `yarn foundry:test`
3. `yarn next:lint`
4. `yarn next:check-types`
5. `yarn next:build`

**Secrets** (always): grep the diff / staged files for anything resembling a private key, mnemonic, `proapi_`, JWT, or `.env` value. Block if found.

Report each step's real output and a final ✅/❌ table. If anything fails, fix it (or hand contract failures to the `solidity-engineer` agent) before suggesting a push. $ARGUMENTS
