// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { KreditoVault } from "../contracts/lendsignal/KreditoVault.sol";
import { KreditoInsurancePool } from "../contracts/lendsignal/KreditoInsurancePool.sol";
import { MockERC20 } from "../contracts/lendsignal/mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Deploys the full Kredito installment-lending stack and wires it together.
 * @dev Contracts:
 *      - usdc      = MockERC20 (mUSDC, 6 decimals) — the shared stablecoin asset.
 *      - vault     = KreditoVault — ERC-4626 + ERC-7540 async redeem + EIP-712 attestation-gated
 *                    installment lending. Deployer = `issuer` (demo signing key == deployer).
 *      - insurance = KreditoInsurancePool — ERC-4626 COVER-share reserve, paid on default, fed the
 *                    protocol fee.
 *
 *      Loans are tracked by the vault's own loan mapping; the borrower's <label>.kredito.eth ENS
 *      identity is the credential (no loan NFT).
 *
 *      Wiring (CEI of ownership): vault.setInsurancePool, insurance.setVault.
 *      Both pools are seeded so borrowing + default coverage are live immediately.
 *
 *      Does NOT modify DeployKreditoVault.s.sol / DeployKreditoVaultV2.s.sol.
 *
 * Example:
 *   yarn deploy --file DeployKreditoFullStack.s.sol
 */
contract DeployKreditoFullStack is ScaffoldETHDeploy {
    uint256 internal constant SEED_LIQUIDITY = 1_000_000 * 1e6; // 1,000,000 mUSDC (6 decimals)
    uint256 internal constant SEED_COVER = 500_000 * 1e6; // 500,000 mUSDC reserves

    function run() external ScaffoldEthDeployerRunner {
        // 1. Shared stablecoin.
        MockERC20 usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);

        // 2. Lending vault (deployer is the issuer).
        KreditoVault vault = new KreditoVault(IERC20(address(usdc)), deployer);

        // 3. Insurance reserve pool (same asset).
        KreditoInsurancePool insurance = new KreditoInsurancePool(IERC20(address(usdc)));

        // 4. Wire the stack.
        vault.setInsurancePool(address(insurance));
        insurance.setVault(address(vault));

        // 5. Seed the lending vault (deployer = first LP).
        usdc.mint(deployer, SEED_LIQUIDITY);
        usdc.approve(address(vault), SEED_LIQUIDITY);
        vault.deposit(SEED_LIQUIDITY, deployer);

        // 6. Seed the insurance pool (deployer = first COVER LP) so the cover-ratio gate passes and
        //    defaults can be covered immediately.
        usdc.mint(deployer, SEED_COVER);
        usdc.approve(address(insurance), SEED_COVER);
        insurance.deposit(SEED_COVER, deployer);
    }
}
