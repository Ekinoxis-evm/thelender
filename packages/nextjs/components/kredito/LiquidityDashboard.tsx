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
import { ZERO_ADDR } from "~~/components/kredito/flowBits";
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
 * Layout:
 *   - Smart-wallet funding panel (LPs must hold Sepolia USDC; supply is gated on balance).
 *   - POOL STATS: lending vault (total assets / idle / utilization / your share) +
 *     insurance pool (reserve TVL / cover ratio vs minCoverRatioBps).
 *   - YOUR POSITIONS: vault (supplied + yield via convertToAssets) + COVER (convertToAssets),
 *     with empty-state prompts to supply.
 *   - ACTIONS: supply vault (approve+deposit batch), supply insurance (batch), async vault redeem
 *     (ERC-7540 request → fulfill → claim) and sync cooldown-gated COVER redeem.
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
  const { data: vaultOwner } = useReadContract({ ...read, functionName: "owner", query: { enabled: configured } });
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
  const isOwner = !!vaultOwner && !!lp && String(vaultOwner).toLowerCase() === lp.toLowerCase();

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
  const [busy, setBusy] = useState<
    "" | "supply" | "request" | "cancel" | "claim" | "fulfill" | "insSupply" | "insRedeem"
  >("");

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
      notification.success(`Backed the pool with ${insAmount} ${sym} (COVER)`);
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
      notification.error("COVER is still in its redeem cooldown.");
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
      notification.success("COVER redeemed — reserves returned to your wallet");
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
      notification.success("Redeem requested — awaiting keeper fulfillment");
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
      notification.success("Pending redeem cancelled — shares returned");
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

  // Keeper/owner action: move a controller's pending redeem to claimable (locks rate, reserves assets).
  const fulfill = async () => {
    if (!vault || !lp || pendingBig <= 0n) return;
    setBusy("fulfill");
    try {
      await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "fulfillRedeem",
        args: [lp, pendingBig],
      });
      notification.success("Redeem fulfilled — now claimable");
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
        eyebrow="Liquidity · ERC-4626 + ERC-7540"
        title="Provide liquidity"
        subtitle="Open to any wallet — no credit identity required. Supply USDC to the lending vault to earn borrower interest, or back the pool with COVER to earn the protocol fee and absorb defaults. Redemptions from the vault are asynchronous; gas is sponsored."
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
        <div className="space-y-4">
          {/* SMART-WALLET FUNDING — the vault is unseeded; this wallet must HOLD USDC to supply. */}
          <Panel eyebrow="Your smart wallet" title="Fund this address to supply liquidity">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <p className="k-eyebrow mb-1">Smart wallet (LP)</p>
                <div className="flex items-center gap-2">
                  {lp ? (
                    <>
                      <code className="k-mono text-sm break-all">{lp}</code>
                      <button type="button" onClick={copyAddr} className="btn btn-ghost btn-xs gap-1 shrink-0">
                        <DocumentDuplicateIcon className="h-3.5 w-3.5" /> Copy
                      </button>
                    </>
                  ) : (
                    <span className="text-sm text-base-content/60">Log in to create your smart wallet.</span>
                  )}
                </div>
              </div>
              <div className="sm:text-right shrink-0">
                <p className="k-eyebrow mb-1">USDC balance</p>
                <p className="k-mono text-2xl font-semibold">
                  {usd(walletBalBig)} {sym}
                </p>
              </div>
            </div>
            <p className="text-xs text-base-content/55 mt-3">
              Send Sepolia {sym} to this address to supply liquidity. Supply is disabled when the amount exceeds this
              balance. Gas for supply/redeem is sponsored.
            </p>
          </Panel>

          {/* ---------- POOL STATS ---------- */}
          <Panel eyebrow="Lending vault · ERC-4626" title="Pool stats">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="k-eyebrow mb-1">Total assets</p>
                <p className="k-mono text-2xl font-semibold">{usd(tvlBig)}</p>
              </div>
              <div>
                <p className="k-eyebrow mb-1">Idle (lendable)</p>
                <p className="k-mono text-2xl font-semibold">{usd(idle)}</p>
              </div>
              <div>
                <p className="k-eyebrow mb-1">Utilization</p>
                <p className="k-mono text-2xl font-semibold">{utilizationPct.toFixed(1)}%</p>
                <p className="text-xs text-base-content/50 mt-0.5">{usd(lentBig)} lent</p>
              </div>
              <div>
                <p className="k-eyebrow mb-1">Your share</p>
                <p className="k-mono text-2xl font-semibold">{yourSharePct.toFixed(2)}%</p>
                <p className="text-xs text-base-content/50 mt-0.5">{usd(positionBig)}</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-base-300">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.min(100, utilizationPct)}%` }}
              />
            </div>
            <p className="text-xs text-base-content/50 mt-1">Utilization = capital lent to borrowers ÷ total assets.</p>
          </Panel>

          {/* Insurance pool stats */}
          <Panel
            eyebrow="Insurance · COVER · ERC-4626"
            title="Reserve health"
            action={
              insuranceConfigured && coverRatioPct !== null ? (
                <span className={`badge gap-1 ${coverHealthy ? "badge-success" : "badge-warning"}`}>
                  <ShieldCheckIcon className="h-3.5 w-3.5" /> {coverHealthy ? "Healthy" : "Below minimum"}
                </span>
              ) : null
            }
          >
            {!insuranceConfigured ? (
              <p className="text-sm text-base-content/65">
                Set <code>NEXT_PUBLIC_KREDITO_INSURANCE</code> to enable the COVER reserve pool.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="k-eyebrow mb-1">Reserve TVL</p>
                  <p className="k-mono text-2xl font-semibold">{usd(insTvlBig)}</p>
                </div>
                <div>
                  <p className="k-eyebrow mb-1">Cover ratio</p>
                  <p className={`k-mono text-2xl font-semibold ${coverHealthy ? "" : "text-warning"}`}>
                    {coverRatioPct === null ? "∞" : `${coverRatioPct.toFixed(1)}%`}
                  </p>
                  <p className="text-xs text-base-content/50 mt-0.5">reserve ÷ loans outstanding</p>
                </div>
                <div>
                  <p className="k-eyebrow mb-1">Minimum required</p>
                  <p className="k-mono text-2xl font-semibold">{minCoverPct === null ? "—" : `${minCoverPct}%`}</p>
                  <p className="text-xs text-base-content/50 mt-0.5">minCoverRatioBps</p>
                </div>
              </div>
            )}
          </Panel>

          {/* ---------- YOUR POSITIONS ---------- */}
          <Panel eyebrow="Your positions" title="What you have supplied">
            {!hasAnyPosition ? (
              <div className="rounded-field border border-dashed border-base-300 px-4 py-6 text-center">
                <SparklesIcon className="h-6 w-6 text-primary mx-auto mb-2" />
                <p className="font-medium">No liquidity supplied yet</p>
                <p className="text-sm text-base-content/60 mt-1">
                  Supply USDC to the lending vault below to start earning borrower interest, or back the pool with
                  COVER.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="rounded-field border border-base-300 px-4 py-3">
                  <p className="k-eyebrow mb-1">Lending vault</p>
                  {hasVaultPosition ? (
                    <>
                      <p className="k-mono text-2xl font-semibold">{usd(positionBig)}</p>
                      <p className="text-xs text-base-content/55 mt-0.5">supplied + accrued yield</p>
                      {pendingBig > 0n && (
                        <p className="text-xs text-warning mt-1">Pending redeem: {usd(pendingValue)}</p>
                      )}
                      {claimableBig > 0n && (
                        <p className="text-xs text-success mt-1">Claimable: {usd(claimableValue)}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-base-content/55">No vault position — supply below.</p>
                  )}
                </div>
                <div className="rounded-field border border-base-300 px-4 py-3">
                  <p className="k-eyebrow mb-1">COVER (insurance)</p>
                  {hasInsPosition ? (
                    <>
                      <p className="k-mono text-2xl font-semibold">{usd(insPositionBig)}</p>
                      <p className="text-xs text-base-content/55 mt-0.5">reserve backing + protocol fee</p>
                    </>
                  ) : (
                    <p className="text-sm text-base-content/55">No COVER position — back the pool below.</p>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* ---------- ACTIONS: lending vault ---------- */}
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            {/* Supply to the lending vault */}
            <Panel eyebrow="Supply · ERC-4626" title="Supply to the lending vault">
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
                    className="w-full bg-transparent py-2.5 outline-none text-sm k-mono"
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
                    <BanknotesIcon className="h-4 w-4" /> Supply {sym} (sponsored)
                  </>
                )}
              </button>
              <p className="text-xs text-base-content/50 mt-2">Batches approve + deposit into one sponsored call.</p>
            </Panel>

            {/* Async redeem from the lending vault */}
            <Panel eyebrow="Redeem · ERC-7540 async" title="Withdraw from the lending vault">
              {claimableBig > 0n && (
                <div className="rounded-field bg-success/10 px-3 py-2 mb-3">
                  <p className="text-sm font-medium text-success">Claimable: {usd(claimableValue)}</p>
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
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-base-content/70">Pending redeem</span>
                    <span className="k-mono font-medium">{usd(pendingValue)}</span>
                  </div>
                  <p className="text-xs text-base-content/55">
                    Waiting for the keeper to fulfill as borrowers repay and liquidity frees up.
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
                      <>Cancel pending request</>
                    )}
                  </button>
                  {isOwner && (
                    <button
                      className="btn btn-secondary btn-sm w-full"
                      onClick={fulfill}
                      disabled={busy !== ""}
                      type="button"
                    >
                      {busy === "fulfill" ? (
                        <>
                          <span className="loading loading-spinner loading-xs" /> Fulfilling…
                        </>
                      ) : (
                        <>Fulfill now (keeper)</>
                      )}
                    </button>
                  )}
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
                        className="w-full bg-transparent py-2.5 outline-none text-sm k-mono"
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
                      <>Request redeem</>
                    )}
                  </button>
                  <p className="text-xs text-base-content/50 mt-2">
                    Shares are escrowed now; the keeper fulfills, then you claim.
                  </p>
                </>
              )}
            </Panel>
          </div>

          {/* ---------- ACTIONS: insurance / COVER pool ---------- */}
          <Panel
            eyebrow="Insurance · COVER · ERC-4626"
            title="Back the pool (insurance)"
            action={
              insuranceConfigured ? (
                <span className="badge badge-ghost gap-1">
                  <ShieldCheckIcon className="h-3.5 w-3.5" /> Reserve TVL {usd(insTvlBig)}
                </span>
              ) : null
            }
          >
            {!insuranceConfigured ? (
              <p className="text-sm text-base-content/65">
                Set <code>NEXT_PUBLIC_KREDITO_INSURANCE</code> to enable the COVER reserve pool.
              </p>
            ) : (
              <div className="grid lg:grid-cols-2 gap-4 items-start">
                {/* COVER supply */}
                <div>
                  <p className="text-xs text-base-content/55 mb-3">
                    COVER LPs earn the protocol fee (20% of borrower interest) and absorb default losses first — before
                    vault LPs — up to the reserve. Higher reward, first-loss risk. Kept honest: if defaults exceed
                    cover, vault LPs take the remainder.
                  </p>
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
                        className="w-full bg-transparent py-2.5 outline-none text-sm k-mono"
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
                        <ShieldCheckIcon className="h-4 w-4" /> Back the pool (sponsored)
                      </>
                    )}
                  </button>
                  <p className="text-xs text-base-content/50 mt-2">
                    Batches approve + deposit into one sponsored call.
                  </p>
                </div>

                {/* COVER redeem (synchronous, cooldown-gated) */}
                <div>
                  <p className="k-eyebrow mb-1">Redeem COVER</p>
                  {insSharesBig <= 0n ? (
                    <p className="text-sm text-base-content/60">You have no COVER position yet.</p>
                  ) : insLocked ? (
                    <div className="rounded-field bg-warning/10 px-3 py-2">
                      <p className="text-sm font-medium text-warning">Cooldown active</p>
                      <p className="text-xs text-base-content/60 mt-0.5">
                        COVER unlocks in {Math.floor(insUnlockIn / 60)}m {insUnlockIn % 60}s. Reserves can only be
                        pulled after the redeem cooldown since your last deposit.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-field border border-base-300 px-3 py-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{usd(insPositionBig)}</p>
                        <p className="text-xs text-base-content/55">synchronous · returned to your wallet</p>
                      </div>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={redeemInsurance}
                        disabled={busy !== ""}
                        type="button"
                      >
                        {busy === "insRedeem" ? (
                          <>
                            <span className="loading loading-spinner loading-xs" /> Redeeming…
                          </>
                        ) : (
                          <>Redeem all</>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Panel>
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
