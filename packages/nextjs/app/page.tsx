"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Dashboard, EvaluationFlow, RoleHome } from "~~/components/kredito";
import { Landing } from "~~/components/kredito/Landing";
import { useKreditoIdentity } from "~~/hooks/scaffold-eth/useKreditoIdentity";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * State- and role-aware home.
 *   logged out                  → marketing Landing.
 *   logged in + identity         → the verified-borrower <Dashboard/> (has Borrow + LP tabs; NEVER re-evaluates).
 *   logged in + no identity       → the "choose your path" <RoleHome/> hub:
 *                                     · Borrow capital → starts the credit-identity <EvaluationFlow/>
 *                                       (Onboarding → Score → Certificate/mint); after a mint we refetch
 *                                       the identity and the router flips to the Dashboard.
 *                                     · Provide liquidity → /liquidity (OPEN, no identity required).
 * This fixes the LP trap: an unverified wallet is no longer forced into evaluation just to lend.
 */
export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // SSR / no Privy key: render the static landing (no Privy hooks).
  if (!mounted || !PRIVY_APP_ID) return <Landing />;
  return <HomeInner />;
}

const HomeInner = () => {
  const { ready, authenticated, login } = usePrivy();
  const { identity, loading, refetch } = useKreditoIdentity();
  // Unverified wallets land on the RoleHome hub; they only enter the evaluation flow when they
  // explicitly choose "Borrow capital". (LPs go to /liquidity straight from the hub.)
  const [startedBorrow, setStartedBorrow] = useState(false);

  if (!ready) return <LoadingState label="Connecting your wallet…" />;
  if (!authenticated) return <Landing onConnect={login} />;

  // Authenticated: wait for the identity lookup before deciding so a verified wallet is never
  // (even briefly) pushed into the evaluation path.
  if (loading) return <LoadingState label="Checking your credit identity…" />;

  if (identity) return <Dashboard identity={identity} />;

  // No identity yet. Default to the role hub; only show the evaluation flow once the wallet opts
  // into borrowing. On a successful mint, refetch so the router flips to the Dashboard.
  if (!startedBorrow) return <RoleHome onStartBorrow={() => setStartedBorrow(true)} />;
  return <EvaluationFlow onMinted={() => void refetch()} />;
};

const LoadingState = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center gap-3 pt-24" aria-live="polite">
    <span className="loading loading-spinner loading-lg text-primary" />
    <p className="text-sm text-base-content/60">{label}</p>
  </div>
);
