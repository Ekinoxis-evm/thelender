"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { ArrowRightIcon, BanknotesIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { PageHeader } from "~~/components/kredito";
import { LiquidityDashboard } from "~~/components/kredito/LiquidityDashboard";
import { ZERO_ADDR } from "~~/components/kredito/flowBits";
import { useKreditoIdentity } from "~~/hooks/scaffold-eth/useKreditoIdentity";
import { useSmartWalletAddress } from "~~/hooks/scaffold-eth/useSmartWallet";
import {
  INSURANCE_POOL_ABI,
  KREDITO_INSURANCE_ADDRESS,
  KREDITO_VAULT_ADDRESS,
  VAULT_ABI,
  VAULT_CHAIN_ID,
} from "~~/kredito/vault";

/**
 * Role indicator: a wallet can act as a Borrower (has a minted credit identity / active loan) AND/OR
 * an LP (holds a vault or insurance position). Read live from useKreditoIdentity + share balances.
 */
const RoleBadges = ({ wallet }: { wallet?: Address }) => {
  const { identity } = useKreditoIdentity(wallet);
  const enabled = !!wallet;

  const vault = KREDITO_VAULT_ADDRESS.length > 0 ? (KREDITO_VAULT_ADDRESS as `0x${string}`) : undefined;
  const insurance = KREDITO_INSURANCE_ADDRESS.length > 0 ? (KREDITO_INSURANCE_ADDRESS as `0x${string}`) : undefined;

  const { data: vaultShares } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "balanceOf",
    args: wallet ? [wallet] : undefined,
    chainId: VAULT_CHAIN_ID,
    query: { enabled: enabled && !!vault },
  });
  const { data: insShares } = useReadContract({
    address: insurance,
    abi: INSURANCE_POOL_ABI,
    functionName: "balanceOf",
    args: wallet ? [wallet] : undefined,
    chainId: VAULT_CHAIN_ID,
    query: { enabled: enabled && !!insurance },
  });

  const isBorrower = !!identity;
  const isLp =
    (typeof vaultShares === "bigint" && vaultShares > 0n) || (typeof insShares === "bigint" && insShares > 0n);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="k-eyebrow">Your roles</span>
      <span className={`badge gap-1 ${isBorrower ? "badge-primary" : "badge-ghost"}`}>
        <BanknotesIcon className="h-3.5 w-3.5" aria-hidden="true" /> Borrower {isBorrower ? "· active" : "· none"}
      </span>
      <span className={`badge gap-1 ${isLp ? "badge-secondary" : "badge-ghost"}`}>
        <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden="true" /> LP {isLp ? "· active" : "· none"}
      </span>
    </div>
  );
};

/**
 * The "choose your path" hub for an authenticated wallet that does NOT yet hold a credit identity.
 * Fixes the LP trap: instead of being forced into the credit-identity evaluation flow, the wallet
 * picks between borrowing (needs an identity → starts evaluation) and providing liquidity (OPEN,
 * needs no identity → drops straight into the LP dashboard).
 */
export const RoleHome = ({ onStartBorrow }: { onStartBorrow: () => void }) => {
  const smartWallet = useSmartWalletAddress();

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-5 py-8 w-full">
      <PageHeader
        eyebrow="Welcome to Kredito"
        title="Choose your path"
        subtitle="Kredito is a two-sided lending market. Borrow against a verified onchain credit identity, or provide liquidity to earn from borrowers — you can do both."
        action={<RoleBadges wallet={smartWallet} />}
      />

      <div className="grid md:grid-cols-2 gap-5">
        {/* Borrow path — requires a credit identity, so it starts the evaluation flow. */}
        <button
          type="button"
          onClick={onStartBorrow}
          className="k-card p-6 text-left hover:bg-base-200 transition-colors group flex flex-col"
        >
          <BanknotesIcon className="h-7 w-7 text-primary mb-3" aria-hidden="true" />
          <h3 className="text-lg font-semibold">Borrow capital</h3>
          <p className="text-sm text-base-content/65 mt-1 flex-1">
            Get a verified onchain credit identity, then borrow working capital — repaid in installments.
          </p>
          <span className="badge badge-ghost mt-3">Requires credit identity</span>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
            Start credit evaluation
            <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </button>

        {/* Provide-liquidity path — OPEN. No identity required; goes straight to the LP dashboard. */}
        <Link
          href="/liquidity"
          className="k-card p-6 text-left hover:bg-base-200 transition-colors group flex flex-col"
        >
          <ShieldCheckIcon className="h-7 w-7 text-secondary mb-3" aria-hidden="true" />
          <h3 className="text-lg font-semibold">Provide liquidity</h3>
          <p className="text-sm text-base-content/65 mt-1 flex-1">
            Supply USDC to the lending vault and earn borrower interest, or back the pool with COVER to earn the
            protocol fee. Open to any wallet — no credit identity required.
          </p>
          <span className="badge badge-success badge-outline mt-3">Open · no identity</span>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-secondary">
            Open the LP dashboard
            <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </Link>
      </div>
    </div>
  );
};

/**
 * Inline LP dashboard wrapper for the open `/liquidity` route — keeps the address fallback consistent
 * with the rest of the app and avoids duplicating the smart-wallet plumbing in the page file.
 */
export const OpenLiquidity = ({ address }: { address?: `0x${string}` }) => (
  <div className="mx-auto max-w-6xl px-4 sm:px-5 py-8 w-full">
    <LiquidityDashboard borrower={(address ?? ZERO_ADDR) as `0x${string}`} embedded />
  </div>
);
