"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Dashboard, EvaluationFlow } from "~~/components/kredito";
import { Landing } from "~~/components/kredito/Landing";
import { useKreditoIdentity } from "~~/hooks/scaffold-eth/useKreditoIdentity";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * State- and role-aware home.
 *   logged out                 → marketing Landing.
 *   logged in + identity        → the verified-borrower <Dashboard/> (NEVER re-evaluates).
 *   logged in + no identity      → the "get your credit identity" <EvaluationFlow/>
 *                                   (Onboarding → Score → Certificate/mint). After a mint we
 *                                   refetch the identity and the router flips to the Dashboard.
 * Only borrowers need a verified identity; liquidity stays open (reachable inside the Dashboard).
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

  if (!ready) return <Spinner />;
  if (!authenticated) return <Landing onConnect={login} />;

  // Authenticated: route on identity state. Wait for the identity lookup before deciding so a
  // verified wallet is never (even briefly) pushed into the evaluation path.
  if (loading) return <Spinner />;

  if (identity) return <Dashboard identity={identity} />;

  // No identity yet → evaluate + mint. On a successful mint, refetch so the router flips to Dashboard.
  return <EvaluationFlow onMinted={() => void refetch()} />;
};

const Spinner = () => (
  <div className="flex justify-center pt-24">
    <span className="loading loading-spinner loading-lg text-primary" />
  </div>
);
