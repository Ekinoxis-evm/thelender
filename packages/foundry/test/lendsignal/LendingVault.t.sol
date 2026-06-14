// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { LendingVault } from "../../contracts/lendsignal/LendingVault.sol";
import { CreditCertificateRegistry } from "../../contracts/lendsignal/CreditCertificateRegistry.sol";
import { CreditTypes } from "../../contracts/lendsignal/libraries/CreditTypes.sol";
import { MockERC20 } from "../../contracts/lendsignal/mocks/MockERC20.sol";

contract LendingVaultTest is Test {
    MockERC20 internal usdc;
    CreditCertificateRegistry internal registry;
    LendingVault internal vault;

    address internal lp = address(this);
    address internal borrower = address(0xB0B);

    uint256 internal constant UNIT = 1e6; // 6-decimal asset
    uint256 internal constant DEPOSIT = 100_000 * UNIT;
    uint256 internal constant LOAN = 10_000 * UNIT;

    function setUp() public {
        vm.warp(1_000_000);
        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        registry = new CreditCertificateRegistry(address(this)); // issuer = this
        vault = new LendingVault(IERC20(address(usdc)), registry);

        usdc.mint(lp, DEPOSIT);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(DEPOSIT);
    }

    function _certify(address who, uint256 ai, uint256 bureau) internal {
        registry.issueCertificate(
            who,
            CreditTypes.ScoreInputs({
                confidentialAiScore: ai,
                bureauScore: bureau,
                attestationHash: keccak256("att"),
                bureauReportHash: keccak256("rep"),
                evidenceDigest: keccak256("ev"),
                expiresAt: block.timestamp + 30 days
            })
        );
    }

    function test_FullLoanLifecycle_RequestPayoutRepay() public {
        _certify(borrower, 840, 782);

        vm.prank(borrower);
        uint256 loanId = vault.requestLoan(LOAN, 30, "bob.eth");
        vault.approveAndPayout(loanId); // owner = this

        assertEq(usdc.balanceOf(borrower), LOAN, "funded");
        assertEq(vault.liquidity(), DEPOSIT - LOAN, "liquidity reduced");
        assertEq(vault.totalOutstanding(), LOAN, "outstanding");

        uint256 fee = (LOAN * 300) / 10_000; // 3%
        usdc.mint(borrower, fee);
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        vault.repay(loanId);
        vm.stopPrank();

        assertEq(vault.liquidity(), DEPOSIT, "principal returned");
        assertEq(vault.reserve(), fee, "fee to reserve");
        assertEq(vault.totalOutstanding(), 0, "nothing outstanding");
    }

    function test_IneligibleBorrowerCannotRequest() public {
        vm.prank(borrower);
        vm.expectRevert(LendingVault.NotEligible.selector);
        vault.requestLoan(LOAN, 30, "bob.eth");
    }

    function test_DefaultIsCoveredByReserve() public {
        _certify(borrower, 840, 782);
        usdc.mint(lp, LOAN);
        vault.fundReserve(LOAN);

        vm.prank(borrower);
        uint256 loanId = vault.requestLoan(LOAN, 30, "bob.eth");
        vault.approveAndPayout(loanId);

        uint256 liqBefore = vault.liquidity();
        vault.markDefault(loanId);

        assertEq(vault.reserve(), 0, "reserve drained");
        assertEq(vault.liquidity(), liqBefore + LOAN, "LP reimbursed");
        assertEq(vault.totalOutstanding(), 0, "not outstanding");
    }

    function test_RevokedCertificateBlocksPayout() public {
        _certify(borrower, 840, 782);
        vm.prank(borrower);
        uint256 loanId = vault.requestLoan(LOAN, 30, "bob.eth");

        registry.revokeCertificate(borrower);

        vm.expectRevert(LendingVault.NotEligible.selector);
        vault.approveAndPayout(loanId);
    }

    function test_OneOpenLoanPerBorrower() public {
        _certify(borrower, 840, 782);
        vm.startPrank(borrower);
        vault.requestLoan(LOAN, 30, "bob.eth");
        vm.expectRevert(LendingVault.HasOpenLoan.selector);
        vault.requestLoan(LOAN, 30, "bob.eth");
        vm.stopPrank();
    }
}
