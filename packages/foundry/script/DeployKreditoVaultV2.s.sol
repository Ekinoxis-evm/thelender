// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { KreditoVault } from "../contracts/lendsignal/KreditoVault.sol";
import { MockERC20 } from "../contracts/lendsignal/mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Deploys the Kredito ERC-4626 + ERC-7540 (async redeem) lending vault.
 * @dev asset  = a MockERC20 (mUSDC, 6 decimals) for the demo.
 *      vault  = KreditoVault — an ERC-4626 tokenized vault (LP capital) that is ALSO an
 *               attestation-gated lender with ERC-7540 asynchronous redeem. The deployer is set
 *               as `issuer`, so the demo signing key == deployer.
 *      Liquidity is seeded via the ERC-4626 `deposit(assets, receiver)` flow (deployer becomes the
 *      first LP and receives shares), so the borrow flow is live immediately after deploy.
 *
 * Supersedes DeployKreditoVault.s.sol (KreditoCreditVault). That script is left untouched.
 *
 * Example:
 *   yarn deploy --file DeployKreditoVaultV2.s.sol
 */
contract DeployKreditoVaultV2 is ScaffoldETHDeploy {
    uint256 internal constant SEED_LIQUIDITY = 1_000_000 * 1e6; // 1,000,000 mUSDC (6 decimals)

    function run() external ScaffoldEthDeployerRunner {
        MockERC20 usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        KreditoVault vault = new KreditoVault(IERC20(address(usdc)), deployer);

        // Seed liquidity via the ERC-4626 deposit path: deployer is the first LP and receives shares.
        usdc.mint(deployer, SEED_LIQUIDITY);
        usdc.approve(address(vault), SEED_LIQUIDITY);
        vault.deposit(SEED_LIQUIDITY, deployer);
    }
}
