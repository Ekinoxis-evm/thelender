"use client";

import { useEffect, useState } from "react";
import { encodeFunctionData, formatUnits, parseUnits } from "viem";
import { useReadContract } from "wagmi";
import {
  ArrowLeftIcon,
  BanknotesIcon,
  DocumentDuplicateIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { PageHeader, Panel } from "~~/components/kredito";
import { Stat, ZERO_ADDR } from "~~/components/kredito/flowBits";
import { useSmartWalletAddress, useSponsoredWrite } from "~~/hooks/scaffold-eth/useSmartWallet";
import { formatUsd } from "~~/kredito/format";
import {
  ERC20_ABI,
  INSURANCE_POOL_ABI,
  KREDITO_INSURANCE_ADDRESS,
  KREDITO_VAULT_ADDRESS,
  VAULT_ABI,
  VAULT_CHAIN_ID,
} from "~~/kredito/vault";
import { getParsedError, notification } from "~~/utils/scaffold-eth";

/**
 * The dedicated liquidity-provider (LP) dashboard. OPEN to ANY connected wallet — providing
 * liquidity needs NO ENS / credit identity (only borrowing does). Used by `/liquidity` and the
 * verified-wallet Dashboard "Provide liquidity" tab.
 *
 * Layout — two zones, LP-first:
 *   - "You": your position (vault + insurance value via convertToAssets) at the top, then the
 *     supply action; withdraw panels appear only once you hold a position. The smart-wallet
 *     funding line (LPs must hold Sepolia USDC) sits here, minimal.
 *   - "The pool": total assets / idle / utilization, and the insurance reserve total (cover-ratio
 *     mechanics are tucked behind a disclosure).
 * Plain-language headings; the ERC/EIP names live only in a single "How it works" disclosure.
 * All writes are sponsored via `useSponsoredWrite`; all reads are scoped to the smart wallet.
 */
export const LiquidityDashboard = ({
  borrower,
  onBack,
  // In a tab/page the LP view is standalone — hide the wizard footer nav.
  embedded = false,
}: {
  borrower: `0x${string}`;
  onBack?: () => void;
  embedded?: boolean;
}) => {
  const configured = KREDITO_VAULT_ADDRESS.length > 0;
  const vault = configured ? (KREDITO_VAULT_ADDRESS as `0x${string}`) : undefined;
  const insuranceConfigured = KREDITO_INSURANCE_ADDRESS.length > 0;
  const insurance = insuranceConfigured ? (KREDITO_INSURANCE_ADDRESS as `0x${string}`) : undefined;
  const { writeContractSponsored, sendCalls } = useSponsoredWrite();

  // The connected SMART WALLET is the LP: it holds the USDC, receives shares, and is the redeem
  // controller. All position reads are scoped to it (not the embedded EOA).
  const smartWallet = useSmartWalletAddress();
  const lp = smartWallet ?? (borrower !== ZERO_ADDR ? borrower : undefined);
  const hasLp = configured && !!lp;

  const read = { address: vault, abi: VAULT_ABI, chainId: VAULT_CHAIN_ID } as const;

  const { data: assetAddr } = useReadContract({ ...read, functionName: "asset", query: { enabled: configured } });
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
  // The smart wallet's USDC balance — it MUST hold USDC to supply.
  const { data: walletBal, refetch: refetchWallet } = useReadContract({
    address: assetAddr,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: lp ? [lp] : undefined,
    chainId: VAULT_CHAIN_ID,
    query: { enabled: !!assetAddr && hasLp },
  });
  const { data: tvl, refetch: refetchTvl } = useReadContract({
    ...read,
    functionName: "totalAssets",
    query: { enabled: configured },
  });
  const { data: idle, refetch: refetchIdle } = useReadContract({
    ...read,
    functionName: "idleLiquidity",
    query: { enabled: configured },
  });
  const { data: lent, refetch: refetchLent } = useReadContract({
    ...read,
    functionName: "totalOutstanding",
    query: { enabled: configured },
  });
  const { data: shares, refetch: refetchShares } = useReadContract({
    ...read,
    functionName: "balanceOf",
    args: lp ? [lp] : undefined,
    query: { enabled: hasLp },
  });
  const { data: positionValue } = useReadContract({
    ...read,
    functionName: "convertToAssets",
    args: [typeof shares === "bigint" ? shares : 0n],
    query: { enabled: hasLp && typeof shares === "bigint" && shares > 0n },
  });
  const { data: pendingShares, refetch: refetchPending } = useReadContract({
    ...read,
    functionName: "pendingRedeemRequest",
    args: lp ? [0n, lp] : undefined,
    query: { enabled: hasLp },
  });
  const { data: claimableShares, refetch: refetchClaimable } = useReadContract({
    ...read,
    functionName: "claimableRedeemRequest",
    args: lp ? [0n, lp] : undefined,
    query: { enabled: hasLp },
  });
  const { data: pendingValue } = useReadContract({
    ...read,
    functionName: "convertToAssets",
    args: [typeof pendingShares === "bigint" ? pendingShares : 0n],
    query: { enabled: hasLp && typeof pendingShares === "bigint" && pendingShares > 0n },
  });
  const { data: claimableValue } = useReadContract({
    ...read,
    functionName: "convertToAssets",
    args: [typeof claimableShares === "bigint" ? claimableShares : 0n],
    query: { enabled: hasLp && typeof claimableShares === "bigint" && claimableShares > 0n },
  });
  const { data: minCoverBps } = useReadContract({
    ...read,
    functionName: "minCoverRatioBps",
    query: { enabled: configured },
  });

  // --- Insurance (COVER) pool reads ---
  const insRead = { address: insurance, abi: INSURANCE_POOL_ABI, chainId: VAULT_CHAIN_ID } as const;
  const { data: insTvl, refetch: refetchInsTvl } = useReadContract({
    ...insRead,
    functionName: "totalAssets",
    query: { enabled: insuranceConfigured },
  });
  const { data: insShares, refetch: refetchInsShares } = useReadContract({
    ...insRead,
    functionName: "balanceOf",
    args: lp ? [lp] : undefined,
    query: { enabled: insuranceConfigured && hasLp },
  });
  const { data: insPosition } = useReadContract({
    ...insRead,
    functionName: "convertToAssets",
    args: [typeof insShares === "bigint" ? insShares : 0n],
    query: { enabled: insuranceConfigured && hasLp && typeof insShares === "bigint" && insShares > 0n },
  });
  const { data: insCooldown } = useReadContract({
    ...insRead,
    functionName: "redeemCooldown",
    query: { enabled: insuranceConfigured },
  });
  const { data: insLastDeposit, refetch: refetchInsLast } = useReadContract({
    ...insRead,
    functionName: "lastDepositAt",
    args: lp ? [lp] : undefined,
    query: { enabled: insuranceConfigured && hasLp },
  });

  const dec = typeof decimalsData === "number" ? decimalsData : 6;
  const sym = typeof symbolData === "string" ? symbolData : "USDC";
  const usd = (v: unknown) => formatUsd(typeof v === "bigint" ? Number(formatUnits(v, dec)) : 0);
  const sharesBig = typeof shares === "bigint" ? shares : 0n;
  const positionBig = typeof positionValue === "bigint" ? positionValue : 0n;
  const pendingBig = typeof pendingShares === "bigint" ? pendingShares : 0n;
  const claimableBig = typeof claimableShares === "bigint" ? claimableShares : 0n;
  const walletBalBig = typeof walletBal === "bigint" ? walletBal : 0n;
  const insSharesBig = typeof insShares === "bigint" ? insShares : 0n;
  const insPositionBig = typeof insPosition === "bigint" ? insPosition : 0n;
  const tvlBig = typeof tvl === "bigint" ? tvl : 0n;
  const lentBig = typeof lent === "bigint" ? lent : 0n;
  const insTvlBig = typeof insTvl === "bigint" ? insTvl : 0n;

  // Utilization = lent ÷ total assets. Cover ratio = insurance reserve ÷ outstanding loans (the
  // collateral backing live debt), compared against the vault's configured minimum.
  const utilizationPct = tvlBig > 0n ? Number((lentBig * 10000n) / tvlBig) / 100 : 0;
  const yourSharePct = tvlBig > 0n && positionBig > 0n ? Number((positionBig * 10000n) / tvlBig) / 100 : 0;
  const minCoverPct = typeof minCoverBps === "bigint" ? Number(minCoverBps) / 100 : null;
  const coverRatioPct = lentBig > 0n ? Number((insTvlBig * 10000n) / lentBig) / 100 : null;
  const coverHealthy = minCoverPct === null || coverRatioPct === null || coverRatioPct >= minCoverPct;

  const [amount, setAmount] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [insAmount, setInsAmount] = useState("");
  const [busy, setBusy] = useState<"" | "supply" | "request" | "cancel" | "claim" | "insSupply" | "insRedeem">("");

  // Insurance cooldown: a withdraw is gated until lastDepositAt + redeemCooldown. Compute remaining
  // seconds in an effect (Date.now is impure at render).
  const [insUnlockIn, setInsUnlockIn] = useState(0);
  useEffect(() => {
    const last = typeof insLastDeposit === "bigint" ? Number(insLastDeposit) : 0;
    const cd = typeof insCooldown === "bigint" ? Number(insCooldown) : 0;
    const tick = () => setInsUnlockIn(Math.max(0, last + cd - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [insLastDeposit, insCooldown]);
  const insLocked = insUnlockIn > 0 && insSharesBig > 0n;

  // Parsed supply input (base units) for the balance gate.
  const parsedSupply = (() => {
    try {
      return parseUnits((amount || "0").replace(/,/g, ""), dec);
    } catch {
      return 0n;
    }
  })();
  const insufficientForSupply = parsedSupply > walletBalBig;

  const parsedInsSupply = (() => {
    try {
      return parseUnits((insAmount || "0").replace(/,/g, ""), dec);
    } catch {
      return 0n;
    }
  })();
  const insufficientForInsSupply = parsedInsSupply > walletBalBig;

  const refetchAll = () => {
    void refetchWallet();
    void refetchTvl();
    void refetchIdle();
    void refetchLent();
    void refetchShares();
    void refetchPending();
    void refetchClaimable();
    void refetchInsTvl();
    void refetchInsShares();
    void refetchInsLast();
  };

  const copyAddr = () => {
    if (!lp) return;
    navigator.clipboard?.writeText(lp);
    notification.success("Smart wallet address copied");
  };

  const supply = async () => {
    if (!vault || !assetAddr || !lp) return;
    if (parsedSupply <= 0n) {
      notification.error("Enter an amount to supply.");
      return;
    }
    if (insufficientForSupply) {
      notification.error(`Smart wallet holds only ${usd(walletBalBig)} ${sym}. Send more USDC to it first.`);
      return;
    }
    setBusy("supply");
    try {
      // Atomic approve + deposit in one sponsored UserOperation (ERC-4626 sync deposit).
      const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, parsedSupply] });
      const depositData = encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [parsedSupply, lp] });
      await sendCalls([
        { to: assetAddr, data: approveData },
        { to: vault, data: depositData },
      ]);
      notification.success(`Supplied ${amount} ${sym} to the lending vault`);
      setAmount("");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  const supplyInsurance = async () => {
    if (!insurance || !assetAddr || !lp) return;
    if (parsedInsSupply <= 0n) {
      notification.error("Enter an amount to supply.");
      return;
    }
    if (insufficientForInsSupply) {
      notification.error(`Smart wallet holds only ${usd(walletBalBig)} ${sym}. Send more USDC to it first.`);
      return;
    }
    setBusy("insSupply");
    try {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [insurance, parsedInsSupply],
      });
      const depositData = encodeFunctionData({
        abi: INSURANCE_POOL_ABI,
        functionName: "deposit",
        args: [parsedInsSupply, lp],
      });
      await sendCalls([
        { to: assetAddr, data: approveData },
        { to: insurance, data: depositData },
      ]);
      notification.success(`Backed the pool with ${insAmount} ${sym}`);
      setInsAmount("");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  // Insurance redeem is SYNCHRONOUS (reserves are never lent out) but cooldown-gated.
  const redeemInsurance = async () => {
    if (!insurance || !lp || insSharesBig <= 0n) return;
    if (insLocked) {
      notification.error("Reserves are still in their withdrawal cooldown.");
      return;
    }
    setBusy("insRedeem");
    try {
      await writeContractSponsored({
        address: insurance,
        abi: INSURANCE_POOL_ABI,
        functionName: "redeem",
        args: [insSharesBig, lp, lp],
      });
      notification.success("Reserves withdrawn — returned to your wallet");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  // Async redeem: requestRedeem escrows shares; the keeper fulfills as liquidity frees; then claim.
  const requestRedeem = async () => {
    if (!vault || !lp || positionBig <= 0n || sharesBig <= 0n) return;
    // Convert the asset-denominated input to shares pro-rata (blank = full position).
    let reqShares = sharesBig;
    const trimmed = (redeemAmount || "").replace(/,/g, "").trim();
    if (trimmed) {
      let amtAssets: bigint;
      try {
        amtAssets = parseUnits(trimmed, dec);
      } catch {
        notification.error("Invalid amount.");
        return;
      }
      reqShares = (amtAssets * sharesBig) / positionBig;
      if (reqShares > sharesBig) reqShares = sharesBig;
    }
    if (reqShares <= 0n) {
      notification.error("Amount too small.");
      return;
    }
    setBusy("request");
    try {
      await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "requestRedeem",
        args: [reqShares, lp, lp],
      });
      notification.success("Withdrawal requested — processing as liquidity frees up");
      setRedeemAmount("");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  const cancelRedeem = async () => {
    if (!vault || !lp || pendingBig <= 0n) return;
    setBusy("cancel");
    try {
      await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "cancelRedeemRequest",
        args: [pendingBig, lp],
      });
      notification.success("Pending withdrawal cancelled — position restored");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  const claimRedeem = async () => {
    if (!vault || !lp || claimableBig <= 0n) return;
    setBusy("claim");
    try {
      await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "redeem",
        args: [claimableBig, lp, lp],
      });
      notification.success("Claimed — assets returned to your wallet");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  const hasVaultPosition = positionBig > 0n || pendingBig > 0n || claimableBig > 0n;
  const hasInsPosition = insSharesBig > 0n;
  const hasAnyPosition = hasVaultPosition || hasInsPosition;

  return (
    <>
      <PageHeader
        step={embedded ? undefined : 6}
        eyebrow="Liquidity"
        title="Provide liquidity"
        subtitle="Open to any wallet — no credit identity required. Supply USDC to the lending vault to earn borrower interest, or back the pool with insurance reserves to earn the protocol fee and absorb defaults. Gas is sponsored."
      />

      {!configured ? (
        <>
          <div className="alert alert-info mb-5">
            <BanknotesIcon className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Lending vault not configured</p>
              <p className="text-sm opacity-80">
                Set <code>NEXT_PUBLIC_KREDITO_VAULT</code> to the deployed vault to enable liquidity provision.
              </p>
            </div>
          </div>
          <Panel eyebrow="Onchain" title="Vault not configured">
            <p className="text-sm text-base-content/70">
              Deploy the vault and set <code>NEXT_PUBLIC_KREDITO_VAULT</code> to enable liquidity provision:
            </p>
            <code className="k-mono text-xs break-all block bg-base-200 rounded-field p-2 mt-2">
              yarn deploy --file DeployKreditoVaultV2.s.sol --network sepolia
            </code>
          </Panel>
        </>
      ) : (
        <div className="space-y-8">
          {/* ============================ ZONE 1 — YOU ============================ */}
          <div className="space-y-4">
            <p className="k-eyebrow">You</p>

            {/* Your position — the first thing a returning LP wants to see. */}
            <Panel eyebrow="Your position" title="What you have supplied">
              {!hasAnyPosition ? (
                <div className="rounded-field border border-dashed border-base-300 px-4 py-8 text-center">
                  <SparklesIcon aria-hidden="true" className="h-6 w-6 text-primary mx-auto mb-2" />
                  <p className="font-medium">No liquidity supplied yet</p>
                  <p className="text-sm text-base-content/60 mt-1 max-w-sm mx-auto">
                    Supply USDC below to start earning borrower interest, or back the pool to earn the protocol fee.
                  </p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="rounded-field border border-base-300 px-4 py-3">
                    {hasVaultPosition ? (
                      <>
                        <Stat label="Lending vault" value={usd(positionBig)} />
                        <p className="text-xs text-base-content/55 mt-0.5">supplied + accrued yield</p>
                        {pendingBig > 0n && (
                          <p className="text-xs text-warning mt-1 tabular-nums">
                            Pending withdrawal: {usd(pendingValue)}
                          </p>
                        )}
                        {claimableBig > 0n && (
                          <p className="text-xs text-success mt-1 tabular-nums">
                            Ready to claim: {usd(claimableValue)}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="k-eyebrow mb-1">Lending vault</p>
                        <p className="text-sm text-base-content/55">No vault position — supply below.</p>
                      </>
                    )}
                  </div>
                  <div className="rounded-field border border-base-300 px-4 py-3">
                    {hasInsPosition ? (
                      <>
                        <Stat label="Insurance reserve" value={usd(insPositionBig)} />
                        <p className="text-xs text-base-content/55 mt-0.5">reserve backing + protocol fee</p>
                      </>
                    ) : (
                      <>
                        <p className="k-eyebrow mb-1">Insurance reserve</p>
                        <p className="text-sm text-base-content/55">No reserve position — back the pool below.</p>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Smart-wallet funding — secondary, minimal. */}
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-field bg-base-200/60 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="k-eyebrow shrink-0">Smart wallet</span>
                  {lp ? (
                    <>
                      <code className="k-mono text-xs truncate">{lp}</code>
                      <button type="button" onClick={copyAddr} className="btn btn-ghost btn-xs px-1 shrink-0">
                        <DocumentDuplicateIcon aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-base-content/60">Log in to create your smart wallet.</span>
                  )}
                </div>
                <span className="k-mono text-sm font-medium shrink-0 tabular-nums">
                  {usd(walletBalBig)} {sym}
                </span>
              </div>
              <p className="text-xs text-base-content/50 mt-1.5">
                Send Sepolia {sym} to this address to supply. Gas for every action is sponsored.
              </p>
            </Panel>

            {/* Supply + withdraw actions. Withdraw panels appear only once you hold a position. */}
            <div className="grid lg:grid-cols-2 gap-4 items-start">
              {/* Supply to the lending vault */}
              <Panel eyebrow="Supply" title="Supply to the lending vault">
                <p className="text-xs text-base-content/55 mb-3">
                  Vault LPs earn the interest borrowers pay on their installment loans. Returns scale with utilization.
                </p>
                <label className="block">
                  <span className="k-eyebrow">Amount ({sym})</span>
                  <div
                    className={`mt-1 flex items-center gap-2 rounded-field border bg-base-100 px-3 transition-colors ${
                      insufficientForSupply
                        ? "border-error focus-within:border-error"
                        : "border-base-300 focus-within:border-primary"
                    }`}
                  >
                    <input
                      inputMode="decimal"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0"
                      className="w-full bg-transparent py-2.5 outline-none text-sm k-mono tabular-nums"
                    />
                    <button
                      type="button"
                      className="text-xs link shrink-0"
                      onClick={() => setAmount(walletBalBig > 0n ? formatUnits(walletBalBig, dec) : "")}
                    >
                      Max {usd(walletBalBig)}
                    </button>
                  </div>
                </label>
                {insufficientForSupply && (
                  <p className="text-xs text-error mt-1">Exceeds your smart wallet&apos;s {sym} balance.</p>
                )}
                <button
                  className="btn btn-primary btn-sm w-full gap-1 mt-3"
                  onClick={supply}
                  disabled={busy !== "" || !hasLp || parsedSupply <= 0n || insufficientForSupply}
                  type="button"
                >
                  {busy === "supply" ? (
                    <>
                      <span className="loading loading-spinner loading-xs" /> Supplying…
                    </>
                  ) : (
                    <>
                      <BanknotesIcon aria-hidden="true" className="h-4 w-4" /> Supply {sym} (sponsored)
                    </>
                  )}
                </button>
                <p aria-live="polite" className="text-xs text-base-content/50 mt-2">
                  {busy === "supply"
                    ? "Supplying — confirm in your wallet…"
                    : "Approve and deposit happen in one sponsored step."}
                </p>
              </Panel>

              {/* Back the pool (insurance) */}
              <Panel eyebrow="Insurance reserve" title="Back the pool">
                <p className="text-xs text-base-content/55 mb-3">
                  Reserve LPs earn the protocol fee (20% of borrower interest) and absorb default losses first — before
                  vault LPs — up to the reserve. Higher reward, first-loss risk.
                </p>
                {!insuranceConfigured ? (
                  <p className="text-sm text-base-content/65">
                    Set <code>NEXT_PUBLIC_KREDITO_INSURANCE</code> to enable the insurance reserve.
                  </p>
                ) : (
                  <>
                    <label className="block">
                      <span className="k-eyebrow">Amount ({sym})</span>
                      <div
                        className={`mt-1 flex items-center gap-2 rounded-field border bg-base-100 px-3 transition-colors ${
                          insufficientForInsSupply
                            ? "border-error focus-within:border-error"
                            : "border-base-300 focus-within:border-primary"
                        }`}
                      >
                        <input
                          inputMode="decimal"
                          value={insAmount}
                          onChange={e => setInsAmount(e.target.value)}
                          placeholder="0"
                          className="w-full bg-transparent py-2.5 outline-none text-sm k-mono tabular-nums"
                        />
                        <button
                          type="button"
                          className="text-xs link shrink-0"
                          onClick={() => setInsAmount(walletBalBig > 0n ? formatUnits(walletBalBig, dec) : "")}
                        >
                          Max {usd(walletBalBig)}
                        </button>
                      </div>
                    </label>
                    {insufficientForInsSupply && (
                      <p className="text-xs text-error mt-1">Exceeds your smart wallet&apos;s {sym} balance.</p>
                    )}
                    <button
                      className="btn btn-primary btn-sm w-full gap-1 mt-3"
                      onClick={supplyInsurance}
                      disabled={busy !== "" || !hasLp || parsedInsSupply <= 0n || insufficientForInsSupply}
                      type="button"
                    >
                      {busy === "insSupply" ? (
                        <>
                          <span className="loading loading-spinner loading-xs" /> Supplying…
                        </>
                      ) : (
                        <>
                          <ShieldCheckIcon aria-hidden="true" className="h-4 w-4" /> Back the pool (sponsored)
                        </>
                      )}
                    </button>
                    <p aria-live="polite" className="text-xs text-base-content/50 mt-2">
                      {busy === "insSupply"
                        ? "Backing the pool — confirm in your wallet…"
                        : "Approve and deposit happen in one sponsored step."}
                    </p>
                  </>
                )}
              </Panel>

              {/* Withdraw from the lending vault — only once you hold a vault position. */}
              {hasVaultPosition && (
                <Panel eyebrow="Withdraw" title="Withdraw from the lending vault">
                  {claimableBig > 0n && (
                    <div aria-live="polite" className="rounded-field bg-success/10 px-3 py-2 mb-3">
                      <p className="text-sm font-medium text-success tabular-nums">
                        Ready to claim: {usd(claimableValue)}
                      </p>
                      <button
                        className="btn btn-success btn-sm w-full gap-1 mt-2"
                        onClick={claimRedeem}
                        disabled={busy !== ""}
                        type="button"
                      >
                        {busy === "claim" ? (
                          <>
                            <span className="loading loading-spinner loading-xs" /> Claiming…
                          </>
                        ) : (
                          <>Claim {usd(claimableValue)}</>
                        )}
                      </button>
                    </div>
                  )}

                  {pendingBig > 0n ? (
                    <div aria-live="polite" className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-base-content/70">Pending withdrawal</span>
                        <span className="k-mono font-medium tabular-nums">{usd(pendingValue)}</span>
                      </div>
                      <p className="text-xs text-base-content/55">
                        Processing as borrowers repay and liquidity frees up. You&apos;ll be able to claim once
                        it&apos;s ready.
                      </p>
                      <button
                        className="btn btn-outline btn-sm w-full"
                        onClick={cancelRedeem}
                        disabled={busy !== ""}
                        type="button"
                      >
                        {busy === "cancel" ? (
                          <>
                            <span className="loading loading-spinner loading-xs" /> Cancelling…
                          </>
                        ) : (
                          <>Cancel pending withdrawal</>
                        )}
                      </button>
                    </div>
                  ) : (
                    <>
                      <label className="block">
                        <span className="k-eyebrow">Amount ({sym}) — blank = full position</span>
                        <div className="mt-1 flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 focus-within:border-primary transition-colors">
                          <input
                            inputMode="decimal"
                            value={redeemAmount}
                            onChange={e => setRedeemAmount(e.target.value)}
                            placeholder={positionBig > 0n ? formatUnits(positionBig, dec) : "0"}
                            className="w-full bg-transparent py-2.5 outline-none text-sm k-mono tabular-nums"
                          />
                          <button
                            type="button"
                            className="text-xs link shrink-0"
                            onClick={() => setRedeemAmount(positionBig > 0n ? formatUnits(positionBig, dec) : "")}
                          >
                            Max {usd(positionBig)}
                          </button>
                        </div>
                      </label>
                      <button
                        className="btn btn-primary btn-sm w-full gap-1 mt-3"
                        onClick={requestRedeem}
                        disabled={busy !== "" || positionBig <= 0n}
                        type="button"
                      >
                        {busy === "request" ? (
                          <>
                            <span className="loading loading-spinner loading-xs" /> Requesting…
                          </>
                        ) : (
                          <>Request withdrawal</>
                        )}
                      </button>
                      <p className="text-xs text-base-content/50 mt-2">
                        Withdrawals are processed as liquidity frees up, then you claim — gas sponsored.
                      </p>
                    </>
                  )}
                </Panel>
              )}

              {/* Withdraw from the reserve — only once you hold a reserve position. */}
              {insuranceConfigured && hasInsPosition && (
                <Panel eyebrow="Withdraw" title="Withdraw from the reserve">
                  {insLocked ? (
                    <div aria-live="polite" className="rounded-field bg-warning/10 px-3 py-2">
                      <p className="text-sm font-medium text-warning">Cooldown active</p>
                      <p className="text-xs text-base-content/60 mt-0.5 tabular-nums">
                        Unlocks in {Math.floor(insUnlockIn / 60)}m {insUnlockIn % 60}s. Reserves can only be withdrawn
                        after the cooldown since your last deposit.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-field border border-base-300 px-3 py-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium tabular-nums">{usd(insPositionBig)}</p>
                        <p className="text-xs text-base-content/55">returned to your wallet instantly</p>
                      </div>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={redeemInsurance}
                        disabled={busy !== ""}
                        type="button"
                      >
                        {busy === "insRedeem" ? (
                          <>
                            <span className="loading loading-spinner loading-xs" /> Withdrawing…
                          </>
                        ) : (
                          <>Withdraw all</>
                        )}
                      </button>
                    </div>
                  )}
                </Panel>
              )}
            </div>
          </div>

          {/* ============================ ZONE 2 — THE POOL ============================ */}
          <div className="space-y-4">
            <p className="k-eyebrow">The pool</p>

            <Panel eyebrow="Lending vault" title="Pool stats">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Total assets" value={usd(tvlBig)} />
                <Stat label="Idle (lendable)" value={usd(idle)} />
                <div>
                  <Stat label="Utilization" value={`${utilizationPct.toFixed(1)}%`} />
                  <p className="text-xs text-base-content/50 mt-0.5 tabular-nums">{usd(lentBig)} lent</p>
                </div>
                <div>
                  <Stat label="Your share" value={`${yourSharePct.toFixed(2)}%`} />
                  <p className="text-xs text-base-content/50 mt-0.5 tabular-nums">{usd(positionBig)}</p>
                </div>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-base-300">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.min(100, utilizationPct)}%` }}
                />
              </div>
              <p className="text-xs text-base-content/50 mt-1">
                Utilization = capital lent to borrowers ÷ total assets.
              </p>
            </Panel>

            {insuranceConfigured && (
              <Panel
                eyebrow="Insurance reserve"
                title="Reserve"
                action={
                  coverRatioPct !== null ? (
                    <span className={`badge gap-1 ${coverHealthy ? "badge-success" : "badge-warning"}`}>
                      <ShieldCheckIcon aria-hidden="true" className="h-3.5 w-3.5" />{" "}
                      {coverHealthy ? "Healthy" : "Below minimum"}
                    </span>
                  ) : null
                }
              >
                <Stat label="Reserve total" value={usd(insTvlBig)} />
                {/* Cover-ratio mechanics are secondary — tucked behind a disclosure. */}
                <div className="collapse collapse-arrow bg-base-200/60 rounded-field mt-3">
                  <input type="checkbox" />
                  <div className="collapse-title text-sm font-medium">Reserve health detail</div>
                  <div className="collapse-content">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Stat
                          label="Cover ratio"
                          value={coverRatioPct === null ? "∞" : `${coverRatioPct.toFixed(1)}%`}
                        />
                        <p className="text-xs text-base-content/50 mt-0.5">reserve ÷ loans outstanding</p>
                      </div>
                      <div>
                        <Stat label="Minimum required" value={minCoverPct === null ? "—" : `${minCoverPct}%`} />
                        <p className="text-xs text-base-content/50 mt-0.5">minimum cover ratio</p>
                      </div>
                    </div>
                  </div>
                </div>
              </Panel>
            )}
          </div>

          {/* How it works — the only place the protocol/standard names appear. */}
          <div className="collapse collapse-arrow bg-base-200/60 rounded-field">
            <input type="checkbox" />
            <div className="collapse-title text-sm font-medium">How it works (for the curious)</div>
            <div className="collapse-content text-sm text-base-content/65 space-y-1.5">
              <p>
                The lending vault is an <span className="k-mono">ERC-4626</span> tokenized vault: supplying mints you
                shares; their value tracks the pool via <span className="k-mono">convertToAssets</span>.
              </p>
              <p>
                Withdrawals are asynchronous (<span className="k-mono">ERC-7540</span>): you request, the pool processes
                as liquidity frees up, then you claim.
              </p>
              <p>
                The insurance reserve is a separate <span className="k-mono">ERC-4626</span> pool with a cooldown-gated
                synchronous withdrawal. Its cover ratio is checked against a minimum cover ratio before it&apos;s
                considered healthy.
              </p>
            </div>
          </div>
        </div>
      )}

      {!embedded && onBack && (
        <div className="flex justify-between mt-6">
          <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
            <ArrowLeftIcon className="h-4 w-4" /> Back
          </button>
        </div>
      )}
    </>
  );
};
