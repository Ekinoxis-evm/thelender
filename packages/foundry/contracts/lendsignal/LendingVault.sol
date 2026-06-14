// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ICreditCertificateRegistry } from "./interfaces/ICreditCertificateRegistry.sol";

/// @title LendingVault
/// @author LendSignal
/// @notice Holds LP liquidity and issues undercollateralized working-capital loans, gated
///         by the credit score AND ENS identity in CreditCertificateRegistry (`isEligible`).
///         A built-in protection `reserve` (funded by origination fees / `fundReserve`)
///         absorbs defaults, so the default-fund role lives inside this single contract.
contract LendingVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset; // loan asset, e.g. USDC
    ICreditCertificateRegistry public immutable registry; // credit + ENS gate

    // --- Policy (owner-tunable) ---
    uint256 public originationFeeBps = 300; // 3% of principal, charged at repayment
    uint256 public maxLoanPerBorrower; // 0 = unlimited
    uint32 public maxDurationDays = 90;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_FEE_BPS = 5_000; // hard cap: 50%

    // --- Accounting (in `asset` units) ---
    uint256 public liquidity; // LP capital available to lend
    uint256 public reserve; // default-protection pool
    uint256 public totalOutstanding; // principal currently lent out
    mapping(address => uint256) public lpBalances;

    enum LoanStatus {
        None,
        Requested,
        Active,
        Repaid,
        Defaulted,
        Cancelled
    }

    struct Loan {
        uint256 id;
        address borrower;
        uint256 principal;
        uint256 fee;
        uint256 requestedAt;
        uint256 dueAt;
        string ensName;
        LoanStatus status;
    }

    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) public loans;
    /// @notice One open (requested or active) loan per borrower at a time. 0 = none.
    mapping(address => uint256) public openLoanOf;

    // --- Errors ---
    error ZeroAmount();
    error NotEligible();
    error InsufficientLiquidity();
    error InsufficientLpBalance();
    error InvalidDuration();
    error ExceedsMaxLoan();
    error HasOpenLoan();
    error InvalidLoanState();
    error NotBorrower();
    error InvalidPolicy();

    // --- Events ---
    event Deposited(address indexed lp, uint256 amount);
    event Withdrawn(address indexed lp, uint256 amount);
    event ReserveFunded(address indexed from, uint256 amount);
    event LoanRequested(uint256 indexed loanId, address indexed borrower, uint256 principal, string ensName);
    event LoanPaidOut(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 fee);
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 fee);
    event LoanDefaulted(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 reimbursed);
    event LoanCancelled(uint256 indexed loanId, address indexed borrower);
    event PolicyUpdated(uint256 originationFeeBps, uint256 maxLoanPerBorrower, uint32 maxDurationDays);

    constructor(IERC20 _asset, ICreditCertificateRegistry _registry) Ownable(msg.sender) {
        if (address(_asset) == address(0) || address(_registry) == address(0)) revert ZeroAmount();
        asset = _asset;
        registry = _registry;
    }

    // ---------------------------------------------------------------------
    // Liquidity (LPs)
    // ---------------------------------------------------------------------

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        liquidity += amount;
        lpBalances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > lpBalances[msg.sender]) revert InsufficientLpBalance();
        if (amount > liquidity) revert InsufficientLiquidity();
        lpBalances[msg.sender] -= amount;
        liquidity -= amount;
        asset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function fundReserve(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        reserve += amount;
        emit ReserveFunded(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Borrowing
    // ---------------------------------------------------------------------

    function requestLoan(uint256 amount, uint32 durationDays, string calldata ensName)
        external
        returns (uint256 loanId)
    {
        if (amount == 0) revert ZeroAmount();
        if (durationDays == 0 || durationDays > maxDurationDays) revert InvalidDuration();
        if (maxLoanPerBorrower != 0 && amount > maxLoanPerBorrower) revert ExceedsMaxLoan();
        if (openLoanOf[msg.sender] != 0) revert HasOpenLoan();
        if (!registry.isEligible(msg.sender)) revert NotEligible();

        loanId = nextLoanId++;
        loans[loanId] = Loan({
            id: loanId,
            borrower: msg.sender,
            principal: amount,
            fee: 0,
            requestedAt: block.timestamp,
            dueAt: block.timestamp + uint256(durationDays) * 1 days,
            ensName: ensName,
            status: LoanStatus.Requested
        });
        openLoanOf[msg.sender] = loanId;
        emit LoanRequested(loanId, msg.sender, amount, ensName);
    }

    function cancelLoan(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Requested) revert InvalidLoanState();
        if (msg.sender != loan.borrower && msg.sender != owner()) revert NotBorrower();
        loan.status = LoanStatus.Cancelled;
        openLoanOf[loan.borrower] = 0;
        emit LoanCancelled(loanId, loan.borrower);
    }

    /// @notice Re-check the registry gate (credit score + ENS) and pay out the loan.
    function approveAndPayout(uint256 loanId) external onlyOwner nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Requested) revert InvalidLoanState();
        if (!registry.isEligible(loan.borrower)) revert NotEligible();
        if (loan.principal > liquidity) revert InsufficientLiquidity();

        uint256 fee = (loan.principal * originationFeeBps) / BPS;
        loan.fee = fee;
        loan.status = LoanStatus.Active;

        liquidity -= loan.principal;
        totalOutstanding += loan.principal;

        asset.safeTransfer(loan.borrower, loan.principal);
        emit LoanPaidOut(loanId, loan.borrower, loan.principal, fee);
    }

    /// @notice Borrower repays principal + fee. Principal returns to the LP pool; the fee
    ///         strengthens the protection reserve.
    function repay(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert InvalidLoanState();
        if (msg.sender != loan.borrower) revert NotBorrower();

        uint256 principal = loan.principal;
        uint256 fee = loan.fee;

        asset.safeTransferFrom(msg.sender, address(this), principal + fee);
        loan.status = LoanStatus.Repaid;

        liquidity += principal;
        reserve += fee;
        totalOutstanding -= principal;
        openLoanOf[loan.borrower] = 0;

        emit LoanRepaid(loanId, loan.borrower, principal, fee);
    }

    /// @notice Flag an active loan as defaulted and reimburse the LP pool from the reserve.
    function markDefault(uint256 loanId) external onlyOwner nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert InvalidLoanState();
        loan.status = LoanStatus.Defaulted;
        totalOutstanding -= loan.principal;
        openLoanOf[loan.borrower] = 0;

        uint256 coverage = loan.principal <= reserve ? loan.principal : reserve;
        if (coverage > 0) {
            reserve -= coverage;
            liquidity += coverage;
        }
        emit LoanDefaulted(loanId, loan.borrower, loan.principal, coverage);
    }

    // ---------------------------------------------------------------------
    // Views & admin
    // ---------------------------------------------------------------------

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    function isApprovable(address borrower) external view returns (bool) {
        return registry.isEligible(borrower);
    }

    function setPolicy(uint256 _originationFeeBps, uint256 _maxLoanPerBorrower, uint32 _maxDurationDays)
        external
        onlyOwner
    {
        if (_originationFeeBps > MAX_FEE_BPS || _maxDurationDays == 0) revert InvalidPolicy();
        originationFeeBps = _originationFeeBps;
        maxLoanPerBorrower = _maxLoanPerBorrower;
        maxDurationDays = _maxDurationDays;
        emit PolicyUpdated(_originationFeeBps, _maxLoanPerBorrower, _maxDurationDays);
    }
}
