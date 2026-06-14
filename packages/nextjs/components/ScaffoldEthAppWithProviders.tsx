"use client";

import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProgressBar as ProgressBar } from "next-nprogress-bar";
import { Toaster } from "react-hot-toast";
// Plain wagmi provider, used only for the SSR/no-key fallback where Privy's
// connector (which requires PrivyProvider context) must NOT be mounted.
import { WagmiProvider } from "wagmi";
import { Footer } from "~~/components/Footer";
import { Header } from "~~/components/Header";
import { privyConfig } from "~~/services/web3/privyConfig";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <div className={`flex flex-col min-h-screen `}>
        <Header />
        <main className="relative flex flex-col flex-1">{children}</main>
        <Footer />
      </div>
      <Toaster />
    </>
  );
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

// A real Privy App ID is REQUIRED at runtime — get it from the Privy Dashboard and
// set NEXT_PUBLIC_PRIVY_APP_ID. CI / prerender has no key; to keep SSG/prerender
// from throwing we only mount the Privy-dependent stack (PrivyProvider →
// SmartWalletsProvider, which call Privy hooks) on
// the client AND only when an appId is present. Server render / empty-key builds
// fall back to the plain wagmi + react-query stack so the build stays green.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export const ScaffoldEthAppWithProviders = ({ children }: { children: React.ReactNode }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // During SSR/prerender (`!mounted`) and whenever the Privy App ID is missing, we
  // render with PLAIN wagmi's `WagmiProvider` (not `@privy-io/wagmi`'s). Privy's
  // wagmi connector calls `useWallets`, which requires `PrivyProvider` context; if
  // we mounted the Privy wagmi provider without `PrivyProvider`, prerender would
  // throw. The plain provider still satisfies SE-2's wagmi hooks (e.g.
  // `useTargetNetwork`) so the layout renders and the build stays green.
  if (!mounted || !PRIVY_APP_ID) {
    return (
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
          <ProgressBar height="3px" color="#2299dd" />
          <ScaffoldEthApp>{children}</ScaffoldEthApp>
        </WagmiProvider>
      </QueryClientProvider>
    );
  }

  // Client-side with a real App ID: full Privy stack. `@privy-io/wagmi`'s
  // `WagmiProvider` keeps wagmi in sync with Privy's embedded wallet (used for
  // READS / chain state). WRITES are sent as sponsored UserOps through the native
  // smart wallet via `useSmartWallets().client` (see hooks/scaffold-eth/useSmartWallet).
  // IMPORTANT: pass the module-constant `privyConfig` directly. Building a fresh
  // config object on every render (e.g. to sync the modal theme) gives PrivyProvider
  // a new `config` reference each time, which re-initializes the provider and DROPS
  // the connected wallet session. A stable reference keeps the connection context.
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <SmartWalletsProvider>
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={wagmiConfig}>
            <ProgressBar height="3px" color="#2299dd" />
            <ScaffoldEthApp>{children}</ScaffoldEthApp>
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </SmartWalletsProvider>
    </PrivyProvider>
  );
};
