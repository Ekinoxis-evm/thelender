// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { KreditoVault } from "../contracts/lendsignal/KreditoVault.sol";
import { KreditoInsurancePool } from "../contracts/lendsignal/KreditoInsurancePool.sol";
import { MockERC20 } from "../contracts/lendsignal/mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

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
        // 1. Asset: a real 6-decimal ERC-20 via KREDITO_ASSET (e.g. Circle Sepolia USDC
        //    0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) — else a fresh mintable mock for local dev.
        //    Only the mock is seeded here; for a real asset the deployer can't mint, so LPs supply
        //    liquidity via the app's Liquidity step and the insurance COVER deposit.
        address override_ = vm.envOr("KREDITO_ASSET", address(0));
        bool mintable = override_ == address(0);
        IERC20 usdc;
        if (mintable) {
            usdc = IERC20(address(new MockERC20("Mock USD Coin", "mUSDC", 6)));
        } else {
            require(override_.code.length > 0, "KREDITO_ASSET has no code");
            require(IERC20Metadata(override_).decimals() == 6, "KREDITO_ASSET must be 6 decimals");
            usdc = IERC20(override_);
        }

        // 2. Lending vault (deployer is the issuer) + 3. insurance reserve (same asset).
        KreditoVault vault = new KreditoVault(usdc, deployer);
        KreditoInsurancePool insurance = new KreditoInsurancePool(usdc);

        // 4. Wire the stack (asset-equality enforced by setInsurancePool/setVault).
        vault.setInsurancePool(address(insurance));
        insurance.setVault(address(vault));

        // 5. Seed ONLY the mintable mock (local). Real asset → unseeded; LPs supply via the app.
        if (mintable) {
            MockERC20(address(usdc)).mint(deployer, SEED_LIQUIDITY);
            usdc.approve(address(vault), SEED_LIQUIDITY);
            vault.deposit(SEED_LIQUIDITY, deployer);
            MockERC20(address(usdc)).mint(deployer, SEED_COVER);
            usdc.approve(address(insurance), SEED_COVER);
            insurance.deposit(SEED_COVER, deployer);
        }

        deployments.push(Deployment("KreditoVault", address(vault)));
        deployments.push(Deployment("KreditoInsurancePool", address(insurance)));

        console.log("== Kredito full stack ==");
        console.log("asset (USDC):", address(usdc));
        console.log("KreditoVault:", address(vault));
        console.log("KreditoInsurancePool:", address(insurance));
        console.log("seeded:", mintable);
    }
}
