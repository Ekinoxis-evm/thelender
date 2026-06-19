"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { NextPage } from "next";
import { OpenLiquidity } from "~~/components/kredito/RoleHome";
import { useKreditoWallet } from "~~/kredito/useWallet";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Provide-liquidity surface. LPs are OPEN — any connected wallet can supply/redeem; no credit
 * identity required (only borrowers need one). This is the Stage-1 LP entry point; the full LP
 * dashboard is a later stage.
 */
const LiquidityPage: NextPage = () => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !PRIVY_APP_ID) return <LoadingState label="Loading liquidity pools…" />;
  return <Inner />;
};

const Inner = () => {
  const { ready, authenticated, login } = usePrivy();
  const { address } = useKreditoWallet();

  if (!ready) return <LoadingState label="Loading liquidity pools…" />;

  if (!authenticated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="k-display text-3xl font-semibold">Provide liquidity</h1>
        <p className="mt-3 text-base-content/65">
          Supply USDC to the lending vault and earn borrower interest, or back the pool with COVER. Open to any wallet —
          no credit identity required.
        </p>
        <button className="btn btn-primary mt-6" type="button" onClick={login}>
          Connect to provide liquidity
        </button>
      </div>
    );
  }

  return <OpenLiquidity address={address as `0x${string}` | undefined} />;
};

const LoadingState = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center gap-3 pt-24" aria-live="polite">
    <span className="loading loading-spinner loading-lg text-primary" />
    <p className="text-sm text-base-content/60">{label}</p>
  </div>
);

export default LiquidityPage;
