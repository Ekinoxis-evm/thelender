"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { KreditoFlow } from "~~/components/kredito/KreditoFlow";
import { Landing } from "~~/components/kredito/Landing";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Single-page app. Logged out → marketing landing. Logged in → the whole Kredito
 * flow (onboarding → score → certificate → borrow → liquidity) as in-page sections,
 * so there is no page navigation and the header stays clean (brand + profile only).
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

  if (!ready) {
    return (
      <div className="flex justify-center pt-24">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return authenticated ? <KreditoFlow /> : <Landing onConnect={login} />;
};
