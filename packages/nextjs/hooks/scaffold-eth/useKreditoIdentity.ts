"use client";

import { useCallback, useEffect, useState } from "react";
import { useSmartWalletAddress } from "~~/hooks/scaffold-eth/useSmartWallet";
import type { EnsIdentity } from "~~/lib/kredito";

/**
 * Resolve the connected wallet's minted `<label>.kredito.eth` identity via the public lookup route
 * (GET /api/identity/lookup?wallet=...). This is NOT mainnet ENS resolution — it reads the Kredito
 * ENSv2 subname mirror. Defaults to the active smart-wallet address; re-fetches when it changes.
 */
export const useKreditoIdentity = (wallet?: string) => {
  const smartWallet = useSmartWalletAddress();
  const target = wallet ?? smartWallet;

  const [identity, setIdentity] = useState<EnsIdentity | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchIdentity = useCallback(
    async (signal?: AbortSignal) => {
      if (!target) {
        setIdentity(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/identity/lookup?wallet=${target}`, { signal });
        if (!res.ok) {
          setIdentity(null);
          return;
        }
        const json = await res.json();
        setIdentity(json?.hasIdentity && json.identity ? (json.identity as EnsIdentity) : null);
      } catch {
        // Non-fatal (incl. abort) — leave the last known identity untouched on abort, null otherwise.
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [target],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchIdentity(controller.signal);
    return () => controller.abort();
  }, [fetchIdentity]);

  const refetch = useCallback(() => fetchIdentity(), [fetchIdentity]);

  return { identity, loading, refetch };
};
