---
description: Cleanly verify a deployed contract on Etherscan (V2, one multichain key) via Foundry.
---

Verify a deployed contract on a block explorer using Foundry's Etherscan V2 integration (a single `ETHERSCAN_API_KEY` works across all supported chains).

Inputs from $ARGUMENTS: the deployed **address**, the **contract** (`contracts/Foo.sol:Foo`), the **chain** (alias from `packages/foundry/foundry.toml`, e.g. `base`), and any **constructor args**.

> SE-2 also auto-verifies on deploy via `yarn deploy --network <net> --verify` (runs `VerifyAll.s.sol`). Use this command for contracts deployed earlier or that need re-verification.

Steps:
1. Confirm `ETHERSCAN_API_KEY` is set (in `packages/foundry/.env` / shell) and the chain alias exists in `packages/foundry/foundry.toml`.
2. Ensure reproducible bytecode: `foundry.toml` already pins `bytecode_hash = "none"` and `cbor_metadata = false`. Rebuild with `yarn compile` so local bytecode matches on-chain.
3. Run from `packages/foundry/`:
   ```bash
   forge verify-contract <ADDRESS> contracts/<Contract>.sol:<Name> \
     --chain <alias> --watch \
     --constructor-args $(cast abi-encode "constructor(<types>)" <args>)
   ```
   - Omit `--constructor-args` if the constructor takes none.
   - Add `--verifier blockscout --verifier-url <url>/api` instead of Etherscan to verify on a Blockscout instance.
4. Report the verification status and the explorer URL. If it fails with a bytecode mismatch, check `solc_version`, `optimizer_runs`, and that the source matches the deployed commit.

Note: `forge create --verify` / `forge script --verify` verify automatically at deploy time — use this command for contracts deployed earlier or that need re-verification.
