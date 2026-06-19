"use client";

import { useEffect, useState } from "react";
import { decodeEventLog, encodeFunctionData, formatUnits, parseUnits } from "viem";
import { usePublicClient, useReadContract } from "wagmi";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  BanknotesIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { PageHeader, Panel } from "~~/components/kredito";
import { Stat, ZERO_ADDR } from "~~/components/kredito/flowBits";
import { useSmartWalletAddress, useSponsoredWrite } from "~~/hooks/scaffold-eth/useSmartWallet";
import { toTypedMessage } from "~~/kredito/attestation";
import { formatUsd } from "~~/kredito/format";
import type { StoredScore } from "~~/kredito/scoreStore";
import {
  ERC20_ABI,
  KREDITO_VAULT_ADDRESS,
  LOAN_STATUS_LABEL,
  type SignedAttestation,
  VAULT_ABI,
  VAULT_CHAIN_ID,
  type VaultLoan,
  sepoliaTxUrl,
} from "~~/kredito/vault";
import { creditLimitUsd } from "~~/lib/kredito";
import { MIN_ELIGIBLE_SCORE } from "~~/services/lendsignal/score";
import { getParsedError, notification } from "~~/utils/scaffold-eth";

// Equal-principal amortization preview (mirrors the vault: principal/term per installment +
// interest on the OUTSTANDING balance; the final installment clears the remainder).
const amortizationPreview = (principalUnits: bigint, termMonths: number, annualRateBps: number) => {
  if (principalUnits <= 0n || termMonths <= 0) return null;
  const term = BigInt(termMonths);
  const perInstallment = principalUnits / term;
  // First installment interest (interest on the full balance) — the headline "≈ /mo".
  const firstInterest = (principalUnits * BigInt(annualRateBps)) / (10_000n * 12n);
  const firstPayment = perInstallment + firstInterest;
  // Total interest across the schedule (sum over a declining balance).
  let outstanding = principalUnits;
  let totalInterest = 0n;
  for (let i = 0; i < termMonths; i++) {
    const interest = (outstanding * BigInt(annualRateBps)) / (10_000n * 12n);
    totalInterest += interest;
    const principalDue = i + 1 >= termMonths || perInstallment > outstanding ? outstanding : perInstallment;
    outstanding -= principalDue;
  }
  return { perInstallment, firstInterest, firstPayment, totalInterest };
};

