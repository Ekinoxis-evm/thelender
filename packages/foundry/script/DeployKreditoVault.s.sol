// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { KreditoCreditVault } from "../contracts/lendsignal/KreditoCreditVault.sol";
import { MockERC20 } from "../contracts/lendsignal/mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Deploys the Kredito issuer-signed credit vault.
 * @dev asset  = a MockERC20 (mUSDC, 6 decimals) for the demo.
 *      vault  = KreditoCreditVault that verifies EIP-712 issuer attestations onchain and
 *               gates undercollateralized borrowing on them. The deployer is set as the
 *               `issuer`, so the demo signing key == deployer.
 *      Liquidity is seeded so the borrow flow is live immediately after deploy.
 *
 * Example:
 *   yarn deploy --file DeployKreditoVault.s.sol
 */
contract DeployKreditoVault is ScaffoldETHDeploy {
    uint256 internal constant SEED_LIQUIDITY = 1_000_000 * 1e6; // 1,000,000 mUSDC (6 decimals)

    function run() external ScaffoldEthDeployerRunner {
        MockERC20 usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        KreditoCreditVault vault = new KreditoCreditVault(IERC20(address(usdc)), deployer);

        // Seed liquidity so borrowers can draw immediately in the demo.
        usdc.mint(deployer, SEED_LIQUIDITY);
        usdc.approve(address(vault), SEED_LIQUIDITY);
        vault.deposit(SEED_LIQUIDITY);
    }
}
