"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { NextPage } from "next";
import { LiquiditySection } from "~~/components/kredito/LiquiditySection";
import { ZERO_ADDR } from "~~/components/kredito/flowBits";
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
  if (!mounted || !PRIVY_APP_ID) return <Spinner />;
  return <Inner />;
};

const Inner = () => {
  const { ready, authenticated, login } = usePrivy();
  const { address } = useKreditoWallet();

  if (!ready) return <Spinner />;

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

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-5 py-8 w-full">
      <LiquiditySection borrower={(address ?? ZERO_ADDR) as `0x${string}`} embedded />
    </div>
  );
};

const Spinner = () => (
  <div className="flex justify-center pt-24">
    <span className="loading loading-spinner loading-lg text-primary" />
  </div>
);

export default LiquidityPage;
