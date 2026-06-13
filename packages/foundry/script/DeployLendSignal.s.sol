// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { CreditCertificateRegistry } from "../contracts/lendsignal/CreditCertificateRegistry.sol";
import { LendingVault } from "../contracts/lendsignal/LendingVault.sol";
import { MockERC20 } from "../contracts/lendsignal/mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Deploys the LendSignal credit layer.
 * @dev registry = credit score + ENS gate + soulbound NFT (contract #1).
 *      vault    = score-gated undercollateralized loans + default reserve (contract #2).
 *      asset    = a MockERC20 (mUSDC) for demo. The deployer is set as the issuer so it can
 *                 issue certificates in the demo flow.
 *
 * Example:
 *   yarn deploy --file DeployLendSignal.s.sol
 */
contract DeployLendSignal is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        CreditCertificateRegistry registry = new CreditCertificateRegistry(deployer);
        MockERC20 usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        new LendingVault(IERC20(address(usdc)), registry);
    }
}
