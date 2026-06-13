"use client";

import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProgressBar as ProgressBar } from "next-nprogress-bar";
import { useTheme } from "next-themes";
import { Toaster } from "react-hot-toast";
// Plain wagmi provider, used only for the SSR/no-key fallback where Privy's
// connector (which requires PrivyProvider context) must NOT be mounted.
import { WagmiProvider } from "wagmi";
import { Footer } from "~~/components/Footer";
import { Header } from "~~/components/Header";
import { PrivySmartAccountConnector } from "~~/services/web3/PrivySmartAccountConnector";
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
// SmartWalletsProvider → PrivySmartAccountConnector, which call Privy hooks) on
// the client AND only when an appId is present. Server render / empty-key builds
// fall back to the plain wagmi + react-query stack so the build stays green.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export const ScaffoldEthAppWithProviders = ({ children }: { children: React.ReactNode }) => {
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";
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
  // `WagmiProvider` wires wagmi to Privy's embedded/smart wallets, and
  // `PrivySmartAccountConnector` registers the smart account so write hooks send
  // sponsored UserOps.
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        ...privyConfig,
        appearance: {
          ...privyConfig.appearance,
          theme: isDarkMode ? "dark" : "light",
        },
      }}
    >
      <SmartWalletsProvider>
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={wagmiConfig}>
            <PrivySmartAccountConnector />
            <ProgressBar height="3px" color="#2299dd" />
            <ScaffoldEthApp>{children}</ScaffoldEthApp>
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </SmartWalletsProvider>
    </PrivyProvider>
  );
};