export const BorrowSection = ({
  result,
  borrower,
  att,
  onBack,
  onNext,
  // In the dashboard the borrow view is standalone — hide the wizard footer nav.
  embedded = false,
  onReSign,
}: {
  result: StoredScore | null;
  borrower: `0x${string}`;
  att: SignedAttestation | null;
  onBack?: () => void;
  onNext?: () => void;
  embedded?: boolean;
  // Dashboard callback to (re)sign an attestation when none is in state.
  onReSign?: () => void;
}) => {
  const configured = KREDITO_VAULT_ADDRESS.length > 0;
  const vault = configured ? (KREDITO_VAULT_ADDRESS as `0x${string}`) : undefined;
  const { writeContractSponsored, sendCalls } = useSponsoredWrite();
  // The SMART WALLET is the borrower: it signs the attestation's `borrower` field, receives the
  // disbursement and pays installments. Reads are scoped to it so balances reflect the smart account.
  const smartWallet = useSmartWalletAddress();
  const account = smartWallet ?? (borrower !== ZERO_ADDR ? borrower : undefined);
  const publicClient = usePublicClient({ chainId: VAULT_CHAIN_ID });

  // --- Onchain reads (Sepolia). Disabled until the vault address is configured. ---
  const { data: liquidity, refetch: refetchLiquidity } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "idleLiquidity",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured },
  });
  const { data: minScoreData } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "minScore",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured },
  });
  const { data: assetAddr } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "asset",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured },
  });
  const { data: minTermData } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "MIN_TERM_MONTHS",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured },
  });
  const { data: maxTermData } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "MAX_TERM_MONTHS",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured },
  });
  const { data: decimalsData } = useReadContract({
    address: assetAddr,
    abi: ERC20_ABI,
    functionName: "decimals",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: !!assetAddr },
  });
  const { data: symbolData } = useReadContract({
    address: assetAddr,
    abi: ERC20_ABI,
    functionName: "symbol",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: !!assetAddr },
  });

  const dec = typeof decimalsData === "number" ? decimalsData : 6;
  const sym = typeof symbolData === "string" ? symbolData : "USDC";
  const liqUnits = typeof liquidity === "bigint" ? liquidity : 0n;
  const liq = Number(formatUnits(liqUnits, dec));
  // Single source of truth for the off-chain threshold — never a magic 600.
  const minScore = result?.minEligibleScore ?? MIN_ELIGIBLE_SCORE;
  // The borrow gate is whatever the vault enforces onchain; fall back to the shared off-chain min.
  const floor = typeof minScoreData === "bigint" ? Number(minScoreData) : minScore;
  const minTerm = typeof minTermData === "bigint" ? Number(minTermData) : 6;
  const maxTerm = typeof maxTermData === "bigint" ? Number(maxTermData) : 36;

  const score = att?.attestation.score ?? result?.combinedScore ?? 0;
  // The vault locks the APR by attestation riskTier (2/low -> tierToRateBps[1]=10%; 1/medium ->
  // tierToRateBps[2]=14%). Default rates mirror the vault constructor; the schedule is illustrative.
  const annualRateBps = att?.attestation.riskTier === 2 ? 1000 : att?.attestation.riskTier === 1 ? 1400 : 0;
  // Credit limit in base units. Once signed, the attestation's maxPrincipal is authoritative; before
  // signing, show the score-derived limit so a pre-qualified borrower sees their prospective offer
  // (not a confusing $0). USDC 6-decimals.
  const limitUnits = att
    ? att.attestation.maxPrincipal
    : score >= floor
      ? parseUnits(String(creditLimitUsd(score)), dec)
      : 0n;
  const limitUsd = Number(formatUnits(limitUnits, dec));
  // Borrowable cap = min(credit limit, idle liquidity).
  const maxBorrowUnits = limitUnits < liqUnits ? limitUnits : liqUnits;
  const maxBorrow = Number(formatUnits(maxBorrowUnits, dec));

  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState(minTerm);
  const [borrowing, setBorrowing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [loanId, setLoanId] = useState<bigint | null>(null);
  const [loanTx, setLoanTx] = useState<{ hash: string; amount: string } | null>(null);
  // Expiry uses Date.now() (impure at render) → evaluate it in an effect.
  const [expired, setExpired] = useState(false);

  // Read the originated loan once we know its id.
  const { data: loanData, refetch: refetchLoan } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "getLoan",
    args: loanId !== null ? [loanId] : undefined,
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured && loanId !== null },
  });
  const loan = loanData as VaultLoan | undefined;

  useEffect(() => {
    setTerm(t => (t < minTerm ? minTerm : t > maxTerm ? maxTerm : t));
  }, [minTerm, maxTerm]);

  useEffect(() => {
    if (maxBorrow > 0) setAmount(a => a || String(Math.floor(maxBorrow)));
  }, [maxBorrow]);

  useEffect(() => {
    setExpired(!!att && att.attestation.expiresAt <= Math.floor(Date.now() / 1000));
  }, [att]);

  // Mirrors the vault's isEligible (the contract is the real gate; this drives the UI).
  const eligible = !!att && att.attestation.score >= floor && att.attestation.riskTier !== 0 && !expired;
  // Score-eligible = the user CAN borrow once they sign. Used to avoid showing a "Not eligible"
  // rejection to a verified borrower who simply hasn't signed the (free) attestation yet.
  const scoreEligible = score >= floor;
  const noLiquidity = configured && liqUnits === 0n;

  // The amount the user typed, in base units (for the preview + the borrow tx).
  const parsedAmount = (() => {
    try {
      return parseUnits((amount || "0").replace(/,/g, ""), dec);
    } catch {
      return 0n;
    }
  })();
  const preview = amortizationPreview(parsedAmount, term, annualRateBps);

  // The next installment's amount (principal + interest [+ late fee]) for the approve+pay batch.
  // We add a small headroom for the optional 5% grace late fee so the approval always covers it.
  const installmentDue = (() => {
    if (!loan || loan.principal <= 0n) return 0n;
    const interest = (loan.principal * loan.annualRateBps) / (10_000n * 12n);
    const isLast = loan.paymentsMade + 1n >= loan.termMonths || loan.principalPerInstallment > loan.principal;
    const principalDue = isLast ? loan.principal : loan.principalPerInstallment;
    const base = principalDue + interest;
    // Cover a possible 5% late fee (grace) so the single approval never under-approves.
    return base + (base * 500n) / 10_000n;
  })();

  const doBorrow = async () => {
    if (!vault || !att) {
      notification.error("Sign your credit attestation first.");
      return;
    }
    if (parsedAmount <= 0n) {
      notification.error("Enter an amount to borrow.");
      return;
    }
    if (parsedAmount > att.attestation.maxPrincipal) {
      notification.error("Amount exceeds your credit limit.");
      return;
    }
    if (parsedAmount > liqUnits) {
      notification.error("Amount exceeds available pool liquidity.");
      return;
    }
    if (term < minTerm || term > maxTerm) {
      notification.error(`Term must be between ${minTerm} and ${maxTerm} months.`);
      return;
    }
    setBorrowing(true);
    try {
      const hash = await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "borrow",
        args: [toTypedMessage(att.attestation), att.signature, parsedAmount, BigInt(term)],
      });
      setLoanTx({ hash, amount });
      notification.success("Loan disbursed onchain (gas-sponsored)");

      // Recover the loanId from the LoanIssued event in the tx receipt (the borrow return value is
      // not surfaced by a UserOperation, so decode the emitted event instead).
      try {
        const receipt = await publicClient?.waitForTransactionReceipt({ hash });
        const issued = receipt?.logs
          .map(log => {
            try {
              return decodeEventLog({ abi: VAULT_ABI, data: log.data, topics: log.topics });
            } catch {
              return null;
            }
          })
          .find(d => d?.eventName === "LoanIssued");
        if (issued && "args" in issued) {
          const id = (issued.args as { loanId: bigint }).loanId;
          setLoanId(id);
        }
      } catch {
        // Best-effort — the schedule panel just won't auto-show; reads still recover on next render.
      }
      void refetchLiquidity();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBorrowing(false);
    }
  };

  const doPay = async () => {
    if (!vault || !assetAddr || !loan || loanId === null || installmentDue <= 0n) return;
    setPaying(true);
    try {
      // Atomic approve + makePayment in one sponsored UserOperation.
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [vault, installmentDue],
      });
      const payData = encodeFunctionData({ abi: VAULT_ABI, functionName: "makePayment", args: [loanId] });
      await sendCalls([
        { to: assetAddr, data: approveData },
        { to: vault, data: payData },
      ]);
      notification.success("Installment paid — principal reduced");
      void refetchLoan();
      void refetchLiquidity();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setPaying(false);
    }
  };

  const hasActiveLoan = !!loan && (loan.status === 1 || loan.status === 2);

  return (
    <>
      <PageHeader
        step={embedded ? undefined : 5}
        eyebrow="Working-capital loan"
        title="Borrow against your attestation"
        subtitle="The vault verifies the issuer-signed attestation onchain (recover == issuer, score ≥ minimum, unexpired) and disburses an undercollateralized installment loan. Gas is sponsored."
      />

      {!configured ? (
        <>
          <div className="alert alert-info mb-5">
            <BanknotesIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Lending vault not configured</p>
              <p className="text-sm opacity-80">
                Set <code>NEXT_PUBLIC_KREDITO_VAULT</code> to the deployed vault to enable onchain borrowing.
              </p>
            </div>
          </div>
          <Panel eyebrow="Onchain" title="Vault not configured">
            <p className="text-sm text-base-content/70">
              Deploy the vault and set <code>NEXT_PUBLIC_KREDITO_VAULT</code> to enable onchain borrowing:
            </p>
            <code className="k-mono text-xs break-all block bg-base-200 rounded-field p-2 mt-2">
              yarn deploy --file DeployKreditoVaultV2.s.sol --network sepolia
            </code>
            <div className="grid sm:grid-cols-3 gap-4 mt-4">
              <Stat label="Credit limit" value={formatUsd(limitUsd)} />
              <Stat label="Your score" value={String(score)} />
              <Stat label="Min score" value={String(minScore)} />
            </div>
          </Panel>
        </>
      ) : (
        <div className="space-y-4">
          <Panel
            eyebrow="Onchain offer · Sepolia"
            title="Your borrowing offer"
            action={
              att ? (
                eligible ? (
                  <span className="badge badge-success gap-1">
                    <CheckCircleIcon className="h-3.5 w-3.5" aria-hidden="true" /> Eligible
                  </span>
                ) : (
                  <span className="badge badge-error">Not eligible</span>
                )
              ) : scoreEligible ? (
                <span className="badge badge-success badge-outline">Pre-qualified</span>
              ) : (
                <span className="badge badge-error">Not eligible</span>
              )
            }
          >
            {/* Headline: the one number that matters — how much they can draw right now. */}
            <div className="rounded-field border border-base-300 bg-base-200/40 px-4 py-4">
              <p className="k-eyebrow mb-1">Available to borrow</p>
              <p className="k-display tabular-nums leading-none">
                {formatUsd(maxBorrow)} <span className="text-base-content/50 text-2xl">{sym}</span>
              </p>
              <p className="text-xs text-base-content/50 mt-1.5">
                The lesser of your credit limit and current pool liquidity.
              </p>
            </div>

            <div className="grid sm:grid-cols-3 gap-4 mt-4">
              <Stat label="Pool liquidity" value={`${formatUsd(liq)} ${sym}`} />
              <Stat label="Credit limit" value={formatUsd(limitUsd)} />
              <Stat label="Your score" value={String(score)} />
            </div>

            {/* Sign is FREE and unlocks the offer — make it the primary CTA, not a tucked-away warning.
                Only call it a rejection when the score genuinely falls below the threshold. */}
            {!att && scoreEligible && onReSign && (
              <div className="mt-4 rounded-field border border-primary/30 bg-primary/5 px-4 py-3">
                <p className="text-sm font-medium">Sign a free message to unlock your borrowing offer</p>
                <p className="text-xs text-base-content/55 mt-0.5">No gas, no cost — it just proves wallet control.</p>
                <button type="button" className="btn btn-primary btn-sm w-full gap-1 mt-3" onClick={onReSign}>
                  <ShieldCheckIcon className="h-4 w-4" aria-hidden="true" /> Sign attestation
                </button>
              </div>
            )}
            {!att && !scoreEligible && (
              <div className="mt-4 rounded-field bg-error/10 text-error text-sm px-3 py-2">
                Your score of <span className="k-mono tabular-nums">{score}</span> is below the{" "}
                <span className="k-mono tabular-nums">{floor}</span> minimum required to borrow.
              </div>
            )}
            {att && !eligible && (
              <div className="mt-4 rounded-field bg-error/10 text-error text-sm px-3 py-2">
                {expired
                  ? "Your attestation has expired — re-sign a fresh one to borrow."
                  : `Not eligible: the vault requires a score of at least ${floor}.`}
              </div>
            )}
            {att && eligible && noLiquidity && (
              <div className="mt-4 rounded-field bg-warning/10 text-warning text-sm px-3 py-2">
                No liquidity yet — supply via the Liquidity step first, then borrow.
              </div>
            )}
          </Panel>

          {hasActiveLoan ? (
            <Panel
              eyebrow="Active loan"
              title={`Loan #${loanId !== null ? String(loanId) : "—"}`}
              action={
                <span className={`badge ${loan?.status === 2 ? "badge-warning" : "badge-success"}`}>
                  {LOAN_STATUS_LABEL[loan?.status ?? 1]}
                </span>
              }
            >
              <div className="grid sm:grid-cols-4 gap-4">
                <Stat
                  label="Outstanding"
                  value={`${formatUsd(loan ? Number(formatUnits(loan.principal, dec)) : 0)} ${sym}`}
                />
                <Stat
                  label="Original"
                  value={`${formatUsd(loan ? Number(formatUnits(loan.originalPrincipal, dec)) : 0)} ${sym}`}
                />
                <Stat
                  label="Payments"
                  value={loan ? `${String(loan.paymentsMade)} / ${String(loan.termMonths)}` : "—"}
                />
                <Stat label="APR" value={loan ? `${Number(loan.annualRateBps) / 100}%` : "—"} />
              </div>
              <div className="mt-4 rounded-field border border-base-300 px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="k-eyebrow mb-0.5">Next installment (max)</p>
                  <p className="k-mono text-lg font-semibold tabular-nums">
                    {formatUsd(Number(formatUnits(installmentDue, dec)))} {sym}
                  </p>
                  <p className="text-xs text-base-content/50">principal + interest (incl. grace late-fee headroom)</p>
                </div>
                <button className="btn btn-primary btn-sm gap-1" onClick={doPay} disabled={paying} type="button">
                  {paying ? (
                    <>
                      <span className="loading loading-spinner loading-xs" /> Paying…
                    </>
                  ) : (
                    <>Pay installment (sponsored)</>
                  )}
                </button>
              </div>
              <p className="text-xs text-base-content/50 mt-2">
                Pay batches approve + makePayment into one sponsored UserOperation.
              </p>
              {loanTx && (
                <a
                  href={sepoliaTxUrl(loanTx.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="link k-mono text-xs break-all inline-flex items-center gap-1 mt-2"
                >
                  Origination tx <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </a>
              )}
            </Panel>
          ) : (
            <Panel eyebrow="Draw" title="Borrow">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="k-eyebrow">Amount ({sym})</span>
                  <div className="mt-1 flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 focus-within:border-primary transition-colors">
                    <input
                      inputMode="decimal"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0"
                      className="w-full bg-transparent py-2.5 outline-none text-sm k-mono"
                    />
                    <button
                      type="button"
                      className="text-xs link shrink-0"
                      onClick={() => setAmount(String(Math.floor(maxBorrow)))}
                    >
                      Max {formatUsd(maxBorrow)}
                    </button>
                  </div>
                </label>
                <label className="block">
                  <span className="k-eyebrow">
                    Term — {minTerm}–{maxTerm} months
                  </span>
                  <select
                    value={term}
                    onChange={e => setTerm(Number(e.target.value))}
                    className="select select-bordered mt-1 w-full text-sm font-normal"
                  >
                    {Array.from({ length: Math.max(0, maxTerm - minTerm + 1) }, (_, i) => minTerm + i).map(m => (
                      <option key={m} value={m}>
                        {m} months
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {preview && (
                <div className="mt-4 rounded-field border border-base-300 bg-base-200/40 px-4 py-3">
                  <p className="k-eyebrow mb-2">Amortization preview · equal-principal</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-base-content/55">First payment</p>
                      <p className="k-mono font-semibold tabular-nums">
                        {formatUsd(Number(formatUnits(preview.firstPayment, dec)))} {sym}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-base-content/55">Principal / mo</p>
                      <p className="k-mono font-semibold tabular-nums">
                        {formatUsd(Number(formatUnits(preview.perInstallment, dec)))} {sym}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-base-content/55">APR (locked by tier)</p>
                      <p className="k-mono font-semibold tabular-nums">{annualRateBps / 100}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-base-content/55">Total interest</p>
                      <p className="k-mono font-semibold tabular-nums">
                        {formatUsd(Number(formatUnits(preview.totalInterest, dec)))} {sym}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-base-content/50 mt-2">
                    Equal principal of {formatUsd(Number(formatUnits(preview.perInstallment, dec)))} {sym} per month
                    plus interest on the declining balance; the final installment clears the remainder.
                  </p>
                </div>
              )}

              <button
                className="btn btn-primary btn-sm w-full gap-1 mt-3"
                onClick={doBorrow}
                disabled={borrowing || !att || !eligible || noLiquidity || parsedAmount <= 0n}
                type="button"
              >
                {borrowing ? (
                  <>
                    <span className="loading loading-spinner loading-xs" /> Borrowing onchain…
                  </>
                ) : (
                  <>
                    <BanknotesIcon className="h-4 w-4" aria-hidden="true" /> Borrow {sym} (sponsored)
                  </>
                )}
              </button>
              {account && (
                <p className="text-xs text-base-content/45 mt-2">
                  Disbursed to your smart wallet <span className="k-mono">{account}</span>.
                </p>
              )}
              {loanTx && (
                <div className="mt-3 space-y-1">
                  <div className="flex items-center gap-2 text-success text-sm font-medium">
                    <CheckCircleIcon className="h-5 w-5" aria-hidden="true" /> Disbursed {loanTx.amount} {sym}
                  </div>
                  <a
                    href={sepoliaTxUrl(loanTx.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="link k-mono text-xs break-all inline-flex items-center gap-1"
                  >
                    {loanTx.hash}
                    <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </a>
                </div>
              )}
            </Panel>
          )}
        </div>
      )}

      {!embedded && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-6">
          <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
            <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" /> Back
          </button>
          <button className="btn btn-outline gap-1" onClick={onNext} type="button">
            Go to liquidity <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
};
