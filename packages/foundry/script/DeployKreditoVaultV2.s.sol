// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { KreditoVault } from "../contracts/lendsignal/KreditoVault.sol";
import { MockERC20 } from "../contracts/lendsignal/mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @notice Deploys the Kredito ERC-4626 + ERC-7540 (async redeem) lending vault, resolving the
 *         underlying asset (USDC) per chain instead of always deploying a MockERC20.
 *
 * @dev asset  = resolved by `block.chainid` (see `_resolveAsset`):
 *               - Local anvil (31337): a fresh MockERC20 (mUSDC, 6 decimals), minted + seeded so the
 *                 borrow flow is live immediately for local dev.
 *               - Sepolia (11155111): Circle's official testnet USDC (6 decimals). It is NOT mintable
 *                 by us, so no seeding happens — fund the vault with the Circle faucet
 *                 (https://faucet.circle.com) post-deploy, or set KREDITO_ASSET to a mintable mock.
 *               - Mainnet (1): canonical Circle USDC (6 decimals). No seeding.
 *               - Any chain: `KREDITO_ASSET` env override wins (operator-verified address).
 *               - Otherwise: revert (never silently deploy a Mock on a real network).
 *      vault  = KreditoVault — an ERC-4626 tokenized vault (LP capital) that is ALSO an
 *               attestation-gated lender with ERC-7540 asynchronous redeem. The deployer is set
 *               as `issuer`, so the demo signing key == deployer.
 *
 * Supersedes the deprecated KreditoCreditVault deploy (removed). For the full lending stack
 * (vault + insurance pool, wired) use DeployKreditoFullStack.s.sol.
 *
 * Example:
 *   yarn deploy --file DeployKreditoVaultV2.s.sol
 *   KREDITO_ASSET=0x... yarn deploy --file DeployKreditoVaultV2.s.sol --network sepolia
 *
 * --- Onchain address provenance (verified live with cast on 2026-06-14; see PR notes) ---
 *  Mainnet (1)       USDC  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
 *      cast code <addr> --rpc-url https://ethereum-rpc.publicnode.com          -> non-empty bytecode
 *      cast call <addr> "decimals()(uint8)" ...                                -> 6
 *      cast call <addr> "symbol()(string)" ...                                 -> "USDC"
 *  Sepolia (11155111) USDC 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 (Circle official testnet USDC)
 *      cast code <addr> --rpc-url https://ethereum-sepolia-rpc.publicnode.com  -> non-empty bytecode
 *      cast call <addr> "decimals()(uint8)" ...                                -> 6
 *      cast call <addr> "symbol()(string)" ...                                 -> "USDC"
 */
contract DeployKreditoVaultV2 is ScaffoldETHDeploy {
    uint256 internal constant ANVIL_CHAIN_ID = 31337;
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;
    uint256 internal constant MAINNET_CHAIN_ID = 1;

    /// @dev Canonical Circle USDC, 6 decimals. Verified onchain — see header for cast commands.
    address internal constant MAINNET_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    /// @dev Circle's OFFICIAL Sepolia testnet USDC (faucet: faucet.circle.com), 6 decimals. Verified.
    address internal constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    uint256 internal constant SEED_LIQUIDITY = 1_000_000 * 1e6; // 1,000,000 mUSDC (6 decimals)

    error UnsupportedChain(uint256 chainId);
    error AssetNotAContract(address asset);
    error UnexpectedDecimals(address asset, uint8 decimals);

    function run() external ScaffoldEthDeployerRunner {
        (IERC20 asset, bool mintable) = _resolveAsset();

        KreditoVault vault = new KreditoVault(asset, deployer);

        // Seed liquidity ONLY when we control a mintable mock (local dev). For real USDC the deployer
        // cannot mint; the operator funds the vault out-of-band (Circle faucet on Sepolia / real USDC
        // on mainnet) and the first LP deposits via the ERC-4626 deposit() path.
        if (mintable) {
            MockERC20(address(asset)).mint(deployer, SEED_LIQUIDITY);
            IERC20(address(asset)).approve(address(vault), SEED_LIQUIDITY);
            vault.deposit(SEED_LIQUIDITY, deployer);
        }

        deployments.push(Deployment({ name: "KreditoVault", addr: address(vault) }));
    }

    /// @dev Resolve the vault's underlying asset for the current chain.
    /// @return asset    The ERC20 the vault will use.
    /// @return mintable True only for the locally deployed MockERC20 (drives demo seeding).
    function _resolveAsset() internal returns (IERC20 asset, bool mintable) {
        // Escape hatch: an operator-verified address overrides everything, on any chain.
        address override_ = vm.envOr("KREDITO_ASSET", address(0));
        if (override_ != address(0)) {
            _assertUsdcLike(override_);
            return (IERC20(override_), false);
        }

        if (block.chainid == ANVIL_CHAIN_ID) {
            // Local dev: a fresh mintable mock so the demo is faucet-free and self-seeding.
            MockERC20 usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
            return (IERC20(address(usdc)), true);
        }

        if (block.chainid == SEPOLIA_CHAIN_ID) {
            _assertUsdcLike(SEPOLIA_USDC);
            return (IERC20(SEPOLIA_USDC), false);
        }

        if (block.chainid == MAINNET_CHAIN_ID) {
            _assertUsdcLike(MAINNET_USDC);
            return (IERC20(MAINNET_USDC), false);
        }

        revert UnsupportedChain(block.chainid);
    }

    /// @dev Defense-in-depth: never trust a hardcoded/override address blindly. Confirm there is
    ///      bytecode at the address and that it reports 6 decimals (USDC). This runs against live
    ///      chain state at deploy time, catching a wrong network, a not-yet-deployed token, or a
    ///      mis-decimaled override before any value flows.
    function _assertUsdcLike(address asset) internal view {
        if (asset.code.length == 0) revert AssetNotAContract(asset);
        uint8 dec = IERC20Metadata(asset).decimals();
        if (dec != 6) revert UnexpectedDecimals(asset, dec);
    }
}
