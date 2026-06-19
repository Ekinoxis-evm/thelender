import { useCallback, useEffect, useState } from "react";

/** One row of the borrower's stored credit checks (the `/api/lendsignal/checks` contract). */
export type CheckRow = {
  id: string;
  created_at: string;
  inference_id: string;
  model: string | null;
  attested: boolean;
  combined_score: number | null;
  risk_tier: string | null;
  eligible: boolean | null;
  attestation_hash?: string | null;
};

/**
 * Single source of truth for reading a wallet's recent credit checks back from Supabase.
 * `configured` is false when Supabase isn't set up (callers can hide instead of erroring);
 * `reload` re-fetches (used by "Try again"). Shared by the onboarding history strip and the
 * dashboard "My evaluations" tab so the API shape + fetch live in one place.
 */
export function useCreditChecks(borrower?: string, limit = 25) {
  const [checks, setChecks] = useState<CheckRow[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    let active = true;
    setChecks(null);
    setError(false);
    const url = `/api/lendsignal/checks?limit=${limit}${borrower ? `&borrower=${borrower}` : ""}`;
    fetch(url)
      .then(r => r.json())
      .then(j => {
        if (!active) return;
        setConfigured(j.configured !== false);
        setChecks(j.checks ?? []);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setChecks([]);
      });
    return () => {
      active = false;
    };
  }, [borrower, limit]);

  useEffect(() => load(), [load]);

  return { checks, configured, error, reload: load };
}
